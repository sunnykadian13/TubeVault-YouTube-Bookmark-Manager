// YouTube URL helpers shared by the popup, dashboard, and service worker.
// (content.js cannot import modules, so it carries its own small copy of the parsing logic.)

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);

export function isValidVideoId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

/** Returns { videoId, isShort } for watch / Shorts / live / embed / youtu.be URLs, otherwise null. */
export function parseYouTubeUrl(raw) {
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;

  let id = null;
  let isShort = false;

  if (u.hostname === 'youtu.be') {
    id = u.pathname.split('/')[1];
  } else if (YT_HOSTS.has(u.hostname)) {
    if (u.pathname === '/watch') {
      id = u.searchParams.get('v');
    } else {
      const m = u.pathname.match(/^\/(shorts|live|embed)\/([^/?#]+)/);
      if (m) {
        id = m[2];
        isShort = m[1] === 'shorts';
      }
    }
  } else {
    return null;
  }
  return isValidVideoId(id) ? { videoId: id, isShort } : null;
}

export function watchUrl(videoId, isShort = false) {
  return isShort
    ? `https://www.youtube.com/shorts/${videoId}`
    : `https://www.youtube.com/watch?v=${videoId}`;
}

// mqdefault is a true 16:9 image (hqdefault has letterbox bars).
export function thumbnailUrl(videoId) {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

/** Only trust thumbnails hosted by YouTube's image CDN; otherwise rebuild from the video ID. */
export function safeThumbnail(bookmark) {
  const t = bookmark && bookmark.thumbnail;
  return typeof t === 'string' && t.startsWith('https://i.ytimg.com/')
    ? t
    : thumbnailUrl(bookmark.videoId);
}

/** The URL we open for a bookmark is always rebuilt from its video ID. */
export function bookmarkUrl(bookmark) {
  return watchUrl(bookmark.videoId, !!bookmark.isShort);
}

/** Strips "(3) " notification prefixes and the " - YouTube" suffix from page titles. */
export function cleanTitle(raw) {
  let t = String(raw ?? '').replace(/\s+/g, ' ').trim();
  t = t.replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube$/i, '').trim();
  if (!t || /^youtube$/i.test(t)) return '';
  return t.slice(0, 300);
}
