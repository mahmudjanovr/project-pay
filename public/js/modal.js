/**
 * Reusable modal dialog utility for Ecomdev.
 */

import { el, clearElement } from './dom.js';

let modalOverlay = null;

function getModalOverlay() {
  if (
    !modalOverlay ||
    modalOverlay.isConnected === false ||
    (modalOverlay.ownerDocument && modalOverlay.ownerDocument !== document)
  ) {
    modalOverlay = document.getElementById('modal-overlay');
    if (!modalOverlay) {
      modalOverlay = el('div', {
        id: 'modal-overlay',
        className: 'modal-overlay',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-hidden': 'true',
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

  // Invoke any previous modal cleanup before replacing modal content
  if (typeof activeCloseCallback === 'function') {
    const prevCallback = activeCloseCallback;
    activeCloseCallback = null;
    prevCallback();
  }

  clearElement(overlay);
  activeCloseCallback = onClose || null;

  const closeButton = el('button', {
    type: 'button',
    className: 'modal-close',
    'aria-label': 'Yopish',
    onClick: closeModal
  }, '×');

  const header = el('div', { className: 'modal-header' },
    el('h3', { className: 'modal-title', id: 'modal-dialog-title' }, title),
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
  overlay.setAttribute('aria-labelledby', 'modal-dialog-title');
  overlay.setAttribute('aria-hidden', 'false');

  // Close when clicking directly on overlay background
  overlay.onclick = (e) => {
    if (e.target === overlay) {
      closeModal();
    }
  };

  overlay.classList.add('active');

  // Keydown handler for Escape key
  document.removeEventListener('keydown', handleKeyDown);
  document.addEventListener('keydown', handleKeyDown);

  // Auto-focus first visible interactive control if modal remains open
  setTimeout(() => {
    if (!overlay.classList.contains('active')) return;
    const candidates = Array.from(
      dialog.querySelectorAll('input, select, textarea, button:not(.modal-close)')
    );
    const firstInput = candidates.find((node) => node.getAttribute('type') !== 'hidden');
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
  const isOpen = overlay.classList.contains('active');
  if (!isOpen && !activeCloseCallback) {
    return;
  }

  overlay.classList.remove('active');
  overlay.setAttribute('aria-hidden', 'true');
  document.removeEventListener('keydown', handleKeyDown);

  if (typeof activeCloseCallback === 'function') {
    const callback = activeCloseCallback;
    activeCloseCallback = null;
    callback();
  }
}
