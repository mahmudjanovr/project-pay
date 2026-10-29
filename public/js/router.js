/**
 * Client-Side Hash Router for Ecomdev.
 * Maps hash URLs to views and updates active navigation state.
 */

import { renderDashboard } from './views/dashboard.js';
import { renderStudents } from './views/students.js';
import { renderStudentDetail } from './views/studentDetail.js';
import { renderGroups } from './views/groups.js';
import { renderGroupDetail } from './views/groupDetail.js';
import { renderPayments } from './views/payments.js';
import { renderDebtors } from './views/debtors.js';
import { renderReports } from './views/reports.js';
import { closeModal } from './modal.js';
import { dismissAllToasts } from './notifications.js';
import { el, clearElement } from './dom.js';

export class Router {
  /**
   * @param {HTMLElement} container - Main content target element.
   */
  constructor(container) {
    this.container = container;
    this.navigationId = 0;
    this.activeCleanup = null;
    this.routes = [
      { pattern: /^#\/?$/, handler: (view) => renderDashboard(view), navId: 'nav-dashboard' },
      { pattern: /^#\/dashboard\/?$/, handler: (view) => renderDashboard(view), navId: 'nav-dashboard' },
      { pattern: /^#\/students\/?$/, handler: (view, params) => renderStudents(view, params), navId: 'nav-students' },
      { pattern: /^#\/students\/(\d+)\/?$/, handler: (view, params, match) => renderStudentDetail(view, match[1]), navId: 'nav-students' },
      { pattern: /^#\/groups\/?$/, handler: (view, params) => renderGroups(view, params), navId: 'nav-groups' },
      { pattern: /^#\/groups\/(\d+)\/?$/, handler: (view, params, match) => renderGroupDetail(view, match[1], params), navId: 'nav-groups' },
      { pattern: /^#\/payments\/?$/, handler: (view, params) => renderPayments(view, params), navId: 'nav-payments' },
      { pattern: /^#\/reports\/?$/, handler: (view, params) => renderReports(view, params), navId: 'nav-debtors' },
      { pattern: /^#\/debtors\/?$/, handler: (view, params) => renderDebtors(view, params), navId: 'nav-debtors' }
    ];
  }

  init() {
    if (
      (!window.location.hash || window.location.hash === '#') &&
      window.location.pathname &&
      window.location.pathname !== '/' &&
      window.location.pathname !== '/index.html' &&
      typeof window.history?.replaceState === 'function'
    ) {
      window.history.replaceState(
        null,
        '',
        `/#${window.location.pathname}${window.location.search || ''}`
      );
    }

    window.addEventListener('hashchange', () => this.handleRoute());
    this.handleRoute();
  }

  handleRoute() {
    const rawHash = window.location.hash || '#/';
    const [pathPart, queryPart] = rawHash.split('?');
    const queryParams = new URLSearchParams(queryPart || '');

    // Dismiss any open modal and run previous view cleanup on navigation
    closeModal();
    dismissAllToasts();
    if (typeof this.activeCleanup === 'function') {
      const cleanup = this.activeCleanup;
      this.activeCleanup = null;
      cleanup();
    }

    // Close mobile drawer if open
    const sidebar = document.getElementById('app-sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (sidebar && sidebar.classList.contains('open')) {
      sidebar.classList.remove('open');
      if (backdrop) backdrop.classList.remove('active');
    }

    let matched = false;

    for (const route of this.routes) {
      const match = pathPart.match(route.pattern);
      if (match) {
        matched = true;
        const navId = ++this.navigationId;
        this.updateActiveNav(route.navId);
        if (typeof window.scrollTo === 'function') {
          window.scrollTo(0, 0);
        }
        this.container.scrollTop = 0;

        // Mount an isolated per-navigation root so stale in-flight views never overwrite newer views
        clearElement(this.container);
        const viewRoot = el('div', {
          className: 'route-view-root'
        });
        this.container.appendChild(viewRoot);

        const result = route.handler(viewRoot, queryParams, match);
        if (result && typeof result.then === 'function') {
          result.then((cleanup) => {
            if (typeof cleanup === 'function') {
              if (this.navigationId === navId) {
                this.activeCleanup = cleanup;
              } else {
                cleanup();
              }
            }
          }).catch(() => {});
        } else if (typeof result === 'function') {
          this.activeCleanup = result;
        }
        break;
      }
    }

    if (!matched) {

      window.location.hash = '#/';
    }
  }

  updateActiveNav(activeId) {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach((item) => {
      if (item.id === activeId) {
        item.classList.add('active');
        item.setAttribute('aria-current', 'page');
      } else {
        item.classList.remove('active');
        item.removeAttribute('aria-current');
      }
    });
  }
}
