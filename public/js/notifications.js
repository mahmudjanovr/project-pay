/**
 * Toast notifications manager for Project Pay.
 */

import { el } from './dom.js';

let container = null;

function getContainer() {
  if (
    !container ||
    container.isConnected === false ||
    (container.ownerDocument && container.ownerDocument !== document)
  ) {
    container = document.getElementById('toast-container');
    if (!container) {
      container = el('div', { id: 'toast-container', className: 'toast-container', 'aria-live': 'polite' });
      document.body.appendChild(container);
    }
  }
  return container;
}

/**
 * Displays a toast notification on screen.
 *
 * @param {string} message - User-facing message.
 * @param {'success'|'error'|'info'} [type='info'] - Notification style.
 * @param {string} [title] - Optional bold title.
 */
export function showToast(message, type = 'info', title = null) {
  const toastContainer = getContainer();

  // Keep at most 3 active toasts so notifications do not occlude top actions or fill screen
  while (toastContainer.children.length >= 3) {
    toastContainer.removeChild(toastContainer.firstChild);
  }

  const typeTitles = {
    success: 'Muvaffaqiyatli',
    error: 'Xatolik',
    info: 'Ma\'lumot'
  };

  const finalTitle = title || typeTitles[type] || 'Bildirishnoma';

  let timer = null;

  const closeBtn = el('button', {
    type: 'button',
    className: 'toast-close',
    'aria-label': 'Yopish',
    onClick: () => dismiss()
  }, '×');

  const content = el('div', { className: 'toast-content' },
    el('div', { className: 'toast-title' }, finalTitle),
    el('div', { className: 'toast-message' }, message)
  );

  const toast = el('div', {
    className: `toast toast-${type}`,
    role: 'alert'
  }, content, closeBtn);

  function dismiss() {
    if (timer) clearTimeout(timer);
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.2s ease';
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 200);
  }

  // Auto-dismiss after 4 seconds
  timer = setTimeout(dismiss, 4000);

  toastContainer.appendChild(toast);
}
