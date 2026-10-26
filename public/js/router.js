/**
 * Client-Side Hash Router for Project Pay.
 * Maps hash URLs to views and updates active navigation state.
 */

import { renderDashboard } from './views/dashboard.js';
import { renderStudents } from './views/students.js';
import { renderStudentDetail } from './views/studentDetail.js';
import { renderGroups } from './views/groups.js';
import { renderPayments } from './views/payments.js';
import { renderDebtors } from './views/debtors.js';

export class Router {
  /**
   * @param {HTMLElement} container - Main content target element.
   */
  constructor(container) {
    this.container = container;
    this.routes = [
      { pattern: /^#\/?$/, handler: () => renderDashboard(this.container), navId: 'nav-dashboard' },
      { pattern: /^#\/dashboard\/?$/, handler: () => renderDashboard(this.container), navId: 'nav-dashboard' },
      { pattern: /^#\/students\/?$/, handler: (params) => renderStudents(this.container, params), navId: 'nav-students' },
      { pattern: /^#\/students\/(\d+)\/?$/, handler: (params, match) => renderStudentDetail(this.container, match[1]), navId: 'nav-students' },
      { pattern: /^#\/groups\/?$/, handler: (params) => renderGroups(this.container, params), navId: 'nav-groups' },
      { pattern: /^#\/payments\/?$/, handler: (params) => renderPayments(this.container, params), navId: 'nav-payments' },
      { pattern: /^#\/debtors\/?$/, handler: (params) => renderDebtors(this.container, params), navId: 'nav-debtors' }
    ];
  }

  init() {
    window.addEventListener('hashchange', () => this.handleRoute());
    this.handleRoute();
  }

  handleRoute() {
    const rawHash = window.location.hash || '#/';
    const [pathPart, queryPart] = rawHash.split('?');
    const queryParams = new URLSearchParams(queryPart || '');

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
        this.updateActiveNav(route.navId);
        window.scrollTo(0, 0);
        route.handler(queryParams, match);
        break;
      }
    }

    if (!matched) {
      // Fallback to dashboard
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
