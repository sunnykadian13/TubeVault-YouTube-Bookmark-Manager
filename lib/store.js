// All reading/writing of bookmarks and categories lives here.
// Every mutation runs inside a Web Lock so the popup, dashboard and service worker
// can never overwrite each other's changes with stale data.

import { isValidVideoId, watchUrl, thumbnailUrl, parseYouTubeUrl } from './youtube.js';

export const UNCATEGORIZED_ID = 'uncategorized';
export const UNCATEGORIZED = Object.freeze({ id: UNCATEGORIZED_ID, name: 'Uncategorized', system: true });

export const DEFAULT_CATEGORIES = Object.freeze([
  { id: 'dsa', name: 'DSA' },
  { id: 'web-development', name: 'Web Development' },
  { id: 'java-spring-boot', name: 'Java & Spring Boot' },
  { id: 'interview-preparation', name: 'Interview Preparation' },
  { id: 'ai-machine-learning', name: 'AI & Machine Learning' },
  { id: 'watch-later', name: 'Watch Later' }
]);

export const LIMITS = Object.freeze({ name: 40, title: 300, notes: 2000, importBookmarks: 20000 });

const STORAGE_ERROR =
  'TubeVault could not read or write browser storage. Try again, and make sure Chrome has free disk space.';

/* ------------------------------ internals ------------------------------ */

// Web Locks serialize writes across the popup, dashboard and service worker. If it is ever
// unavailable, fall back to an in-page queue so writes from one context still cannot overlap.
let queue = Promise.resolve();
function locked(task) {
  const locks = globalThis.navigator && globalThis.navigator.locks;
  if (locks) return locks.request('tubevault-store', task);
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

function cleanLine(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanNotes(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, '')
    .trim()
    .slice(0, LIMITS.notes);
}

const isBookmark = (b) => !!b && typeof b === 'object' && typeof b.id === 'string' && isValidVideoId(b.videoId);
const isCategory = (c) =>
  !!c && typeof c === 'object' && typeof c.id === 'string' && typeof c.name === 'string' && c.id !== UNCATEGORIZED_ID;

function normalizeBookmark(b) {
  return {
    ...b,
    title: cleanLine(b.title, LIMITS.title) || 'Untitled video',
    notes: typeof b.notes === 'string' ? b.notes : '',
    categoryId: typeof b.categoryId === 'string' ? b.categoryId : UNCATEGORIZED_ID,
    savedAt: typeof b.savedAt === 'string' && !Number.isNaN(Date.parse(b.savedAt)) ? b.savedAt : new Date(0).toISOString(),
    isShort: b.isShort === true
  };
}

async function load() {
  let data;
  try {
    data = await chrome.storage.local.get({ bookmarks: [], categories: null, settings: {} });
  } catch (err) {
    console.error('[TubeVault] storage read failed', err);
    throw new Error(STORAGE_ERROR);
  }
  return {
    bookmarks: Array.isArray(data.bookmarks) ? data.bookmarks.filter(isBookmark).map(normalizeBookmark) : [],
    categories: Array.isArray(data.categories)
      ? data.categories.filter(isCategory).map((c) => ({ id: c.id, name: c.name }))
      : DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    settings: data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings) ? data.settings : {}
  };
}

async function persist(values) {
  try {
    await chrome.storage.local.set(values);
  } catch (err) {
    console.error('[TubeVault] storage write failed', err);
    throw new Error(STORAGE_ERROR);
  }
}

function categoryExists(id, s) {
  return id === UNCATEGORIZED_ID || s.categories.some((c) => c.id === id);
}

function checkedName(name, categories, exceptId) {
  const raw = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
  if (!raw) throw new Error('Enter a category name.');
  if (raw.length > LIMITS.name) throw new Error(`Category names can be up to ${LIMITS.name} characters.`);
  const key = raw.toLowerCase();
  const taken =
    key === UNCATEGORIZED.name.toLowerCase() ||
    categories.some((c) => c.id !== exceptId && c.name.toLowerCase() === key);
  if (taken) throw new Error('A category with that name already exists.');
  return raw;
}

function newCategoryId() {
  return 'c_' + crypto.randomUUID().replace(/-/g, '').slice(0, 10);
}

/* ------------------------------ reading ------------------------------ */

/** Picks where one-click saves go: the last category used, else Watch Later, else Uncategorized. */
export function pickDefaultCategory(categories, settings = {}) {
  const ids = new Set([UNCATEGORIZED_ID, ...categories.map((c) => c.id)]);
  if (settings.lastCategoryId && ids.has(settings.lastCategoryId)) return settings.lastCategoryId;
  if (ids.has('watch-later')) return 'watch-later';
  return UNCATEGORIZED_ID;
}

export async function getState() {
  const s = await load();
  const categories = [...s.categories, UNCATEGORIZED];
  const valid = new Set(categories.map((c) => c.id));
  const bookmarks = s.bookmarks.map((b) => (valid.has(b.categoryId) ? b : { ...b, categoryId: UNCATEGORIZED_ID }));
  return { bookmarks, categories, settings: s.settings };
}

/** Pure helper: filter by title/notes and category, then sort. */
export function queryBookmarks(bookmarks, { query = '', categoryId = 'all', sort = 'newest' } = {}) {
  const q = query.trim().toLowerCase();
  const out = bookmarks.filter(
    (b) =>
      (categoryId === 'all' || b.categoryId === categoryId) &&
      (!q || b.title.toLowerCase().includes(q) || b.notes.toLowerCase().includes(q))
  );
  const byDate = (a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt);
  if (sort === 'oldest') out.sort((a, b) => -byDate(a, b));
  else if (sort === 'alpha') out.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }));
  else out.sort(byDate);
  return out;
}

export function countByCategory(bookmarks) {
  const counts = new Map();
  for (const b of bookmarks) counts.set(b.categoryId, (counts.get(b.categoryId) || 0) + 1);
  return counts;
}

/* ------------------------------ writing ------------------------------ */

/** Writes the default categories on first install, without touching existing data. */
export function ensureDefaults() {
  return locked(async () => {
    let data;
    try {
      data = await chrome.storage.local.get('categories');
    } catch (err) {
      console.error('[TubeVault] storage read failed', err);
      throw new Error(STORAGE_ERROR);
    }
    if (!Array.isArray(data.categories) || data.categories.length === 0) {
      await persist({ categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })) });
    }
  });
}

/** Returns { status: 'saved' | 'duplicate', bookmark }. Duplicates are detected by video ID. */
export function saveBookmark(input) {
  return locked(async () => {
    const videoId = input && input.videoId;
    if (!isValidVideoId(videoId)) throw new Error('This does not look like a valid YouTube video.');

    const s = await load();
    const existing = s.bookmarks.find((b) => b.videoId === videoId);
    if (existing) return { status: 'duplicate', bookmark: existing };

    const wanted = input.categoryId ?? pickDefaultCategory(s.categories, s.settings);
    const categoryId = categoryExists(wanted, s) ? wanted : UNCATEGORIZED_ID;
    const isShort = input.isShort === true;

    const bookmark = {
      id: crypto.randomUUID(),
      videoId,
      title: cleanLine(input.title, LIMITS.title) || 'Untitled video',
      url: watchUrl(videoId, isShort),
      thumbnail: thumbnailUrl(videoId),
      categoryId,
      savedAt: new Date().toISOString(),
      notes: cleanNotes(input.notes),
      isShort
    };

    await persist({
      bookmarks: [bookmark, ...s.bookmarks],
      settings: { ...s.settings, lastCategoryId: categoryId }
    });
    return { status: 'saved', bookmark };
  });
}

export function updateBookmark(id, patch) {
  return locked(async () => {
    const s = await load();
    const target = s.bookmarks.find((b) => b.id === id);
    if (!target) throw new Error('That bookmark no longer exists.');

    const settings = { ...s.settings };
    if ('categoryId' in patch) {
      if (!categoryExists(patch.categoryId, s)) throw new Error('That category no longer exists.');
      target.categoryId = patch.categoryId;
      settings.lastCategoryId = patch.categoryId;
    }
    if ('notes' in patch) target.notes = cleanNotes(patch.notes);

    await persist({ bookmarks: s.bookmarks, settings });
    return target;
  });
}

export function removeBookmark(id) {
  return locked(async () => {
    const s = await load();
    const next = s.bookmarks.filter((b) => b.id !== id);
    if (next.length === s.bookmarks.length) return false;
    await persist({ bookmarks: next });
    return true;
  });
}

export function addCategory(name) {
  return locked(async () => {
    const s = await load();
    const category = { id: newCategoryId(), name: checkedName(name, s.categories) };
    await persist({ categories: [...s.categories, category] });
    return category;
  });
}

export function renameCategory(id, name) {
  return locked(async () => {
    if (id === UNCATEGORIZED_ID) throw new Error('Uncategorized is built in and cannot be renamed.');
    const s = await load();
    const target = s.categories.find((c) => c.id === id);
    if (!target) throw new Error('That category no longer exists.');
    target.name = checkedName(name, s.categories, id);
    await persist({ categories: s.categories });
    return target;
  });
}

/** Deletes a category and moves its videos to another one. Videos are never deleted. */
export function deleteCategory(id, moveToId = UNCATEGORIZED_ID) {
  return locked(async () => {
    if (id === UNCATEGORIZED_ID) throw new Error('Uncategorized is built in and cannot be deleted.');
    const s = await load();
    if (!s.categories.some((c) => c.id === id)) throw new Error('That category no longer exists.');
    if (moveToId === id || !categoryExists(moveToId, s)) throw new Error('Choose a different category for the videos.');

    let moved = 0;
    for (const b of s.bookmarks) {
      if (b.categoryId === id) {
        b.categoryId = moveToId;
        moved++;
      }
    }
    const settings = { ...s.settings };
    if (settings.lastCategoryId === id) delete settings.lastCategoryId;
    await persist({
      bookmarks: s.bookmarks,
      categories: s.categories.filter((c) => c.id !== id),
      settings
    });
    return { moved };
  });
}

/* ------------------------------ export / import ------------------------------ */

export async function exportData() {
  const s = await load();
  return {
    app: 'TubeVault',
    version: 1,
    exportedAt: new Date().toISOString(),
    categories: s.categories,
    bookmarks: s.bookmarks.map((b) => ({
      id: b.id,
      videoId: b.videoId,
      title: b.title,
      url: b.url,
      thumbnail: b.thumbnail,
      categoryId: b.categoryId,
      savedAt: b.savedAt,
      notes: b.notes,
      isShort: b.isShort
    }))
  };
}

/**
 * Validates and merges an exported file. Never overwrites existing bookmarks;
 * entries whose video ID is already saved are skipped.
 */
export function importData(raw) {
  return locked(async () => {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.bookmarks)) {
      throw new Error('This file is not a TubeVault export. Choose a .json file created with Export.');
    }
    if (raw.bookmarks.length > LIMITS.importBookmarks) {
      throw new Error(`This file has more than ${LIMITS.importBookmarks} bookmarks, which is too many to import at once.`);
    }

    const s = await load();

    // 1. Categories: reuse by name, otherwise create. Builds importedId -> localId.
    const idMap = new Map();
    let categoriesAdded = 0;
    const importedCategories = Array.isArray(raw.categories) ? raw.categories : [];
    for (const c of importedCategories) {
      if (!c || typeof c.id !== 'string' || typeof c.name !== 'string') continue;
      const name = cleanLine(c.name, LIMITS.name);
      if (!name) continue;
      if (c.id === UNCATEGORIZED_ID || name.toLowerCase() === UNCATEGORIZED.name.toLowerCase()) {
        idMap.set(c.id, UNCATEGORIZED_ID);
        continue;
      }
      const sameName = s.categories.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (sameName) {
        idMap.set(c.id, sameName.id);
        continue;
      }
      const idUsable = /^[A-Za-z0-9_-]{1,40}$/.test(c.id) && !s.categories.some((x) => x.id === c.id);
      const created = { id: idUsable ? c.id : newCategoryId(), name };
      s.categories.push(created);
      idMap.set(c.id, created.id);
      categoriesAdded++;
    }

    // 2. Bookmarks.
    const seen = new Set(s.bookmarks.map((b) => b.videoId));
    const incoming = [];
    let duplicates = 0;
    let invalid = 0;

    for (const item of raw.bookmarks) {
      if (!item || typeof item !== 'object' || !isValidVideoId(item.videoId)) {
        invalid++;
        continue;
      }
      if (seen.has(item.videoId)) {
        duplicates++;
        continue;
      }
      seen.add(item.videoId);

      const mapped = idMap.get(item.categoryId);
      const categoryId = mapped ?? (categoryExists(item.categoryId, s) ? item.categoryId : UNCATEGORIZED_ID);
      const isShort =
        item.isShort === true || (typeof item.url === 'string' && parseYouTubeUrl(item.url)?.isShort === true);
      const savedAt =
        typeof item.savedAt === 'string' && !Number.isNaN(Date.parse(item.savedAt))
          ? new Date(item.savedAt).toISOString()
          : new Date().toISOString();

      incoming.push({
        id: crypto.randomUUID(),
        videoId: item.videoId,
        title: cleanLine(item.title, LIMITS.title) || 'Untitled video',
        url: watchUrl(item.videoId, isShort),
        thumbnail: thumbnailUrl(item.videoId),
        categoryId,
        savedAt,
        notes: cleanNotes(item.notes),
        isShort
      });
    }

    await persist({ bookmarks: [...s.bookmarks, ...incoming], categories: s.categories });
    return { added: incoming.length, duplicates, invalid, categoriesAdded };
  });
}
