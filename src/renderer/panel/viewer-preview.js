/* Shellby panel — the file viewer's previews: a Markdown file as it reads, and a
   picture (PNG, JPEG, GIF, WebP, SVG…) as itself rather than "a binary file".
   Markdown goes through the same renderer as Claude's replies (markdown.js
   escapes everything first); a picture comes from main as a data: URL (viewer.js
   imageOf) and sits in an <img>, which runs nothing, an SVG's scripts included. */
'use strict';
(function () {
  const { h, api } = SB;
  const MARKDOWN = /\.(md|markdown|mdx)$/i;
  const PICTURE = /\.(png|jpe?g|gif|webp|bmp|ico|avif|svg)$/i;
  const TEXT_PICTURE = /\.svg$/i; // a picture that's also text: its code by default, the picture a click away

  const kindOf = rel => (MARKDOWN.test(rel) ? 'markdown' : PICTURE.test(rel) ? 'picture' : null);

  const fail = text => h('div', { class: 'vw-note-box' }, h('p', { class: 'muted', text }));

  async function picture(me, rel, call) {
    const r = await call(id => api.viewerImage(id, rel));
    if (!r?.ok) return fail(r?.tooBig ? 'This picture is too big to show here.' : r?.missing ? 'This file is gone.' : r?.error || "Couldn't show that picture.");
    const img = h('img', { class: 'vw-img', src: r.url, alt: rel.split('/').pop(), decoding: 'async' });
    const size = h('p', { class: 'small muted vw-img-size' });
    img.addEventListener('load', () => { size.textContent = `${img.naturalWidth} × ${img.naturalHeight}`; }, { once: true });
    img.addEventListener('error', () => { size.textContent = "Couldn't draw this picture."; }, { once: true });
    return h('div', { class: 'vw-preview-box' }, h('div', { class: 'vw-img-frame' }, img), size);
  }

  async function markdown(rel, call) {
    const r = await call(id => api.viewerRead(id, rel));
    if (!r?.ok) return fail(r?.tooBig ? 'This file is too big to preview.' : r?.missing ? 'This file is gone.' : r?.error || "Couldn't read that.");
    const body = SB.renderMarkdownInto(h('div', { class: 'msg assistant vw-md' }), r.text);
    // A link in it opens in the browser or the viewer as a reply's would; nothing here navigates the panel.
    SB.linkifyPaths?.(body);
    return h('div', { class: 'vw-preview-box' }, body);
  }

  SB.viewerPreview = {
    /** Whether this file has a preview that's worth a button (one that's only a picture shows as one already). */
    can: rel => kindOf(rel) === 'markdown' || TEXT_PICTURE.test(rel),

    /** The Preview toggle for the file head, or null. me.preview: on for this file. */
    button(me, rel, f) {
      if (!me || !SB.viewerPreview.can(rel) || f?.status === 'D') return null;
      return h('button', {
        type: 'button', class: 'btn ghost slim-btn vw-preview', text: 'Preview', 'aria-pressed': String(!!me.preview),
        title: kindOf(rel) === 'markdown' ? 'Show it as it reads' : 'Show the picture',
        onclick: () => SB.viewer?.togglePreview(),
      });
    },

    /** The preview itself, for viewer.js showFile. call: its call() on the handle. */
    render: (me, rel, call) => (kindOf(rel) === 'markdown' ? markdown(rel, call) : picture(me, rel, call)),

    /** A changed file git calls binary: the picture as it is now, when it is one; else null. */
    async binary(me, f, call) {
      if (kindOf(f.path) !== 'picture' || f.status === 'D') return null;
      const shown = await picture(me, f.path, call);
      return h('div', {}, h('p', { class: 'small muted vw-img-note', text: f.status === 'M' ? 'The picture as it is now.' : 'A new picture.' }), shown);
    },

    /** A file read as binary in the whole-file view: its picture when it is one; else null. */
    whole: (me, rel, call) => (kindOf(rel) === 'picture' ? picture(me, rel, call) : null),
  };
})();
