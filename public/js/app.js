/**
 * Main Frontend Application Bootstrap for Ecomdev.
 */

import { Router } from './router.js';

document.addEventListener('DOMContentLoaded', () => {
  const contentContainer = document.getElementById('main-content');
  if (!contentContainer) {
    console.error('Main content container #main-content not found.');
    return;
  }

  // Setup mobile navigation toggle
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  const sidebar = document.getElementById('app-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');

  if (mobileMenuBtn && sidebar && backdrop) {
    mobileMenuBtn.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      backdrop.classList.toggle('active');
    });

    backdrop.addEventListener('click', () => {
      sidebar.classList.remove('open');
      backdrop.classList.remove('active');
    });
  }

  // Initialize client router
  const router = new Router(contentContainer);
  router.init();
});
