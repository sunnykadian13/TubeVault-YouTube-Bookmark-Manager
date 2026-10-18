import {
  getState, saveBookmark, updateBookmark, removeBookmark, queryBookmarks, countByCategory, pickDefaultCategory
} from './lib/store.js';
import { parseYouTubeUrl, cleanTitle, bookmarkUrl } from './lib/youtube.js';
import {
  h, icon, iconButton, selectEl, thumbLink, toast, confirmDialog, copyText, formatSavedDate, formatFullDate, plural
} from './lib/ui.js';

const RECENT_LIMIT = 6;
const RESULT_LIMIT = 100;

const $ = (sel) => document.querySelector(sel);
const els = {
  count: $('#count'),
  current: $('#current'),
  search: $('#search'),
  filter: $('#category-filter'),
  listTitle: $('#list-title'),
  list: $('#list')
};

const state = { bookmarks: [], categories: [], settings: {}, video: null, query: '', categoryId: 'all', error: null };

const categoryName = (id) => (state.categories.find((c) => c.id === id) || { name: 'Uncategorized' }).name;
const categoryOptions = () => state.categories.map((c) => ({ value: c.id, label: c.name }));

/* ------------------------------ data ------------------------------ */

async function refresh() {
  const s = await getState();
  state.bookmarks = s.bookmarks;
  state.categories = s.categories;
  state.settings = s.settings;
  if (state.categoryId !== 'all' && !state.categories.some((c) => c.id === state.categoryId)) state.categoryId = 'all';
}

async function detectVideo() {
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    return null;
  }
  const parsed = tab && tab.url ? parseYouTubeUrl(tab.url) : null;
  if (!parsed) return null;

  let title = '';
  try {
    // Ask the content script on the page for the freshest title...
    const info = await chrome.tabs.sendMessage(tab.id, { type: 'TV_GET_VIDEO_INFO' });
    if (info && info.videoId === parsed.videoId) title = cleanTitle(info.title);
  } catch {
    // ...or fall back to the tab title (e.g. the tab was open before TubeVault was installed).
  }
  if (!title) title = cleanTitle(tab.title);
  return { videoId: parsed.videoId, isShort: parsed.isShort, title: title || 'Untitled video' };
}

/* ------------------------------ rendering ------------------------------ */

function render() {
  els.count.textContent = plural(state.bookmarks.length, 'video') + ' saved';
  renderCurrent();
  renderFilter();
  renderList();
}

function renderLoading() {
  els.current.replaceChildren(
    h('div', { class: 'cur' }, h('div', { class: 'skeleton a' }), h('div', {}, h('div', { class: 'skeleton b' }), h('div', { class: 'skeleton b', style: 'width:60%' })))
  );
  els.list.replaceChildren(
    ...[0, 1, 2].map(() =>
      h('div', { class: 'row' }, h('div', { class: 'skeleton t' }), h('div', {}, h('div', { class: 'skeleton l' }), h('div', { class: 'skeleton l', style: 'width:50%' })), h('span'))
    )
  );
}

function renderError() {
  els.current.replaceChildren(
    h('div', { class: 'empty' }, icon('alert', 22), h('p', { class: 'empty-title' }, 'TubeVault hit a problem'), h('p', { class: 'empty-text' }, state.error),
      h('button', { type: 'button', class: 'btn btn-sm', onClick: init }, 'Try again'))
  );
  els.list.replaceChildren();
}

function renderCurrent() {
  const root = els.current;
  const v = state.video;

  if (!v) {
    root.replaceChildren(
      h('div', { class: 'empty' }, icon('play', 22), h('p', { class: 'empty-title' }, 'No video to save on this page'),
        h('p', { class: 'empty-text' }, 'Open a YouTube video or Short, then click TubeVault again.'))
    );
    return;
  }

  const existing = state.bookmarks.find((b) => b.videoId === v.videoId);
  const select = selectEl(categoryOptions(), existing ? existing.categoryId : pickDefaultCategory(state.categories, state.settings), { 'aria-label': 'Category' });
  const notes = existing ? null : h('textarea', { class: 'textarea', rows: 2, maxlength: 2000, placeholder: 'Add a note (optional)', 'aria-label': 'Notes' });

  let action;
  if (existing) {
    select.addEventListener('change', async () => {
      try {
        await updateBookmark(existing.id, { categoryId: select.value });
        toast(`Moved to ${categoryName(select.value)}`, 'success');
        await refresh();
        render();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    action = h('button', { type: 'button', class: 'btn btn-saved btn-block', disabled: true }, icon('check'), 'Already Saved');
  } else {
    action = h('button', { type: 'button', class: 'btn btn-primary btn-block' }, icon('bookmark'), 'Save to TubeVault');
    action.addEventListener('click', async () => {
      action.disabled = true;
      try {
        const result = await saveBookmark({ ...v, categoryId: select.value, notes: notes.value });
        toast(result.status === 'duplicate' ? 'Already Saved' : `Saved to ${categoryName(result.bookmark.categoryId)}`, result.status === 'duplicate' ? 'info' : 'success');
        await refresh();
        render();
      } catch (err) {
        toast(err.message, 'error');
        action.disabled = false;
      }
    });
  }

  root.replaceChildren(
    h('div', { class: 'cur' },
      thumbLink({ videoId: v.videoId, isShort: v.isShort }),
      h('div', {},
        h('p', { class: 'cur-title' }, v.title),
        existing ? h('p', { class: 'cur-status' }, icon('check', 14), `Saved in ${categoryName(existing.categoryId)}`) : null)),
    h('div', { class: 'cur-form' }, select, notes, action)
  );
}

function renderFilter() {
  const counts = countByCategory(state.bookmarks);
  const options = [{ value: 'all', label: 'All categories' }, ...state.categories.map((c) => ({ value: c.id, label: `${c.name} (${counts.get(c.id) || 0})` }))];
  const next = selectEl(options, state.categoryId, { id: 'category-filter', 'aria-label': 'Filter by category' });
  next.addEventListener('change', () => {
    state.categoryId = next.value;
    renderList();
  });
  els.filter.replaceWith(next);
  els.filter = next;
}

function bookmarkRow(b) {
  const url = bookmarkUrl(b);
  return h('article', { class: 'row' },
    thumbLink(b),
    h('div', {},
      h('a', { class: 'row-title', href: url, target: '_blank', rel: 'noopener noreferrer', title: b.title }, b.title),
      h('div', { class: 'row-meta' }, h('span', { class: 'chip' }, categoryName(b.categoryId)), h('time', { datetime: b.savedAt, title: formatFullDate(b.savedAt) }, formatSavedDate(b.savedAt)))),
    h('div', { class: 'row-actions' },
      iconButton('external', 'Open in new tab', null, { href: url }),
      iconButton('copy', 'Copy video link', async () => toast((await copyText(url)) ? 'Link copied' : 'Could not copy the link', 'info')),
      iconButton('trash', 'Remove bookmark', () => onRemove(b), { danger: true }))
  );
}

function renderList() {
  const filtering = state.query.trim() !== '' || state.categoryId !== 'all';
  const matches = queryBookmarks(state.bookmarks, { query: state.query, categoryId: state.categoryId, sort: 'newest' });
  els.listTitle.textContent = filtering ? `Results (${matches.length})` : 'Recently saved';

  if (state.bookmarks.length === 0) {
    els.list.replaceChildren(h('div', { class: 'empty' }, icon('bookmark', 22), h('p', { class: 'empty-title' }, 'Nothing saved yet'),
      h('p', { class: 'empty-text' }, 'Save the video you are watching and it will show up here.')));
    return;
  }
  if (matches.length === 0) {
    els.list.replaceChildren(h('div', { class: 'empty' }, icon('search', 22), h('p', { class: 'empty-title' }, 'No matches'),
      h('p', { class: 'empty-text' }, 'Try a different search or category.')));
    return;
  }

  const shown = filtering ? matches.slice(0, RESULT_LIMIT) : matches.slice(0, RECENT_LIMIT);
  const nodes = shown.map(bookmarkRow);
  if (!filtering && matches.length > RECENT_LIMIT) {
    nodes.push(h('button', { type: 'button', class: 'btn btn-sm more', onClick: openDashboard }, `See all ${matches.length} in the dashboard`));
  } else if (filtering && matches.length > RESULT_LIMIT) {
    nodes.push(h('p', { class: 'note' }, `Showing the first ${RESULT_LIMIT}. Open the dashboard to see the rest.`));
  }
  els.list.replaceChildren(...nodes);
}

/* ------------------------------ actions ------------------------------ */

async function onRemove(b) {
  const ok = await confirmDialog({
    title: 'Remove this bookmark?',
    message: `“${b.title}” will be removed from TubeVault. The video on YouTube is not affected.`,
    confirmText: 'Remove',
    danger: true
  });
  if (!ok) return;
  try {
    await removeBookmark(b.id);
    toast('Bookmark removed');
    await refresh();
    render();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function openDashboard() {
  chrome.runtime.openOptionsPage();
  window.close();
}

/* ------------------------------ start ------------------------------ */

async function init() {
  renderLoading();
  try {
    await refresh();
    state.video = await detectVideo();
    state.error = null;
  } catch (err) {
    state.error = err.message;
  }
  if (state.error) renderError();
  else render();
}

$('#open-dashboard').addEventListener('click', openDashboard);
els.search.addEventListener('input', () => {
  state.query = els.search.value;
  renderList();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || state.error) return;
  refresh().then(render).catch(() => {});
});

init();
