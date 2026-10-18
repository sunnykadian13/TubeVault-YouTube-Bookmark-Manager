// Tiny UI toolkit shared by the popup and dashboard. Everything is built with DOM APIs
// (textContent / createTextNode), so video titles and notes are never parsed as HTML.

import { safeThumbnail, bookmarkUrl } from './youtube.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DOM_PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'hidden']);

/** h('div', { class: 'x', onClick }, 'text', childNode, ...) */
export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, val] of Object.entries(props || {})) {
    if (val === undefined || val === null || val === false) continue;
    if (key === 'class') node.className = val;
    else if (key === 'dataset') Object.assign(node.dataset, val);
    else if (key.startsWith('on') && typeof val === 'function') node.addEventListener(key.slice(2).toLowerCase(), val);
    else if (DOM_PROPS.has(key)) node[key] = val;
    else node.setAttribute(key, val === true ? '' : String(val));
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/* ------------------------------ icons ------------------------------ */

const ICONS = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 1 0 0-14z M20 20l-3.5-3.5',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v5 M14 11v5',
  external: 'M14 4h6v6 M20 4l-9 9 M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  copy: 'M9 9h11v11H9z M5 15V5a1 1 0 0 1 1-1h10',
  edit: 'M4 20h4L19 9l-4-4L4 16v4z M13.5 6.5l4 4',
  plus: 'M12 5v14 M5 12h14',
  download: 'M12 4v11 M7 11l5 5 5-5 M5 20h14',
  upload: 'M12 16V5 M7 9l5-5 5 5 M5 20h14',
  folder: 'M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7z',
  check: 'M5 12l5 5 9-10',
  x: 'M6 6l12 12 M18 6L6 18',
  bookmark: 'M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z',
  layout: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z',
  play: 'M8 5v14l11-7z',
  alert: 'M12 4l9 16H3z M12 10v4 M12 17v.5'
};

export function icon(name, size = 16) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', name === 'play' ? 'currentColor' : 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICONS[name] || '');
  svg.append(path);
  return svg;
}

/** Icon-only button (or link when href is given). Always has an accessible label. */
export function iconButton(name, label, onClick, { danger = false, href = null } = {}) {
  const cls = 'icon-btn' + (danger ? ' danger' : '');
  if (href) {
    return h('a', { class: cls, href, target: '_blank', rel: 'noopener noreferrer', 'aria-label': label, title: label }, icon(name));
  }
  return h('button', { type: 'button', class: cls, 'aria-label': label, title: label, onClick }, icon(name));
}

/* ------------------------------ controls ------------------------------ */

export function selectEl(options, value, props = {}) {
  const el = h('select', { class: 'select', ...props });
  for (const o of options) el.append(h('option', { value: o.value }, o.label));
  if (value !== undefined && options.some((o) => o.value === value)) el.value = value;
  return el;
}

/** A 16:9 thumbnail link. Falls back to a play icon if the image cannot load. */
export function thumbLink(bookmark) {
  const img = h('img', { src: safeThumbnail(bookmark), alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
  const link = h(
    'a',
    { class: 'thumb', href: bookmarkUrl(bookmark), target: '_blank', rel: 'noopener noreferrer', tabindex: '-1', 'aria-hidden': 'true' },
    h('span', { class: 'thumb-fallback' }, icon('play', 22)),
    img,
    bookmark.isShort ? h('span', { class: 'badge' }, 'Short') : null
  );
  img.addEventListener('error', () => img.remove());
  return link;
}

/* ------------------------------ feedback ------------------------------ */

export function toast(message, type = 'info') {
  let container = document.getElementById('toasts');
  if (!container) {
    container = h('div', { id: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(container);
  }
  const node = h('div', { class: `toast toast-${type}` }, message);
  container.append(node);
  requestAnimationFrame(() => node.classList.add('show'));
  setTimeout(() => {
    node.classList.remove('show');
    setTimeout(() => node.remove(), 220);
  }, type === 'error' ? 4600 : 2600);
}

/**
 * Modal form. Resolves with the field values after onSubmit succeeds, or null if cancelled.
 * If onSubmit throws, the error is shown inside the dialog and it stays open.
 */
export function formDialog({ title, description, fields = [], confirmText = 'Save', cancelText = 'Cancel', danger = false, onSubmit }) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'dialog' });
    const controls = {};
    const errorEl = h('p', { class: 'form-error', role: 'alert' });
    let closed = false;

    const finish = (value) => {
      if (closed) return;
      closed = true;
      dlg.close();
      dlg.remove();
      resolve(value);
    };

    const cancelBtn = h('button', { type: 'button', class: 'btn', onClick: () => finish(null) }, cancelText);
    const submitBtn = h('button', { type: 'submit', class: `btn ${danger ? 'btn-danger' : 'btn-primary'}` }, confirmText);

    const fieldNodes = fields.map((f) => {
      const id = `f-${Math.random().toString(36).slice(2, 8)}-${f.name}`;
      let control;
      if (f.type === 'textarea') {
        control = h('textarea', { class: 'textarea', id, rows: 4, maxlength: f.maxLength, placeholder: f.placeholder, value: f.value ?? '' });
      } else if (f.type === 'select') {
        control = selectEl(f.options, f.value, { id });
      } else {
        control = h('input', { class: 'input', id, type: 'text', maxlength: f.maxLength, placeholder: f.placeholder, value: f.value ?? '', autocomplete: 'off' });
      }
      controls[f.name] = control;
      return h('div', { class: 'field' }, h('label', { for: id }, f.label), control, f.hint ? h('p', { class: 'hint' }, f.hint) : null);
    });

    const form = h(
      'form',
      {
        class: 'dialog-body',
        novalidate: true,
        onSubmit: async (event) => {
          event.preventDefault();
          errorEl.textContent = '';
          submitBtn.disabled = true;
          try {
            const values = Object.fromEntries(Object.entries(controls).map(([name, el]) => [name, el.value]));
            if (onSubmit) await onSubmit(values);
            finish(values);
          } catch (err) {
            errorEl.textContent = (err && err.message) || 'Something went wrong. Try again.';
            submitBtn.disabled = false;
          }
        }
      },
      h('h2', { class: 'dialog-title' }, title),
      description ? h('p', { class: 'dialog-text' }, description) : null,
      fieldNodes,
      errorEl,
      h('div', { class: 'dialog-actions' }, cancelBtn, submitBtn)
    );

    dlg.append(form);
    dlg.addEventListener('cancel', (event) => {
      event.preventDefault(); // Esc
      finish(null);
    });
    dlg.addEventListener('mousedown', (event) => {
      if (event.target === dlg) finish(null); // click on the backdrop
    });

    document.body.append(dlg);
    dlg.showModal();
    const first = Object.values(controls)[0];
    (first || cancelBtn).focus();
    if (first instanceof HTMLInputElement) first.select(); // pre-select text fields only, never notes
  });
}

/** Resolves true if the user confirms. Focus starts on Cancel so Enter never deletes by accident. */
export async function confirmDialog({ title, message, confirmText = 'Confirm', cancelText = 'Cancel', danger = false }) {
  const result = await formDialog({ title, description: message, confirmText, cancelText, danger });
  return result !== null;
}

/* ------------------------------ misc ------------------------------ */

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = h('textarea', { class: 'sr-only', 'aria-hidden': 'true', value: text });
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function formatSavedDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Unknown date';
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const diff = Math.round((day(new Date()) - day(d)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff > 1 && diff < 7) return `${diff} days ago`;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatFullDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

export function plural(n, one, many = one + 's') {
  return `${n} ${n === 1 ? one : many}`;
}
