/**
 * Monthly Debtor Report View for Project Pay.
 * Month selector, debtor breakdown, accurate total debt calculations, and payment shortcuts.
 */

import { fetchMonthlyDebtors } from '../api.js';
import { formatUzbekSom, formatMonthName, getCurrentLocalMonthString } from '../formatters.js';
import { el, clearElement } from '../dom.js';
import { createPageShell, createSectionToolbar } from '../pageLayout.js';

/**
 * Renders the Monthly Debtor Report view into the target container.
 *
 * @param {HTMLElement} container
 * @param {URLSearchParams} [queryParams]
 */
export async function renderDebtors(container, queryParams = new URLSearchParams()) {
  clearElement(container);

  let selectedMonth = queryParams.get('month') || getCurrentLocalMonthString();
  let activeRequestId = 0;

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
    id: 'debtor-month-input',
    className: 'form-input',
    value: selectedMonth,
    style: 'max-width: 200px;',
    onChange: (e) => {
      const newMonth = e.target.value;
      if (newMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(newMonth)) {
        selectedMonth = newMonth;
        loadReport();
      }
    }
  });

  const monthLabel = el('span', {
    id: 'report-month-label',
    style: 'font-weight: 600; color: var(--text-primary);'
  }, formatMonthName(selectedMonth));

  const filterToolbar = createSectionToolbar(
    [
      el('label', { className: 'form-label', for: 'debtor-month-input', style: 'margin-bottom: 0;' }, 'Hisobot oyi:'),
      monthInput
    ],
    monthLabel
  );

  const reportContent = el('div', { id: 'report-content' });

  const shell = createPageShell({
    header: pageHeader,
    toolbar: filterToolbar,
    body: reportContent
  });
  container.appendChild(shell.element);

  async function loadReport() {
    const requestId = ++activeRequestId;
    const targetMonth = selectedMonth;

    shell.resetScroll();
    clearElement(reportContent);
    monthLabel.textContent = formatMonthName(targetMonth);

    const loadingEl = el('div', { className: 'loading-indicator' },
      el('div', { className: 'spinner' }),
      el('p', {}, `${formatMonthName(targetMonth)} hisoboti yuklanmoqda...`)
    );
    reportContent.appendChild(loadingEl);

    try {
      const debtors = await fetchMonthlyDebtors(targetMonth);
      // Ignore stale responses if the user switched months while this request was in flight
      if (requestId !== activeRequestId) {
        return;
      }

      clearElement(reportContent);

      // Calculate total debt accurately using BigInt to prevent safe-integer overflow
      let totalDebt = 0n;
      let totalPaidInMonth = 0n;
      let isSafeDebt = true;
      let isSafePaid = true;

      for (const d of debtors) {
        if (Number.isSafeInteger(d.debt) && d.debt >= 0) {
          totalDebt += BigInt(d.debt);
        } else {
          isSafeDebt = false;
        }

        if (Number.isSafeInteger(d.total_paid) && d.total_paid >= 0) {
          totalPaidInMonth += BigInt(d.total_paid);
        } else {
          isSafePaid = false;
        }
      }

      // Summary Stats for this month
      const summaryCards = el('div', { className: 'stats-grid', style: 'margin-bottom: var(--space-6);' },
        el('div', { className: 'stat-card accent-amber' },
          el('span', { className: 'stat-label' }, 'Qarzdorlar soni'),
          el('div', { className: 'stat-value' }, `${debtors.length} nafar`),
          el('span', { className: 'stat-desc' }, `${formatMonthName(targetMonth)} bo'yicha`)
        ),
        el('div', { className: 'stat-card accent-red' },
          el('span', { className: 'stat-label' }, 'Jami qarz summasi'),
          el('div', { className: 'stat-value' }, isSafeDebt ? formatUzbekSom(totalDebt) : '—'),
          el('span', { className: 'stat-desc' }, 'Qoldiq to\'lanmagan summa')
        ),
        el('div', { className: 'stat-card accent-green' },
          el('span', { className: 'stat-label' }, 'Qarzdorlar to\'lagan summa'),
          el('div', { className: 'stat-value' }, isSafePaid ? formatUzbekSom(totalPaidInMonth) : '—'),
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

      let tableCard = null;
      const debtorsTableEl = renderDebtorsTable(debtors, targetMonth, () => {
        const nextTop = tableCard && Number.isFinite(tableCard.offsetTop)
          ? Math.max(0, tableCard.offsetTop - 8)
          : 0;
        shell.bodyEl.scrollTop = nextTop;
        shell.setScrolled(nextTop > 2);
      });

      tableCard = el('div', { className: debtors.length > 0 ? 'card card-table' : 'card' },
        el('div', { className: 'card-header' },
          el('h2', { className: 'card-title' }, `Qarzdor o'quvchilar ro'yxati (${formatMonthName(targetMonth)})`),
          el('span', { style: 'font-size: 0.8125rem; color: var(--text-muted);' },
            `Jami: ${debtors.length} nafar qarzdor`
          )
        ),
        el('div', { className: 'card-body', style: 'padding: 0;' },
          debtorsTableEl
        )
      );

      reportContent.appendChild(summaryCards);
      reportContent.appendChild(ruleNotice);
      reportContent.appendChild(tableCard);

    } catch (err) {
      if (requestId !== activeRequestId) {
        return;
      }
      clearElement(reportContent);
      reportContent.appendChild(
        el('div', { className: 'error-banner' },
          el('span', {}, err.message || 'Qarzdorlar hisobotini yuklashda xatolik yuz berdi.'),
          el('button', {
            type: 'button',
            className: 'btn btn-secondary btn-sm',
            onClick: loadReport
          }, 'Qayta urinish')
        )
      );
    }
  }

  await loadReport();
}

function renderDebtorsTable(debtors, monthStr, onPageChange = null) {
  if (debtors.length === 0) {
    return el('div', { className: 'empty-state' },
      el('div', { className: 'empty-state-icon' }, '✓'),
      el('h3', { className: 'empty-state-title' }, 'Qarzdorlik mavjud emas'),
      el('p', { className: 'empty-state-description' },
        `${formatMonthName(monthStr)} uchun barcha o'quvchilar belgilangan to'lovlarni to'liq amalga oshirgan yoki oylik to'lov stavkasi mavjud emas.`
      )
    );
  }

  const PAGE_SIZE = 100;
  let currentPage = 1;
  const totalPages = Math.max(1, Math.ceil(debtors.length / PAGE_SIZE));
  const wrapper = el('div', { className: 'table-container' });

  function renderPage() {
    clearElement(wrapper);
    const startIdx = (currentPage - 1) * PAGE_SIZE;
    const pageItems = debtors.slice(startIdx, startIdx + PAGE_SIZE);

    const tbody = el('tbody', {},
      ...pageItems.map((d) =>
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

    wrapper.appendChild(
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

    if (totalPages > 1) {
      wrapper.appendChild(
        el('div', { className: 'pagination-bar' },
          el('button', {
            type: 'button',
            className: 'btn btn-secondary btn-sm',
            disabled: currentPage <= 1,
            onClick: () => {
              if (currentPage > 1) {
                currentPage -= 1;
                renderPage();
                if (typeof onPageChange === 'function') onPageChange();
              }
            }
          }, '← Oldingi'),
          el('span', { className: 'pagination-info' }, `Sahifa ${currentPage} / ${totalPages}`),
          el('button', {
            type: 'button',
            className: 'btn btn-secondary btn-sm',
            disabled: currentPage >= totalPages,
            onClick: () => {
              if (currentPage < totalPages) {
                currentPage += 1;
                renderPage();
                if (typeof onPageChange === 'function') onPageChange();
              }
            }
          }, 'Keyingi →')
        )
      );
    }
  }

  renderPage();
  return wrapper;
}
