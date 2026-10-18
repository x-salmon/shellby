/* Shellby panel — moments that move: a four-second clip of a moment card, for
   the two moments that are animations by nature. The sparkly reveal: the card
   flips from dark to the sparkly art, then a glint sweeps across it. The molt:
   the old shell slides off onto the shelf and the new one drops on. The card
   around the art is drawn once (moment-card.js, art left out); each frame
   paints the art over it, and MediaRecorder records the canvas. MP4 when
   Chromium can make one (X and Bluesky take MP4; Discord takes both), WebM
   when it can't. Main saves it like a card (card:save, video: 'mp4' | 'webm'). */
'use strict';
(function () {
  const FPS = 30;
  const SECONDS = 4;
  const FRAMES = FPS * SECONDS;
  const HOLD = 0.85; // the last ~0.6 s holds the finished card
  const BITS_PER_SECOND = 2_500_000; // a 4-second clip stays far under main's 5 MB
  // What to ask MediaRecorder for, best first: [mime, file extension].
  const TYPES = Object.freeze([['video/mp4;codecs=avc1', 'mp4'], ['video/webm;codecs=vp9', 'webm'], ['video/webm', 'webm']]);
  // The kinds of moment card that have a clip.
  const CLIP_KINDS = Object.freeze(['shiny', 'molt']);

  /** The best container this Chromium records, or null when it records none. */
  const pickType = () => TYPES.find(([mime]) => window.MediaRecorder?.isTypeSupported?.(mime)) || null;

  // The art alone, on a transparent canvas the size of its box.
  async function artLayer(m, box) {
    const c = document.createElement('canvas');
    c.width = box.w;
    c.height = box.h;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    await SB.momentCard.drawArt(g, m, { x: 0, y: 0, w: box.w, h: box.h });
    return c;
  }

  // The same shape in one colour: the card's back, before it turns over.
  function silhouette(layer, colour) {
    const c = document.createElement('canvas');
    c.width = layer.width;
    c.height = layer.height;
    const g = c.getContext('2d');
    g.drawImage(layer, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = colour;
    g.fillRect(0, 0, c.width, c.height);
    return c;
  }

  const ease = p => 1 - (1 - p) ** 3;

  // The sparkly reveal. t 0..0.4: the card turns over, dark side first; then a
  // band of light sweeps across the art (only over its own pixels) and the
  // little glints round it twinkle.
  async function sparkleFrames(m, box) {
    const art = await artLayer(m, box);
    const dark = silhouette(art, '#0b1d22');
    const sweep = document.createElement('canvas');
    sweep.width = box.w;
    sweep.height = box.h;
    const sg = sweep.getContext('2d');
    const FLIP = 0.4;
    const glints = [[0.12, 0.2], [0.86, 0.16], [0.9, 0.74], [0.1, 0.8], [0.5, 0.04]];
    return (ctx, t) => {
      const cx = box.x + box.w / 2;
      if (t < FLIP) {
        const p = t / FLIP, k = Math.max(0.03, Math.abs(Math.cos(p * Math.PI)));
        ctx.save();
        ctx.translate(cx, 0);
        ctx.scale(k, 1);
        ctx.drawImage(p < 0.5 ? dark : art, -box.w / 2, box.y);
        ctx.restore();
        return;
      }
      const p = (t - FLIP) / (1 - FLIP);
      ctx.drawImage(art, box.x, box.y);
      // The band: drawn over a copy of the art, so it lights only the art.
      sg.globalCompositeOperation = 'source-over';
      sg.clearRect(0, 0, box.w, box.h);
      sg.drawImage(art, 0, 0);
      sg.globalCompositeOperation = 'source-atop';
      const at = -0.4 * box.w + ease(Math.min(1, p * 1.4)) * 1.8 * box.w;
      const g = sg.createLinearGradient(at - 60, 0, at + 60, box.h * 0.4);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(255,255,255,.75)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      sg.fillStyle = g;
      sg.fillRect(0, 0, box.w, box.h);
      ctx.drawImage(sweep, box.x, box.y);
      glints.forEach(([gx, gy], i) => {
        const s = Math.max(0, Math.sin((p * 3 + i * 0.37) * Math.PI)) * 9;
        if (s < 1) return;
        const x = box.x + gx * box.w, y = box.y + gy * box.h;
        ctx.fillStyle = i % 2 ? '#fff1a8' : 'rgba(255,255,255,.9)';
        ctx.fillRect(x - 1, y - s, 3, s * 2 + 1);
        ctx.fillRect(x - s, y - 1, s * 2 + 1, 3);
      });
    };
  }

  // The molt: its card already paints itself at any point of the change (moment-card.js paintMolt).
  const moltFrames = (m, box) => (ctx, t) => m.paint(ctx, box, t);

  /**
   * Record a moment's clip, size 'wide' or 'square'.
   *   -> { bytes: Uint8Array, ext: 'mp4' | 'webm', mime, blob }
   */
  async function record(kind, m, size = 'wide') {
    const type = pickType();
    if (!type) throw new Error('MediaRecorder records nothing here');
    if (!CLIP_KINDS.includes(kind)) throw new Error(`no clip for ${kind}`);
    const base = await SB.momentCard.draw(m, size, { art: false });
    const { box } = base;
    const canvas = document.createElement('canvas');
    canvas.width = base.canvas.width;
    canvas.height = base.canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const frame = kind === 'molt' ? moltFrames(m, box) : await sparkleFrames(m, box);
    const paint = async t => { ctx.drawImage(base.canvas, 0, 0); await frame(ctx, t); };

    await paint(0);
    const stream = canvas.captureStream(0);
    const [track] = stream.getVideoTracks();
    const rec = new window.MediaRecorder(stream, { mimeType: type[0], videoBitsPerSecond: BITS_PER_SECOND });
    const parts = [];
    rec.ondataavailable = e => { if (e.data?.size) parts.push(e.data); };
    const stopped = new Promise(r => { rec.onstop = r; });
    rec.start();
    // Paced by the clock, not by animation frames: a frame every 1/30 s, whatever the panel is doing.
    const t0 = performance.now();
    try {
      for (let i = 0; i < FRAMES; i++) {
        await paint(Math.min(1, i / (FRAMES * HOLD)));
        track.requestFrame();
        const next = t0 + ((i + 1) * 1000) / FPS;
        await new Promise(r => setTimeout(r, Math.max(0, next - performance.now())));
      }
    } finally {
      rec.stop();
      await stopped;
      track.stop();
    }
    const blob = new Blob(parts, { type: type[0] });
    return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: type[1], mime: type[0], blob };
  }

  SB.momentClip = { CLIP_KINDS, TYPES, FPS, SECONDS, pickType, record, has: kind => CLIP_KINDS.includes(kind) && !!pickType() };
})();
