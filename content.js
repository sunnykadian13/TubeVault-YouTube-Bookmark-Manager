// TubeVault content script: adds a "Save to TubeVault" button on YouTube watch pages and Shorts.
// It survives YouTube's single-page navigation by listening for YouTube's navigation events
// and running a cheap once-per-second check that also re-adds the button if YouTube removes it.

(() => {
  'use strict';

  if (window.__tubeVaultInjected) return;
  window.__tubeVaultInjected = true;

  const BTN_CLASS = 'tv-save-btn';
  const STYLE_ID = 'tubevault-style';
  const TOAST_ID = 'tubevault-toast';
  const ID_RE = /^[A-Za-z0-9_-]{11}$/;
  const INLINE_WAIT_MS = 4000; // wait this long for YouTube's action row before floating the button

  // Places on a watch page where the button fits next to Like / Share. YouTube changes these
  // now and then; if none match, the button simply floats in the bottom-right corner.
  const INLINE_SELECTORS = [
    'ytd-watch-metadata #top-level-buttons-computed',
    'ytd-watch-metadata #actions-inner #menu',
    'ytd-watch-metadata #actions #menu',
    'ytd-watch-metadata #actions'
  ];

  const TITLE_SELECTORS_WATCH = [
    'ytd-watch-metadata h1 yt-formatted-string',
    'ytd-watch-metadata h1',
    'h1.ytd-watch-metadata'
  ];
  const TITLE_SELECTORS_SHORT = [
    'ytd-reel-video-renderer[is-active] yt-shorts-video-title-view-model h2',
    'ytd-reel-video-renderer[is-active] .ytShortsVideoTitleViewModelShortsVideoTitle',
    'ytd-reel-video-renderer[is-active] h2.title',
    'ytd-reel-video-renderer[is-active] .title'
  ];

  const CSS = `
.${BTN_CLASS}{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 14px;margin-left:8px;border-radius:18px;background:#8B5CF6;color:#fff;font:500 14px/1 Roboto,"Segoe UI",Arial,sans-serif;cursor:pointer;white-space:nowrap;transition:background .15s ease,box-shadow .15s ease}
.${BTN_CLASS}:hover{background:#9B72F8}
.${BTN_CLASS}:focus-visible{outline:2px solid #fff;outline-offset:2px}
.${BTN_CLASS} svg{width:18px;height:18px;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.${BTN_CLASS}[data-state="saved"]{background:rgba(139,92,246,.2);color:#D4C5FD;box-shadow:inset 0 0 0 1px rgba(139,92,246,.55)}
.${BTN_CLASS}[data-state="saved"] svg{fill:currentColor}
.${BTN_CLASS}[data-state="busy"]{opacity:.7;cursor:progress}
.${BTN_CLASS}.tv-floating{position:fixed;right:24px;bottom:24px;margin:0;z-index:2147483000;box-shadow:0 8px 24px rgba(0,0,0,.45)}
#${TOAST_ID}{position:fixed;left:50%;bottom:32px;transform:translate(-50%,8px);z-index:2147483001;max-width:min(420px,90vw);padding:10px 16px;border-radius:8px;background:#10131A;color:#E8EAF0;border:1px solid #2D3342;border-left:3px solid #8B5CF6;font:500 14px/1.35 Roboto,"Segoe UI",Arial,sans-serif;box-shadow:0 12px 32px rgba(0,0,0,.5);opacity:0;pointer-events:none;transition:opacity .2s ease,transform .2s ease}
#${TOAST_ID}.show{opacity:1;transform:translate(-50%,0)}
#${TOAST_ID}.error{border-left-color:#F26D78}
@media (prefers-reduced-motion:reduce){.${BTN_CLASS},#${TOAST_ID}{transition:none}}
`;

  let currentVideoId = null;
  let videoSince = 0;
  let saved = false;
  let busy = false;
  let toastTimer = 0;

  const alive = () => {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  };

  /* ------------------------------ page info ------------------------------ */

  function getPageVideo() {
    let url;
    try {
      url = new URL(location.href);
    } catch {
      return null;
    }
    let id = null;
    let isShort = false;
    if (url.pathname === '/watch') {
      id = url.searchParams.get('v');
    } else {
      const m = url.pathname.match(/^\/(shorts|live)\/([^/?#]+)/);
      if (m) {
        id = m[2];
        isShort = m[1] === 'shorts';
      }
    }
    return id && ID_RE.test(id) ? { videoId: id, isShort } : null;
  }

  function cleanTitle(raw) {
    let t = String(raw || '').replace(/\s+/g, ' ').trim();
    t = t.replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube$/i, '').trim();
    return /^youtube$/i.test(t) ? '' : t.slice(0, 300);
  }

  function readTitle(isShort) {
    const selectors = isShort ? TITLE_SELECTORS_SHORT : TITLE_SELECTORS_WATCH;
    for (const sel of selectors) {
      const node = document.querySelector(sel);
      const text = node ? cleanTitle(node.textContent) : '';
      if (text) return text;
    }
    return cleanTitle(document.title);
  }

  /* ------------------------------ button ------------------------------ */

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.documentElement).append(style);
  }

  function buildButton() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', 'M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z');
    svg.append(path);

    const label = document.createElement('span');
    label.className = 'tv-label';
    label.textContent = 'Save to TubeVault';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = BTN_CLASS;
    btn.append(svg, label);
    btn.addEventListener('click', onClick);
    return btn;
  }

  function findInlineHost() {
    for (const sel of INLINE_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }
    return null;
  }

  function render() {
    const btn = document.querySelector('.' + BTN_CLASS);
    if (!btn) return;
    const state = busy ? 'busy' : saved ? 'saved' : 'idle';
    const text = busy ? 'Saving…' : saved ? 'Already Saved' : 'Save to TubeVault';
    if (btn.dataset.state !== state) btn.dataset.state = state;
    const label = btn.querySelector('.tv-label');
    if (label && label.textContent !== text) label.textContent = text;
  }

  function ensureButton() {
    if (!alive()) return;

    const buttons = document.querySelectorAll('.' + BTN_CLASS);
    buttons.forEach((node, i) => {
      if (i > 0) node.remove(); // never allow duplicates
    });
    let btn = buttons[0] || null;

    const video = getPageVideo();
    if (!video) {
      if (btn) btn.remove();
      currentVideoId = null;
      return;
    }

    if (currentVideoId !== video.videoId) {
      currentVideoId = video.videoId;
      videoSince = Date.now();
      saved = false;
      refreshSaved();
    }

    const host = video.isShort ? null : findInlineHost();
    if (!btn && !host && !video.isShort && Date.now() - videoSince < INLINE_WAIT_MS) return;

    if (!btn) btn = buildButton();

    if (host) {
      btn.classList.remove('tv-floating');
      if (btn.parentElement !== host) host.append(btn);
    } else {
      btn.classList.add('tv-floating');
      if (btn.parentElement !== document.body) document.body.append(btn);
    }
    render();
  }

  /* ------------------------------ saving ------------------------------ */

  async function refreshSaved() {
    if (!alive()) return;
    const id = currentVideoId;
    let isSaved = false;
    try {
      const data = await chrome.storage.local.get({ bookmarks: [] });
      isSaved = Array.isArray(data.bookmarks) && data.bookmarks.some((b) => b && b.videoId === id);
    } catch {
      isSaved = false;
    }
    if (id !== currentVideoId) return; // user navigated while we were reading
    saved = isSaved;
    render();
  }

  function showToast(message, type) {
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement('div');
      toast.id = TOAST_ID;
      toast.setAttribute('role', 'status');
      document.body.append(toast);
    }
    toast.textContent = message;
    toast.classList.toggle('error', type === 'error');
    // force a reflow so the transition replays when toasts follow each other
    void toast.offsetWidth;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), type === 'error' ? 4500 : 2600);
  }

  function friendlyError(err) {
    const msg = err && err.message ? err.message : '';
    if (/context invalidated|receiving end does not exist/i.test(msg)) {
      return 'TubeVault was updated. Refresh this page, then try again.';
    }
    return msg || 'Could not save this video.';
  }

  async function onClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const video = getPageVideo();
    if (!video || busy) return;
    if (saved) {
      showToast('Already saved in TubeVault');
      return;
    }

    busy = true;
    render();
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'TV_SAVE_VIDEO',
        video: { videoId: video.videoId, isShort: video.isShort, title: readTitle(video.isShort) }
      });
      if (!response) throw new Error('TubeVault did not respond. Try again in a moment.');
      if (!response.ok) throw new Error(response.error || 'Could not save this video.');
      saved = true;
      showToast(response.status === 'duplicate' ? 'Already saved in TubeVault' : 'Saved to ' + response.categoryName);
    } catch (err) {
      showToast(friendlyError(err), 'error');
    } finally {
      busy = false;
      render();
    }
  }

  /* ------------------------------ wiring ------------------------------ */

  // The popup asks the page for the freshest title and video info.
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== 'TV_GET_VIDEO_INFO' || sender.id !== chrome.runtime.id) return false;
    const video = getPageVideo();
    sendResponse(video ? { videoId: video.videoId, isShort: video.isShort, title: readTitle(video.isShort) } : null);
    return false;
  });

  // Keep the button honest when bookmarks change elsewhere (popup, dashboard, another tab).
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.bookmarks) refreshSaved();
  });

  let queued = 0;
  const ensureSoon = () => {
    clearTimeout(queued);
    queued = setTimeout(ensureButton, 150);
  };

  injectStyle();
  ensureButton();

  window.addEventListener('yt-navigate-finish', ensureSoon);
  window.addEventListener('yt-page-data-updated', ensureSoon);
  window.addEventListener('popstate', ensureSoon);

  // Safety net: catches Shorts scrolling, re-rendered action rows and missed events.
  const watchdog = setInterval(() => {
    if (!alive()) {
      clearInterval(watchdog);
      return;
    }
    ensureButton();
  }, 1000);
})();
