import {
  getState, queryBookmarks, countByCategory, updateBookmark, removeBookmark,
  addCategory, renameCategory, deleteCategory, exportData, importData, UNCATEGORIZED_ID
} from './lib/store.js';
import { bookmarkUrl } from './lib/youtube.js';
import {
  h, icon, iconButton, thumbLink, toast, formDialog, confirmDialog, copyText, formatSavedDate, formatFullDate, plural
} from './lib/ui.js';

const PAGE_SIZE = 48;
const RECENT_COUNT = 8;
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

const $ = (sel) => document.querySelector(sel);
const els = {
  navAll: $('#nav-all'), navCategories: $('#nav-categories'), addCategory: $('#add-category'),
  search: $('#search'), sort: $('#sort'),
  title: $('#view-title'), sub: $('#view-sub'), viewActions: $('#view-actions'),
  loading: $('#loading'), recentSection: $('#recent-section'), recent: $('#recent'),
  library: $('#library'), gridTitle: $('#grid-title'), grid: $('#grid'),
  moreWrap: $('#more-wrap'), more: $('#more'), empty: $('#empty'),
  importBtn: $('#import-btn'), exportBtn: $('#export-btn'), importFile: $('#import-file')
};

const state = { bookmarks: [], categories: [], categoryId: 'all', query: '', sort: 'newest', limit: PAGE_SIZE };

const categoryName = (id) => (state.categories.find((c) => c.id === id) || { name: 'Uncategorized' }).name;
const categoryOptions = (exceptId) =>
  state.categories.filter((c) => c.id !== exceptId).map((c) => ({ value: c.id, label: c.name }));

/* ------------------------------ data ------------------------------ */

async function refresh() {
  const s = await getState();
  state.bookmarks = s.bookmarks;
  state.categories = s.categories;
  if (state.categoryId !== 'all' && !state.categories.some((c) => c.id === state.categoryId)) state.categoryId = 'all';
}

async function reload() {
  try {
    await refresh();
    render();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ------------------------------ rendering ------------------------------ */

function render() {
  els.loading.hidden = true;
  renderSidebar();
  renderHeader();
  renderRecent();
  renderLibrary();
}

function navItem(id, label, count) {
  const active = state.categoryId === id;
  return h('button', {
    type: 'button',
    class: 'nav-item' + (active ? ' active' : ''),
    'aria-current': active ? 'page' : null,
    onClick: () => selectView(id)
  }, h('span', { class: 'nav-label' }, label), h('span', { class: 'nav-count' }, String(count)));
}

function renderSidebar() {
  const counts = countByCategory(state.bookmarks);
  els.navAll.replaceChildren(navItem('all', 'All videos', state.bookmarks.length));
  els.navCategories.replaceChildren(...state.categories.map((c) => navItem(c.id, c.name, counts.get(c.id) || 0)));
}

function renderHeader() {
  const isAll = state.categoryId === 'all';
  const count = isAll ? state.bookmarks.length : state.bookmarks.filter((b) => b.categoryId === state.categoryId).length;
  els.title.textContent = isAll ? 'All videos' : categoryName(state.categoryId);
  els.sub.textContent = plural(count, 'video');

  const manageable = !isAll && state.categoryId !== UNCATEGORIZED_ID;
  els.viewActions.replaceChildren(
    ...(manageable
      ? [
          h('button', { type: 'button', class: 'btn btn-sm', onClick: onRenameCategory }, icon('edit', 14), 'Rename'),
          h('button', { type: 'button', class: 'btn btn-sm', onClick: onDeleteCategory }, icon('trash', 14), 'Delete')
        ]
      : [])
  );
}

function renderRecent() {
  const show = state.categoryId === 'all' && state.query.trim() === '' && state.bookmarks.length > 0;
  els.recentSection.hidden = !show;
  if (!show) return;
  const recent = queryBookmarks(state.bookmarks, { sort: 'newest' }).slice(0, RECENT_COUNT);
  els.recent.replaceChildren(
    ...recent.map((b) =>
      h('article', { class: 'recent-item' },
        thumbLink(b),
        h('a', { class: 'card-title', href: bookmarkUrl(b), target: '_blank', rel: 'noopener noreferrer', title: b.title }, b.title))
    )
  );
}

function bookmarkCard(b) {
  const url = bookmarkUrl(b);
  return h('article', { class: 'card' },
    thumbLink(b),
    h('div', { class: 'card-body' },
      h('a', { class: 'card-title', href: url, target: '_blank', rel: 'noopener noreferrer', title: b.title }, b.title),
      h('div', { class: 'card-meta' },
        h('span', { class: 'chip' }, categoryName(b.categoryId)),
        h('time', { datetime: b.savedAt, title: formatFullDate(b.savedAt) }, formatSavedDate(b.savedAt))),
      b.notes ? h('p', { class: 'card-notes' }, b.notes) : null),
    h('div', { class: 'card-actions' },
      h('a', { class: 'btn btn-sm btn-ghost open', href: url, target: '_blank', rel: 'noopener noreferrer' }, icon('external', 14), 'Open'),
      iconButton('copy', 'Copy video link', async () => toast((await copyText(url)) ? 'Link copied' : 'Could not copy the link')),
      iconButton('edit', 'Edit category and notes', () => onEdit(b)),
      iconButton('trash', 'Remove bookmark', () => onRemove(b), { danger: true }))
  );
}

function renderLibrary() {
  const isAll = state.categoryId === 'all';
  const searching = state.query.trim() !== '';
  const matches = queryBookmarks(state.bookmarks, { query: state.query, categoryId: state.categoryId, sort: state.sort });
  const showRecent = !els.recentSection.hidden;

  els.library.hidden = false;
  els.gridTitle.hidden = !showRecent;
  els.moreWrap.hidden = true;
  els.empty.replaceChildren();

  if (matches.length === 0) {
    els.grid.replaceChildren();
    els.gridTitle.hidden = true;
    if (state.bookmarks.length === 0) {
      els.empty.append(h('div', { class: 'empty' }, icon('bookmark', 28),
        h('p', { class: 'empty-title' }, 'Your vault is empty'),
        h('p', { class: 'empty-text' }, 'Open a YouTube video and use the Save to TubeVault button next to Like and Share, or the TubeVault toolbar icon.'),
        h('button', { type: 'button', class: 'btn', onClick: () => els.importFile.click() }, icon('upload', 14), 'Import a backup')));
    } else if (searching) {
      els.empty.append(h('div', { class: 'empty' }, icon('search', 28),
        h('p', { class: 'empty-title' }, 'No matching videos'),
        h('p', { class: 'empty-text' }, 'Nothing in this view matches your search.'),
        h('button', { type: 'button', class: 'btn', onClick: clearSearch }, 'Clear search')));
    } else {
      els.empty.append(h('div', { class: 'empty' }, icon('folder', 28),
        h('p', { class: 'empty-title' }, 'No videos here yet'),
        h('p', { class: 'empty-text' }, 'Use Edit on any video to move it into this category.')));
    }
    return;
  }

  const shown = matches.slice(0, state.limit);
  els.grid.replaceChildren(...shown.map(bookmarkCard));
  if (matches.length > shown.length) {
    els.moreWrap.hidden = false;
    els.more.textContent = `Show more (${matches.length - shown.length} left)`;
  }
}

function renderSkeleton() {
  els.loading.replaceChildren(...Array.from({ length: 8 }, () => h('div', { class: 'skeleton card-skeleton' })));
}

/* ------------------------------ navigation & search ------------------------------ */

function selectView(id) {
  state.categoryId = id;
  state.limit = PAGE_SIZE;
  render();
}

function clearSearch() {
  els.search.value = '';
  state.query = '';
  state.limit = PAGE_SIZE;
  render();
  els.search.focus();
}

let searchTimer = 0;
els.search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = els.search.value;
    state.limit = PAGE_SIZE;
    render();
  }, 120);
});
els.sort.addEventListener('change', () => {
  state.sort = els.sort.value;
  state.limit = PAGE_SIZE;
  render();
});
els.more.addEventListener('click', () => {
  state.limit += PAGE_SIZE;
  renderLibrary();
});
document.addEventListener('keydown', (event) => {
  if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.querySelector('dialog[open]')) return;
  event.preventDefault();
  els.search.focus();
});

/* ------------------------------ bookmark actions ------------------------------ */

async function onEdit(b) {
  await formDialog({
    title: 'Edit bookmark',
    description: b.title,
    fields: [
      { name: 'categoryId', label: 'Category', type: 'select', value: b.categoryId, options: categoryOptions() },
      { name: 'notes', label: 'Notes', type: 'textarea', value: b.notes, maxLength: 2000, placeholder: 'Why did you save this?' }
    ],
    confirmText: 'Save changes',
    onSubmit: (v) => updateBookmark(b.id, { categoryId: v.categoryId, notes: v.notes })
  }).then((result) => result && toast('Changes saved', 'success'));
  await reload();
}

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
  } catch (err) {
    toast(err.message, 'error');
  }
  await reload();
}

/* ------------------------------ category actions ------------------------------ */

els.addCategory.append(icon('plus'));
els.addCategory.addEventListener('click', async () => {
  let created = null;
  await formDialog({
    title: 'New category',
    fields: [{ name: 'name', label: 'Name', type: 'text', maxLength: 40, placeholder: 'For example, System Design' }],
    confirmText: 'Create category',
    onSubmit: async (v) => {
      created = await addCategory(v.name);
    }
  });
  if (created) {
    state.categoryId = created.id;
    state.limit = PAGE_SIZE;
    toast(`Created ${created.name}`, 'success');
  }
  await reload();
});

async function onRenameCategory() {
  const id = state.categoryId;
  await formDialog({
    title: 'Rename category',
    fields: [{ name: 'name', label: 'Name', type: 'text', value: categoryName(id), maxLength: 40 }],
    confirmText: 'Rename',
    onSubmit: (v) => renameCategory(id, v.name)
  }).then((result) => result && toast('Category renamed', 'success'));
  await reload();
}

async function onDeleteCategory() {
  const id = state.categoryId;
  const name = categoryName(id);
  const inside = state.bookmarks.filter((b) => b.categoryId === id).length;
  const fields = inside
    ? [{ name: 'moveTo', label: 'Move its videos to', type: 'select', value: UNCATEGORIZED_ID, options: categoryOptions(id) }]
    : [];
  const result = await formDialog({
    title: `Delete “${name}”?`,
    description: inside
      ? `${plural(inside, 'video')} in this category will not be deleted. Choose where they should go.`
      : 'This category is empty.',
    fields,
    confirmText: 'Delete category',
    danger: true,
    onSubmit: (v) => deleteCategory(id, v.moveTo || UNCATEGORIZED_ID)
  });
  if (result) {
    state.categoryId = 'all';
    toast(inside ? `Deleted ${name}. Videos were moved.` : `Deleted ${name}`);
  }
  await reload();
}

/* ------------------------------ export / import ------------------------------ */

els.exportBtn.addEventListener('click', async () => {
  try {
    const data = await exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 10);
    const link = h('a', { href: url, download: `tubevault-backup-${stamp}.json` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast(`Exported ${plural(data.bookmarks.length, 'video')}`, 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
});

els.importBtn.addEventListener('click', () => els.importFile.click());
els.importFile.addEventListener('change', async () => {
  const file = els.importFile.files && els.importFile.files[0];
  els.importFile.value = ''; // allow choosing the same file again later
  if (!file) return;
  try {
    if (file.size > MAX_IMPORT_BYTES) throw new Error('That file is larger than 10 MB, so it is probably not a TubeVault export.');
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      throw new Error('That file is not valid JSON. Choose a file created with Export.');
    }
    const r = await importData(parsed);
    const parts = [`Imported ${plural(r.added, 'video')}`];
    if (r.duplicates) parts.push(`skipped ${plural(r.duplicates, 'duplicate')}`);
    if (r.invalid) parts.push(`ignored ${plural(r.invalid, 'invalid entry', 'invalid entries')}`);
    if (r.categoriesAdded) parts.push(`added ${plural(r.categoriesAdded, 'category', 'categories')}`);
    toast(parts.join(', '), r.added ? 'success' : 'info');
    await reload();
  } catch (err) {
    toast(err.message, 'error');
  }
});

/* ------------------------------ start ------------------------------ */

let syncTimer = 0;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(reload, 150); // pick up saves made from YouTube tabs or the popup
});

renderSkeleton();
reload();
