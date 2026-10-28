/**
 * Shared Page Shell & Section Layout Helpers for Ecomdev.
 * Keeps section headings and action/filter toolbars persistent while
 * dedicating vertical scrolling to the section's content/table region.
 */

import { el, clearElement } from './dom.js';

/**
 * Renders a loading or error state inside a centered, padded container
 * that matches the application's max content width.
 *
 * @param {HTMLElement} container
 * @param {HTMLElement} stateNode
 */
export function renderStateView(container, stateNode) {
  clearElement(container);
  container.appendChild(
    el('div', { className: 'page-state-container' }, stateNode)
  );
}

/**
 * Builds a consistent action/filter toolbar card for section headers.
 *
 * @param {HTMLElement|Array<HTMLElement>} primaryControls
 * @param {HTMLElement|Array<HTMLElement>|null} [metaContent=null]
 * @returns {HTMLElement}
 */
export function createSectionToolbar(primaryControls, metaContent = null) {
  const left = Array.isArray(primaryControls) ? primaryControls : [primaryControls];
  const children = [
    el('div', { className: 'section-toolbar-group' }, ...left)
  ];

  if (metaContent !== null && metaContent !== undefined) {
    children.push(
      el('div', { className: 'section-toolbar-meta' }, metaContent)
    );
  }

  return el('div', { className: 'section-toolbar' }, ...children);
}

/**
 * Creates a persistent-header section shell with an independently scrollable
 * content region (or dedicated table-fit region when variant === 'table').
 *
 * @param {{
 *   header: HTMLElement,
 *   toolbar?: HTMLElement|null,
 *   body?: HTMLElement|Array<HTMLElement>|null,
 *   variant?: 'scroll'|'table'
 * }} options
 * @returns {{
 *   element: HTMLElement,
 *   topEl: HTMLElement,
 *   bodyEl: HTMLElement,
 *   bodyContainerEl: HTMLElement,
 *   setScrolled: (scrolled: boolean) => void,
 *   bindScrollTarget: (scrollEl: HTMLElement|null) => void,
 *   resetScroll: () => void
 * }}
 */
export function createPageShell({
  header,
  toolbar = null,
  body = null,
  variant = 'scroll'
}) {
  const isTableVariant = variant === 'table';

  const topContainerEl = el(
    'div',
    { className: 'page-shell-container' },
    header,
    toolbar
  );

  const topEl = el('div', { className: 'page-shell-top' }, topContainerEl);

  const bodyContainerEl = el(
    'div',
    {
      className: isTableVariant
        ? 'page-shell-container page-shell-container--table'
        : 'page-shell-container'
    },
    body
  );

  const bodyEl = el(
    'div',
    {
      className: isTableVariant
        ? 'page-shell-body page-shell-body--table'
        : 'page-shell-body'
    },
    bodyContainerEl
  );

  const shell = el(
    'section',
    {
      className: isTableVariant ? 'page-shell page-shell--table' : 'page-shell'
    },
    topEl,
    bodyEl
  );

  let activeScrollTarget = null;

  function setScrolled(scrolled) {
    if (scrolled) {
      shell.classList.add('is-scrolled');
    } else {
      shell.classList.remove('is-scrolled');
    }
  }

  function handleScroll(e) {
    const target = e.currentTarget || activeScrollTarget;
    const top = target && typeof target.scrollTop === 'number' ? target.scrollTop : 0;
    setScrolled(top > 2);
  }

  function bindScrollTarget(scrollEl) {
    if (activeScrollTarget && typeof activeScrollTarget.removeEventListener === 'function') {
      activeScrollTarget.removeEventListener('scroll', handleScroll);
    }
    activeScrollTarget = scrollEl || null;
    if (activeScrollTarget && typeof activeScrollTarget.addEventListener === 'function') {
      activeScrollTarget.addEventListener('scroll', handleScroll, { passive: true });
      const top = typeof activeScrollTarget.scrollTop === 'number' ? activeScrollTarget.scrollTop : 0;
      setScrolled(top > 2);
    } else {
      setScrolled(false);
    }
  }

  if (!isTableVariant) {
    bindScrollTarget(bodyEl);
  }

  function resetScroll() {
    if (activeScrollTarget) {
      activeScrollTarget.scrollTop = 0;
    }
    bodyEl.scrollTop = 0;
    setScrolled(false);
  }

  return {
    element: shell,
    topEl,
    bodyEl,
    bodyContainerEl,
    setScrolled,
    bindScrollTarget,
    resetScroll
  };
}
