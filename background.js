// TubeVault service worker.
// Its only jobs: seed default categories on install, and save videos on behalf of the
// YouTube content script (content scripts send a message; all writes go through lib/store.js).

import { ensureDefaults, saveBookmark, getState } from './lib/store.js';
import { isValidVideoId } from './lib/youtube.js';

chrome.runtime.onInstalled.addListener(() => {
  ensureDefaults().catch((err) => console.error('[TubeVault] could not seed categories', err));
});

async function handleSaveVideo(video) {
  if (!video || !isValidVideoId(video.videoId)) {
    return { ok: false, error: 'This page does not have a video TubeVault can save.' };
  }
  const result = await saveBookmark({
    videoId: video.videoId,
    title: typeof video.title === 'string' ? video.title : '',
    isShort: video.isShort === true
    // categoryId omitted on purpose: the store picks the last-used category (default: Watch Later)
  });
  const { categories } = await getState();
  const category = categories.find((c) => c.id === result.bookmark.categoryId);
  return { ok: true, status: result.status, categoryName: category ? category.name : 'Uncategorized' };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !message) return false;

  if (message.type === 'TV_SAVE_VIDEO') {
    handleSaveVideo(message.video)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err && err.message ? err.message : 'Could not save this video.' }));
    return true; // keep the channel open for the async response
  }
  return false;
});
