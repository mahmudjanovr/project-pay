/**
 * Monthly Debtor Report View for Project Pay.
 * Month selector, debtor breakdown, accurate total debt calculations, and payment shortcuts.
 */

import { fetchMonthlyDebtors } from '../api.js';
import { formatUzbekSom, formatMonthName, getCurrentLocalMonthString } from '../formatters.js';
import { el, clearElement } from '../dom.js';

/**
 * Renders the Monthly Debtor Report view into the target container.
 *
 * @param {HTMLElement} container
 * @param {URLSearchParams} [queryParams]
 */
export async function renderDebtors(container, queryParams = new URLSearchParams()) {
  clearElement(container);

  let selectedMonth = queryParams.get('month') || getCurrentLocalMonthString();

  // Validate format (YYYY-MM)
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(selectedMonth)) {
    selectedMonth = getCurrentLocalMonthString();
  }

  // Page Header
  const pageHeader = el('div', { className: 'page-header' },
    el('div', {},
      el('h1', { className: 'page-title' }, 'Qarzdorlar hisoboti'),
      el('p', { className: 'page-description' }, 'Oylik to\'lovlarini to\'liq amalga oshirmagan o\'quvchilar ro\'yxati')
    ),
    el('div', { className: 'page-actions' },
      el('a', {
        href: '#/payments',
        className: 'btn btn-primary'
      }, '+ To\'lov qabul qilish')
    )
  );

  // Month selector control
  const monthInput = el('input', {
    type: 'month',
    className: 'form-input',
    value: selectedMonth,
    style: 'max-width: 200px;',
    onChange: (e) => {
      const newMonth = e.target.value;
      if (newMonth && /^\d{4}-\d{2}$/.test(newMonth)) {
        selectedMonth = newMonth;
        loadReport();
      }
    }
  });

  const filterCard = el('div', { className: 'card', style: 'margin-bottom: var(--space-6);' },
    el('div', { className: 'card-body', style: 'padding: var(--space-4) var(--space-6); display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); flex-wrap: wrap;' },
      el('div', { style: 'display: flex; align-items: center; gap: var(--space-3);' },
        el('label', { className: 'form-label', style: 'margin-bottom: 0;' }, 'Hisobot oyi:'),
        monthInput
      ),
      el('span', { id: 'report-month-label', style: 'font-weight: 600; color: var(--text-primary);' },
        formatMonthName(selectedMonth)
      )
    )
  );

  const reportContent = el('div', { id: 'report-content' });

  container.appendChild(pageHeader);
  container.appendChild(filterCard);
  container.appendChild(reportContent);

  async function loadReport() {
    clearElement(reportContent);

    const monthLabel = document.getElementById('report-month-label');
    if (monthLabel) {
      monthLabel.textContent = formatMonthName(selectedMonth);
    }

    const loadingEl = el('div', { className: 'loading-indicator' },
      el('div', { className: 'spinner' }),
      el('p', {}, `${formatMonthName(selectedMonth)} hisoboti yuklanmoqda...`)
    );
    reportContent.appendChild(loadingEl);

    try {
      const debtors = await fetchMonthlyDebtors(selectedMonth);
      clearElement(reportContent);

      // Calculate total debt accurately using safe integer checks
      let totalDebt = 0;
      let totalPaidInMonth = 0;
      let isSafeCalculation = true;

      for (const d of debtors) {
        if (Number.isSafeInteger(d.debt) && Number.isSafeInteger(totalDebt)) {
          totalDebt += d.debt;
        } else {
          isSafeCalculation = false;
        }

        if (Number.isSafeInteger(d.total_paid) && Number.isSafeInteger(totalPaidInMonth)) {
          totalPaidInMonth += d.total_paid;
        }
      }

      // Summary Stats for this month
      const summaryCards = el('div', { className: 'stats-grid', style: 'margin-bottom: var(--space-6);' },
        el('div', { className: 'stat-card accent-amber' },
          el('span', { className: 'stat-label' }, 'Qarzdorlar soni'),
          el('div', { className: 'stat-value' }, `${debtors.length} nafar`),
          el('span', { className: 'stat-desc' }, `${formatMonthName(selectedMonth)} bo'yicha`)
        ),
        el('div', { className: 'stat-card accent-red' },
          el('span', { className: 'stat-label' }, 'Jami qarz summasi'),
          el('div', { className: 'stat-value' }, isSafeCalculation ? formatUzbekSom(totalDebt) : '—'),
          el('span', { className: 'stat-desc' }, 'Qoldiq to\'lanmagan summa')
        ),
        el('div', { className: 'stat-card accent-green' },
          el('span', { className: 'stat-label' }, 'Qarzdorlar to\'lagan summa'),
          el('div', { className: 'stat-value' }, formatUzbekSom(totalPaidInMonth)),
          el('span', { className: 'stat-desc' }, 'Shu oyda qisman qilingan to\'lovlar')
        )
      );

      // Business rule reminder banner
      const ruleNotice = el('div', {
        style: 'background-color: var(--bg-surface); border: 1px solid var(--border-light); border-radius: var(--radius-md); padding: var(--space-3) var(--space-4); margin-bottom: var(--space-6); font-size: 0.8125rem; color: var(--text-muted); display: flex; align-items: center; gap: var(--space-2);'
      },
        el('span', {}, 'ℹ️'),
        el('span', {}, 'Qarzdorlik har bir oy uchun qat\'iy alohida hisoblanadi. Boshqa oylardagi to\'lovlar yoki ortiqcha to\'lovlar tanlangan oy qarziga ta\'sir qilmaydi.')
      );

      const tableCard = el('div', { className: 'card' },
        el('div', { className: 'card-header' },
          el('h2', { className: 'card-title' }, `Qarzdor o'quvchilar ro'yxati (${formatMonthName(selectedMonth)})`),
          el('span', { style: 'font-size: 0.8125rem; color: var(--text-muted);' },
            `Jami: ${debtors.length} nafar qarzdor`
          )
        ),
        el('div', { className: 'card-body', style: 'padding: 0;' },
          renderDebtorsTable(debtors, selectedMonth)
        )
      );

      reportContent.appendChild(summaryCards);
      reportContent.appendChild(ruleNotice);
      reportContent.appendChild(tableCard);

    } catch (err) {
      clearElement(reportContent);
      reportContent.appendChild(
        el('div', { className: 'error-banner' },
          el('span', {}, err.message || 'Qarzdorlar hisobotini yuklashda xatolik yuz berdi.'),
          el('button', {
            className: 'btn btn-secondary btn-sm',
            onClick: loadReport
          }, 'Qayta urinish')
        )
      );
    }
  }

  loadReport();
}

function renderDebtorsTable(debtors, monthStr) {
  if (debtors.length === 0) {
    return el('div', { className: 'empty-state' },
      el('div', { className: 'empty-state-icon' }, '✓'),
      el('h3', { className: 'empty-state-title' }, 'Qarzdorlik mavjud emas'),
      el('p', { className: 'empty-state-description' },
        `${formatMonthName(monthStr)} uchun barcha o'quvchilar belgilangan to'lovlarni to'liq amalga oshirgan yoki oylik to'lov stavkasi mavjud emas.`
      )
    );
  }

  const tbody = el('tbody', {},
    ...debtors.map((d) =>
      el('tr', {},
        el('td', { style: 'font-weight: 500;' },
          el('a', {
            href: `#/students/${d.student_id}`,
            style: 'color: var(--text-primary); text-decoration: none;'
          }, d.full_name)
        ),
        el('td', { className: 'col-numeric' }, formatUzbekSom(d.monthly_fee)),
        el('td', { className: 'col-numeric', style: 'color: var(--accent-primary);' }, formatUzbekSom(d.total_paid)),
        el('td', { className: 'col-numeric', style: 'color: var(--status-danger); font-weight: 700;' }, formatUzbekSom(d.debt)),
        el('td', { className: 'col-actions' },
          el('a', {
            href: `#/payments?student_id=${d.student_id}`,
            className: 'btn btn-primary btn-sm'
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
          el('th', { className: 'col-numeric' }, 'Oylik stavka'),
          el('th', { className: 'col-numeric' }, 'To\'langan summa'),
          el('th', { className: 'col-numeric' }, 'Qoldiq qarz'),
          el('th', { className: 'col-actions' }, 'Harakat')
        )
      ),
      tbody
    )
  );
}
