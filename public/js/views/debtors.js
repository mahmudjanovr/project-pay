/**
 * Monthly Debtor Report View for Ecomdev.
 * Delegates to the unified Reports view with the 'debtors' tab active.
 */

import { renderReports } from './reports.js';

export async function renderDebtors(container, queryParams = new URLSearchParams()) {
  if (!queryParams.has('tab')) {
    queryParams.set('tab', 'debtors');
  }
  return renderReports(container, queryParams);
}
