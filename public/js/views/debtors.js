/**
 * Monthly & Annual Debtor Reporting View for Project Pay.
 * Provides monthly breakdown with accurate debt calculations, payment shortcuts,
 * and annual calendar-year collections & 12-month breakdowns.
 * Preserves scroll position and stable document flow across filter and data updates.
 */

import { fetchMonthlyDebtors, fetchAnnualReport } from '../api.js';
import { formatUzbekSom, formatMonthName, getCurrentLocalMonthString } from '../formatters.js';
import { el, clearElement } from '../dom.js';
import { createPageShell, createSectionToolbar } from '../pageLayout.js';

/**
 * Renders the Debtor and Financial Reporting view into the target container.
 *
 * @param {HTMLElement} container
 * @param {URLSearchParams} [queryParams]
 */
export async function renderDebtors(container, queryParams = new URLSearchParams()) {
  clearElement(container);

  let activeMode = queryParams.get('view') === 'annual' ? 'annual' : 'monthly';
  let selectedMonth = queryParams.get('month') || getCurrentLocalMonthString();
  let selectedYear = queryParams.get('year') || selectedMonth.slice(0, 4);

  let activeMonthlyRequestId = 0;
  let activeAnnualRequestId = 0;
  let activeMonthlyAbortController = null;
  let activeAnnualAbortController = null;

  // Validate format (YYYY-MM)
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(selectedMonth)) {
    selectedMonth = getCurrentLocalMonthString();
  }
  if (!/^\d{4}$/.test(selectedYear)) {
    selectedYear = selectedMonth.slice(0, 4);
  }

  // Page Header
  const pageHeader = el('div', { className: 'page-header' },
    el('div', {},
      el('h1', { className: 'page-title' }, 'Qarzdorlar hisoboti'),
      el('p', { className: 'page-description' }, 'Oylar va yillar kesimida to\'lovlar hamda qarzdorlik tahlili')
    ),
    el('div', { className: 'page-actions' },
      el('a', {
        href: '#/payments',
        className: 'btn btn-primary'
      }, '+ To\'lov qabul qilish')
    )
  );

  // View Mode Switcher Buttons (Oylik / Yillik)
  const monthlyModeBtn = el('button', {
    type: 'button',
    className: `view-switch-btn ${activeMode === 'monthly' ? 'active' : ''}`,
    onClick: () => switchMode('monthly')
  }, 'Oylik hisobot');

  const annualModeBtn = el('button', {
    type: 'button',
    className: `view-switch-btn ${activeMode === 'annual' ? 'active' : ''}`,
    onClick: () => switchMode('annual')
  }, 'Yillik hisobot');

  const viewSwitcher = el('div', { className: 'view-switch', 'aria-label': 'Hisobot davri turi' },
    monthlyModeBtn,
    annualModeBtn
  );

  // Month selector control (Monthly Mode)
  const onMonthChange = (e) => {
    const newMonth = e.target.value;
    if (newMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(newMonth)) {
      if (selectedMonth !== newMonth) {
        selectedMonth = newMonth;
        loadMonthlyReport();
      }
    }
  };

  const monthInput = el('input', {
    type: 'month',
    id: 'debtor-month-input',
    className: 'form-input',
    value: selectedMonth,
    style: 'max-width: 180px;',
    onChange: onMonthChange,
    onInput: onMonthChange
  });

  const monthControlGroup = el('div', {
    id: 'monthly-controls-group',
    style: `display: ${activeMode === 'monthly' ? 'inline-flex' : 'none'}; align-items: center; gap: var(--space-2);`
  },
    el('label', { className: 'form-label', for: 'debtor-month-input', style: 'margin-bottom: 0; white-space: nowrap;' }, 'Hisobot oyi:'),
    monthInput
  );

  // Year selector control (Annual Mode)
  const currentYearNum = new Date().getFullYear();
  const yearOptions = [];
  for (let y = currentYearNum + 1; y >= currentYearNum - 4; y--) {
    yearOptions.push(el('option', { value: String(y), selected: String(y) === selectedYear ? true : undefined }, `${y}-yil`));
  }

  const onYearChange = (e) => {
    const newYear = e.target.value;
    if (newYear && /^\d{4}$/.test(newYear)) {
      if (selectedYear !== newYear) {
        selectedYear = newYear;
        loadAnnualReport();
      }
    }
  };

  const yearSelect = el('select', {
    id: 'annual-year-select',
    className: 'form-select',
    style: 'max-width: 140px;',
    onChange: onYearChange,
    onInput: onYearChange
  }, ...yearOptions);

  const yearControlGroup = el('div', {
    id: 'annual-controls-group',
    style: `display: ${activeMode === 'annual' ? 'inline-flex' : 'none'}; align-items: center; gap: var(--space-2);`
  },
    el('label', { className: 'form-label', for: 'annual-year-select', style: 'margin-bottom: 0; white-space: nowrap;' }, 'Hisobot yili:'),
    yearSelect
  );

  const periodLabel = el('span', {
    id: 'report-month-label',
    style: 'font-weight: 600; color: var(--text-primary);'
  }, activeMode === 'monthly' ? formatMonthName(selectedMonth) : `${selectedYear}-yil`);

  const filterToolbar = createSectionToolbar(
    [
      viewSwitcher,
      monthControlGroup,
      yearControlGroup
    ],
    periodLabel
  );

  // ==========================================================================
  // Single Persistent Stats Grid & Notice & Table Shell
  // ==========================================================================
  const statVal1 = el('div', { className: 'stat-value' }, '—');
  const statVal2 = el('div', { className: 'stat-value' }, '—');
  const statVal3 = el('div', { className: 'stat-value' }, '—');

  const statLabel1 = el('span', { className: 'stat-label' }, 'Qarzdorlar soni');
  const statLabel2 = el('span', { className: 'stat-label' }, 'Jami qarz summasi');
  const statLabel3 = el('span', { className: 'stat-label' }, 'Qarzdorlar to\'lagan summa');

  const statDesc1 = el('span', { className: 'stat-desc' }, `${formatMonthName(selectedMonth)} bo'yicha`);
  const statDesc2 = el('span', { className: 'stat-desc' }, 'Qoldiq to\'lanmagan summa');
  const statDesc3 = el('span', { className: 'stat-desc' }, 'Shu oyda qisman qilingan to\'lovlar');

  const statCard1 = el('div', { className: 'stat-card accent-amber' }, statLabel1, statVal1, statDesc1);
  const statCard2 = el('div', { className: 'stat-card accent-red' }, statLabel2, statVal2, statDesc2);
  const statCard3 = el('div', { className: 'stat-card accent-green' }, statLabel3, statVal3, statDesc3);

  const statsGrid = el('div', { className: 'stats-grid' }, statCard1, statCard2, statCard3);

  const noticeText = el('span', {}, 'Qarzdorlik har bir oy uchun qat\'iy alohida hisoblanadi. Boshqa oylardagi to\'lovlar yoki ortiqcha to\'lovlar tanlangan oy qarziga ta\'sir qilmaydi.');
  const noticeBanner = el('div', {
    style: 'background-color: var(--bg-surface); border: 1px solid var(--border-light); border-radius: var(--radius-md); padding: var(--space-3) var(--space-4); margin-bottom: var(--space-6); font-size: 0.8125rem; color: var(--text-muted); display: flex; align-items: center; gap: var(--space-2);'
  },
    el('span', {}, 'ℹ️'),
    noticeText
  );

  const contentCard = el('div', { className: 'card' });

  const reportContent = el('div', { id: 'report-content' },
    statsGrid,
    noticeBanner,
    contentCard
  );

  const shell = createPageShell({
    header: pageHeader,
    toolbar: filterToolbar,
    body: reportContent
  });
  container.appendChild(shell.element);

  function syncUrl() {
    if (typeof window.history?.replaceState === 'function') {
      const url = activeMode === 'annual'
        ? `/#/debtors?view=annual&year=${encodeURIComponent(selectedYear)}`
        : `/#/debtors?month=${encodeURIComponent(selectedMonth)}`;
      window.history.replaceState(null, '', url);
    }
  }

  function switchMode(newMode) {
    if (activeMode === newMode) return;
    activeMode = newMode;

    if (activeMode === 'monthly') {
      monthlyModeBtn.classList.add('active');
      annualModeBtn.classList.remove('active');
      monthControlGroup.style.display = 'inline-flex';
      yearControlGroup.style.display = 'none';

      statCard1.className = 'stat-card accent-amber';
      statCard2.className = 'stat-card accent-red';
      statCard3.className = 'stat-card accent-green';

      statLabel1.textContent = 'Qarzdorlar soni';
      statLabel2.textContent = 'Jami qarz summasi';
      statLabel3.textContent = 'Qarzdorlar to\'lagan summa';

      statDesc1.textContent = `${formatMonthName(selectedMonth)} bo'yicha`;
      statDesc2.textContent = 'Qoldiq to\'lanmagan summa';
      statDesc3.textContent = 'Shu oyda qisman qilingan to\'lovlar';

      noticeText.textContent = 'Qarzdorlik har bir oy uchun qat\'iy alohida hisoblanadi. Boshqa oylardagi to\'lovlar yoki ortiqcha to\'lovlar tanlangan oy qarziga ta\'sir qilmaydi.';
      periodLabel.textContent = formatMonthName(selectedMonth);

      syncUrl();
      loadMonthlyReport();
    } else {
      monthlyModeBtn.classList.remove('active');
      annualModeBtn.classList.add('active');
      monthControlGroup.style.display = 'none';
      yearControlGroup.style.display = 'inline-flex';

      statCard1.className = 'stat-card accent-green';
      statCard2.className = 'stat-card accent-amber';
      statCard3.className = 'stat-card';

      statLabel1.textContent = 'Yillik jami tushum';
      statLabel2.textContent = 'To\'lov qilgan o\'quvchilar';
      statLabel3.textContent = 'Jami to\'lovlar soni';

      statDesc1.textContent = `${selectedYear}-yilda qabul qilingan barcha to'lovlar`;
      statDesc2.textContent = 'Kamida 1 marta to\'lov qilgan talabalar';
      statDesc3.textContent = 'Yil davomidagi kiritilgan to\'lov cheklari';

      noticeText.textContent = 'Yillik tushum ko\'rsatkichi tanlangan yilda kiritilgan to\'lov sanalari (payment_date) asosida aniq shakllantirilgan. Oylik qarzlar va kutilgan to\'lovlar tizimdagi o\'quvchilarning amaldagi oylik to\'lov stavkalari asosida hisoblangan.';
      periodLabel.textContent = `${selectedYear}-yil`;

      syncUrl();
      loadAnnualReport();
    }
  }

  let isFirstMonthlyLoad = true;

  // ==========================================================================
  // Monthly Report Loader & View
  // ==========================================================================
  async function loadMonthlyReport() {
    const requestId = ++activeMonthlyRequestId;
    const targetMonth = selectedMonth;

    if (activeMonthlyAbortController) {
      activeMonthlyAbortController.abort();
    }
    activeMonthlyAbortController = new AbortController();
    const { signal } = activeMonthlyAbortController;

    periodLabel.textContent = formatMonthName(targetMonth);
    monthInput.value = targetMonth;
    statDesc1.textContent = `${formatMonthName(targetMonth)} bo'yicha`;
    syncUrl();

    if (isFirstMonthlyLoad) {
      clearElement(contentCard);
      contentCard.className = 'card';
      contentCard.appendChild(
        el('div', { className: 'loading-indicator', style: 'min-height: 240px; display: flex; flex-direction: column; align-items: center; justify-content: center;' },
          el('div', { className: 'spinner' }),
          el('p', {}, `${formatMonthName(targetMonth)} hisoboti yuklanmoqda...`)
        )
      );
    } else {
      contentCard.style.opacity = '0.7';
    }

    try {
      const debtors = await fetchMonthlyDebtors(targetMonth, { signal });
      if (requestId !== activeMonthlyRequestId) return;

      contentCard.style.opacity = '1';
      clearElement(contentCard);
      isFirstMonthlyLoad = false;

      // Accurate debt sum using BigInt
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

      statVal1.textContent = `${debtors.length} nafar`;
      statVal2.textContent = isSafeDebt ? formatUzbekSom(totalDebt) : '—';
      statVal3.textContent = isSafePaid ? formatUzbekSom(totalPaidInMonth) : '—';

      if (debtors.length === 0) {
        contentCard.className = 'card';
        contentCard.appendChild(
          renderDebtorsTable([], targetMonth)
        );
      } else {
        contentCard.className = 'card card-table';
        contentCard.appendChild(
          el('div', { className: 'card-header' },
            el('h2', { className: 'card-title' }, `Qarzdor o'quvchilar ro'yxati (${formatMonthName(targetMonth)})`),
            el('span', { style: 'font-size: 0.8125rem; color: var(--text-muted);' },
              `Jami: ${debtors.length} nafar qarzdor`
            )
          )
        );
        contentCard.appendChild(
          el('div', { className: 'card-body', style: 'padding: 0;' },
            renderDebtorsTable(debtors, targetMonth)
          )
        );
      }

    } catch (err) {
      if (err && err.name === 'AbortError') return;
      if (requestId !== activeMonthlyRequestId) return;

      contentCard.style.opacity = '1';
      clearElement(contentCard);
      contentCard.className = 'card';
      contentCard.appendChild(
        el('div', { className: 'error-banner' },
          el('span', {}, err.message || 'Qarzdorlar hisobotini yuklashda xatolik yuz berdi.'),
          el('button', {
            type: 'button',
            className: 'btn btn-secondary btn-sm',
            onClick: loadMonthlyReport
          }, 'Qayta urinish')
        )
      );
    }
  }

  let isFirstAnnualLoad = true;

  // ==========================================================================
  // Annual Report Loader & View
  // ==========================================================================
  async function loadAnnualReport() {
    const requestId = ++activeAnnualRequestId;
    const targetYear = selectedYear;

    if (activeAnnualAbortController) {
      activeAnnualAbortController.abort();
    }
    activeAnnualAbortController = new AbortController();
    const { signal } = activeAnnualAbortController;

    periodLabel.textContent = `${targetYear}-yil`;
    yearSelect.value = targetYear;
    statDesc1.textContent = `${targetYear}-yilda qabul qilingan barcha to'lovlar`;
    syncUrl();

    if (isFirstAnnualLoad) {
      clearElement(contentCard);
      contentCard.className = 'card';
      contentCard.appendChild(
        el('div', { className: 'loading-indicator', style: 'min-height: 240px; display: flex; flex-direction: column; align-items: center; justify-content: center;' },
          el('div', { className: 'spinner' }),
          el('p', {}, `${targetYear}-yil bo'yicha yillik hisobot yuklanmoqda...`)
        )
      );
    } else {
      contentCard.style.opacity = '0.7';
    }

    try {
      const data = await fetchAnnualReport(targetYear, { signal });
      if (requestId !== activeAnnualRequestId) return;

      contentCard.style.opacity = '1';
      clearElement(contentCard);
      isFirstAnnualLoad = false;

      statVal1.textContent = formatUzbekSom(data.total_collected);
      statVal2.textContent = `${data.paying_student_count} nafar`;
      statVal3.textContent = `${data.payment_count} ta`;

      // Annual 12-Month Table
      const tableRows = data.months.map((m) => {
        return el('tr', {},
          el('td', { style: 'font-weight: 600;' },
            el('div', {}, m.month_name),
            el('small', { style: 'color: var(--text-muted); font-size: 0.75rem;' }, m.month)
          ),
          el('td', { className: 'col-numeric', style: 'color: var(--accent-primary); font-weight: 600;' },
            formatUzbekSom(m.total_collected)
          ),
          el('td', { className: 'col-numeric' }, `${m.payment_count} ta`),
          el('td', { className: 'col-numeric' }, `${m.paying_student_count} nafar`),
          el('td', { className: 'col-numeric', style: m.debtor_count > 0 ? 'color: var(--status-warning); font-weight: 600;' : '' },
            `${m.debtor_count} nafar`
          ),
          el('td', { className: 'col-numeric', style: m.total_debt > 0 ? 'color: var(--status-danger); font-weight: 700;' : 'color: var(--text-muted);' },
            formatUzbekSom(m.total_debt)
          ),
          el('td', { className: 'col-actions' },
            el('button', {
              type: 'button',
              className: 'btn btn-secondary btn-sm',
              title: `${m.month_name} oylik hisobotiga o'tish`,
              onClick: () => {
                selectedMonth = m.month;
                switchMode('monthly');
              }
            }, 'Oylik hisobot')
          )
        );
      });

      contentCard.className = 'card card-table';
      contentCard.appendChild(
        el('div', { className: 'card-header' },
          el('h2', { className: 'card-title' }, `${targetYear}-yil oylik ko'rsatkichlari (Yanvar – Dekabr)`),
          el('span', { style: 'font-size: 0.8125rem; color: var(--text-muted);' },
            `Jami: 12 oy · Faol o'quvchilar: ${data.active_students_count} nafar`
          )
        )
      );
      contentCard.appendChild(
        el('div', { className: 'card-body', style: 'padding: 0;' },
          el('div', { className: 'table-container' },
            el('table', { className: 'data-table' },
              el('thead', {},
                el('tr', {},
                  el('th', {}, 'Oy'),
                  el('th', { className: 'col-numeric' }, 'Tushum summasi'),
                  el('th', { className: 'col-numeric' }, 'To\'lovlar soni'),
                  el('th', { className: 'col-numeric' }, 'To\'laganlar'),
                  el('th', { className: 'col-numeric' }, 'Qarzdorlar'),
                  el('th', { className: 'col-numeric' }, 'Qoldiq qarz'),
                  el('th', { className: 'col-actions' }, 'Batafsil')
                )
              ),
              el('tbody', {}, ...tableRows),
              el('tfoot', {},
                el('tr', { style: 'background-color: var(--bg-subtle); font-weight: 700;' },
                  el('td', {}, 'Yillik jami / yakun'),
                  el('td', { className: 'col-numeric', style: 'color: var(--accent-primary);' },
                    formatUzbekSom(data.total_collected)
                  ),
                  el('td', { className: 'col-numeric' }, `${data.payment_count} ta`),
                  el('td', { className: 'col-numeric' }, `${data.paying_student_count} nafar`),
                  el('td', { className: 'col-numeric' }, '—'),
                  el('td', { className: 'col-numeric', style: 'color: var(--status-danger);' },
                    formatUzbekSom(data.total_debt_year)
                  ),
                  el('td', {}, '')
                )
              )
            )
          )
        )
      );

    } catch (err) {
      if (err && err.name === 'AbortError') return;
      if (requestId !== activeAnnualRequestId) return;

      contentCard.style.opacity = '1';
      clearElement(contentCard);
      contentCard.className = 'card';
      contentCard.appendChild(
        el('div', { className: 'error-banner' },
          el('span', {}, err.message || 'Yillik hisobotni yuklashda xatolik yuz berdi.'),
          el('button', {
            type: 'button',
            className: 'btn btn-secondary btn-sm',
            onClick: loadAnnualReport
          }, 'Qayta urinish')
        )
      );
    }
  }

  // Initial load based on activeMode
  if (activeMode === 'annual') {
    await loadAnnualReport();
  } else {
    await loadMonthlyReport();
  }
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
