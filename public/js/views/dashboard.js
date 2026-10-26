/**
 * Dashboard View for Project Pay.
 * Shows real summary metrics and quick shortcuts.
 */

import { fetchStudents, fetchMonthlyDebtors } from '../api.js';
import { formatUzbekSom, formatMonthName, getCurrentLocalMonthString } from '../formatters.js';
import { el, clearElement } from '../dom.js';

/**
 * Renders the Dashboard view into the target container.
 *
 * @param {HTMLElement} container
 */
export async function renderDashboard(container) {
  clearElement(container);

  const loadingEl = el('div', { className: 'loading-indicator' },
    el('div', { className: 'spinner' }),
    el('p', {}, 'Bosh sahifa ma\'lumotlari yuklanmoqda...')
  );
  container.appendChild(loadingEl);

  const currentMonth = getCurrentLocalMonthString();

  try {
    const [students, debtors] = await Promise.all([
      fetchStudents(),
      fetchMonthlyDebtors(currentMonth)
    ]);

    clearElement(container);

    // Calculate total debt accurately from real debtor rows
    let totalDebt = 0;
    let totalCollected = 0;
    for (const d of debtors) {
      if (Number.isSafeInteger(d.debt)) totalDebt += d.debt;
      if (Number.isSafeInteger(d.total_paid)) totalCollected += d.total_paid;
    }

    // Page Header
    const pageHeader = el('div', { className: 'page-header' },
      el('div', {},
        el('h1', { className: 'page-title' }, 'Bosh sahifa'),
        el('p', { className: 'page-description' }, `Moliyaviy ko'rsatkichlar va ${formatMonthName(currentMonth)} holati`)
      ),
      el('div', { className: 'page-actions' },
        el('a', { href: '#/payments', className: 'btn btn-primary' },
          el('span', {}, '+'),
          'To\'lov kiritish'
        )
      )
    );

    // Stat Cards Grid
    const statsGrid = el('div', { className: 'stats-grid' },
      // Card 1: Students Count
      el('div', { className: 'stat-card' },
        el('span', { className: 'stat-label' }, 'Jami o\'quvchilar'),
        el('div', { className: 'stat-value' }, String(students.length)),
        el('span', { className: 'stat-desc' }, 'Tizimda ro\'yxatdan o\'tgan barcha o\'quvchilar')
      ),
      // Card 2: Current Month Debtors Count
      el('div', { className: 'stat-card accent-amber' },
        el('span', { className: 'stat-label' }, 'Joriy oy qarzdorlari'),
        el('div', { className: 'stat-value' }, `${debtors.length} nafar`),
        el('span', { className: 'stat-desc' }, `${formatMonthName(currentMonth)} bo'yicha qarzdorlar`)
      ),
      // Card 3: Total Outstanding Debt
      el('div', { className: 'stat-card accent-red' },
        el('span', { className: 'stat-label' }, 'Umumiy qarz miqdori'),
        el('div', { className: 'stat-value' }, formatUzbekSom(totalDebt)),
        el('span', { className: 'stat-desc' }, 'Joriy oyda to\'lanmagan qarzlar yig\'indisi')
      )
    );

    // Quick Actions Section
    const quickActionsGrid = el('div', { className: 'quick-actions-grid' },
      el('a', { href: '#/students?action=new', className: 'action-card' },
        el('div', { className: 'action-card-header' },
          el('div', { className: 'action-card-icon' }, '👥'),
          el('div', { className: 'action-card-title' }, 'Yangi o\'quvchi qo\'shish')
        ),
        el('div', { className: 'action-card-desc' }, 'O\'quvchi F.I.SH. va uning oylik to\'lov summasini belgilab tizimga qo\'shish.')
      ),
      el('a', { href: '#/payments', className: 'action-card' },
        el('div', { className: 'action-card-header' },
          el('div', { className: 'action-card-icon' }, '💳'),
          el('div', { className: 'action-card-title' }, 'To\'lov qabul qilish')
        ),
        el('div', { className: 'action-card-desc' }, 'Mavjud o\'quvchi hisobiga amalga oshirilgan to\'lov summasini kiritish.')
      ),
      el('a', { href: '#/debtors', className: 'action-card' },
        el('div', { className: 'action-card-header' },
          el('div', { className: 'action-card-icon' }, '📋'),
          el('div', { className: 'action-card-title' }, 'Qarzdorlar hisoboti')
        ),
        el('div', { className: 'action-card-desc' }, 'Oylar kesimida qarzdor o\'quvchilar ro\'yxati va to\'lov holatini tahlil qilish.')
      )
    );

    // Debtors Preview Table Card
    const previewCard = el('div', { className: 'card' },
      el('div', { className: 'card-header' },
        el('h2', { className: 'card-title' }, `${formatMonthName(currentMonth)} qarzdorlik holati`),
        el('a', { href: '#/debtors', className: 'btn btn-secondary btn-sm' }, 'Barcha qarzdorlarni ko\'rish →')
      ),
      el('div', { className: 'card-body', style: 'padding: 0;' },
        renderDebtorsPreviewTable(debtors)
      )
    );

    container.appendChild(pageHeader);
    container.appendChild(statsGrid);
    container.appendChild(quickActionsGrid);
    container.appendChild(previewCard);

  } catch (err) {
    clearElement(container);
    container.appendChild(
      el('div', { className: 'error-banner' },
        el('span', {}, err.message || 'Ma\'lumotlarni yuklashda xatolik yuz berdi.'),
        el('button', {
          className: 'btn btn-secondary btn-sm',
          onClick: () => renderDashboard(container)
        }, 'Qayta urinish')
      )
    );
  }
}

function renderDebtorsPreviewTable(debtors) {
  if (debtors.length === 0) {
    return el('div', { className: 'empty-state' },
      el('div', { className: 'empty-state-icon' }, '✓'),
      el('h3', { className: 'empty-state-title' }, 'Ajoyib! Joriy oyda hech qanday qarzdorlik yo\'q'),
      el('p', { className: 'empty-state-description' }, 'Barcha o\'quvchilar belgilangan oylik to\'lovlarini to\'liq to\'lagan.')
    );
  }

  // Preview up to 5 debtors
  const previewList = debtors.slice(0, 5);

  const tbody = el('tbody', {},
    ...previewList.map((d) =>
      el('tr', {},
        el('td', { style: 'font-weight: 500;' }, d.full_name),
        el('td', { className: 'col-numeric' }, formatUzbekSom(d.monthly_fee)),
        el('td', { className: 'col-numeric' }, formatUzbekSom(d.total_paid)),
        el('td', { className: 'col-numeric', style: 'color: var(--status-danger); font-weight: 600;' }, formatUzbekSom(d.debt)),
        el('td', { className: 'col-actions' },
          el('a', {
            href: `#/payments?student_id=${d.student_id}`,
            className: 'btn btn-secondary btn-sm'
          }, 'To\'lash')
        )
      )
    )
  );

  return el('div', { className: 'table-container' },
    el('table', { className: 'data-table' },
      el('thead', {},
        el('tr', {},
          el('th', {}, 'O\'quvchi F.I.SH.'),
          el('th', { className: 'col-numeric' }, 'Oylik to\'lov'),
          el('th', { className: 'col-numeric' }, 'To\'langan'),
          el('th', { className: 'col-numeric' }, 'Qoldiq qarz'),
          el('th', { className: 'col-actions' }, 'Harakat')
        )
      ),
      tbody
    )
  );
}
