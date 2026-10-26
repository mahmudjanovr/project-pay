/**
 * Reusable modal dialog utility for Project Pay.
 */

import { el, clearElement } from './dom.js';

let modalOverlay = null;

function getModalOverlay() {
  if (!modalOverlay) {
    modalOverlay = document.getElementById('modal-overlay');
    if (!modalOverlay) {
      modalOverlay = el('div', {
        id: 'modal-overlay',
        className: 'modal-overlay',
        role: 'dialog',
        'aria-modal': 'true',
        tabIndex: -1
      });
      document.body.appendChild(modalOverlay);
    }
  }
  return modalOverlay;
}

let activeCloseCallback = null;

/**
 * Opens a modal dialog with safe content.
 *
 * @param {{
 *   title: string,
 *   body: HTMLElement|Array<HTMLElement>,
 *   footer?: HTMLElement|Array<HTMLElement>,
 *   onClose?: () => void
 * }} config
 */
export function openModal({ title, body, footer, onClose }) {
  const overlay = getModalOverlay();
  clearElement(overlay);

  activeCloseCallback = onClose || null;

  const closeButton = el('button', {
    type: 'button',
    className: 'modal-close',
    'aria-label': 'Yopish',
    onClick: closeModal
  }, '×');

  const header = el('div', { className: 'modal-header' },
    el('h3', { className: 'modal-title' }, title),
    closeButton
  );

  const bodyContainer = el('div', { className: 'modal-body' }, body);

  const dialogChildren = [header, bodyContainer];

  if (footer) {
    const footerContainer = el('div', { className: 'modal-footer' }, footer);
    dialogChildren.push(footerContainer);
  }

  const dialog = el('div', { className: 'modal-dialog' }, ...dialogChildren);

  overlay.appendChild(dialog);

  // Close when clicking directly on overlay background
  overlay.onclick = (e) => {
    if (e.target === overlay) {
      closeModal();
    }
  };

  overlay.classList.add('active');

  // Keydown handler for Escape key
  document.addEventListener('keydown', handleKeyDown);

  // Auto-focus first input if present
  setTimeout(() => {
    const firstInput = dialog.querySelector('input, select, textarea, button:not(.modal-close)');
    if (firstInput) {
      firstInput.focus();
    }
  }, 50);
}

function handleKeyDown(e) {
  if (e.key === 'Escape') {
    closeModal();
  }
}

/**
 * Closes currently open modal dialog.
 */
export function closeModal() {
  const overlay = getModalOverlay();
  overlay.classList.remove('active');
  document.removeEventListener('keydown', handleKeyDown);

  if (typeof activeCloseCallback === 'function') {
    activeCloseCallback();
    activeCloseCallback = null;
  }
}
