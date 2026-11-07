// Pictures in a conversation, for the phone (server.js /picture): a step's (a
// screenshot Claude read, saved by tool-pictures.js) by the id its item names,
// and one you attached by its message's turn and its place among that message's
// pictures (view.js pictureFiles). No path ever comes from the phone: main finds
// the file itself. Each comes cut down to a phone's size, as a data URL.
const attach = require('../attachments');
const { pictureFiles } = require('./view');

/** d: d.toolPicture(tabId, id) -> data URL | null, d.history.load(tabId) -> items. */
function createPocketPictures(d) {
  const ok = extra => ({ ok: true, ...extra });
  const no = error => ({ ok: false, error });

  async function onPicture(_device, { tab, pic, turn, i }) {
    const { nativeImage } = require('electron');
    let url;
    if (pic) {
      const full = d.toolPicture?.(tab, pic);
      const img = full ? nativeImage.createFromDataURL(full) : null;
      url = img && !img.isEmpty() ? attach.fit(img, attach.PREVIEW_EDGE).toDataURL() : null;
    } else {
      const msg = (d.history.load(tab) || []).find(it => it?.kind === 'user' && it.turnId === turn);
      const file = msg ? pictureFiles(msg.attachments)[i] : null;
      url = file ? attach.thumbnail(file, { nativeImage, edge: attach.PREVIEW_EDGE }) : null;
    }
    return url ? ok({ url }) : no('That picture has been tidied away.');
  }

  return { onPicture };
}

module.exports = { createPocketPictures };
