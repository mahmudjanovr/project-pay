/**
 * Comprehensive Reports View for Project Pay.
 * Features 4 distinct views:
 * 1. Umumiy hisobot (Overall Monthly Overview)
 * 2. Guruhlar bo'yicha hisobot (Group-Level Breakdown)
 * 3. Qarzdorlar hisoboti (Authoritative Debtor List)
 * 4. Yillik hisobot (Annual 12-Month Overview)
 */

import {
  fetchMonthlyDebtors,
  fetchReportOverview,
  fetchReportGroups,
  fetchReportAnnual
} from '../api.js';
import {
  formatUzbekSom,
  formatMonthName,
  getCurrentLocalMonthString
} from '../formatters.js';
import { el, clearElement } from '../dom.js';
import { createPageShell, createSectionToolbar } from '../pageLayout.js';
import { openModal, closeModal } from '../modal.js';

export async function renderReports(container, queryParams = new URLSearchParams()) {
  clearElement(container);

  let selectedMonth = queryParams.get('month') || getCurrentLocalMonthString();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(selectedMonth)) {
    selectedMonth = getCurrentLocalMonthString();
  }

  const isDebtorsPath = Boolean(window.location?.hash && window.location.hash.startsWith('#/debtors'));
  const isDebtorsTab = queryParams.get('tab') === 'debtors' && (!window.location?.hash || !window.location.hash.startsWith('#/reports'));
  const showDebtorsTitle = isDebtorsPath || isDebtorsTab;
  let currentTab = queryParams.get('tab') || (isDebtorsPath ? 'debtors' : 'overview');
  let activeRequestId = 0;

  // Page Header
  const pageHeader = el('div', { className: 'page-header' },
    el('div', {},
      el('h1', { className: 'page-title' }, showDebtorsTitle ? 'Qarzdorlar hisoboti' : 'Hisobotlar'),
      el('p', { className: 'page-description' }, 'Markaz moliyaviy holati, tushumlar, guruhlar va qarzdorlik tahlili')
    ),
    el('div', { className: 'page-actions' },
      el('a', {
        href: '#/payments',
        className: 'btn btn-primary'
      }, '+ To\'lov qabul qilish')
    )
  );

  // Month selector control (has id debtor-month-input for test compatibility)
  const monthInput = el('input', {
    type: 'month',
    id: 'debtor-month-input',
    className: 'form-input',
    value: selectedMonth,
    style: 'max-width: 180px;',
    onChange: (e) => {
      const newMonth = e.target.value;
      if (newMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(newMonth)) {
        selectedMonth = newMonth;
        loadCurrentTab();
      }
    }
  });

  const monthLabel = el('span', {
    id: 'report-month-label',
    style: 'font-weight: 600; color: var(--text-primary);'
  }, formatMonthName(selectedMonth));

  // Tab switcher buttons
  const tabButtonsContainer = el('div', {
    className: 'report-tab-bar',
    style: 'display: flex; gap: var(--space-2); margin-top: var(--space-3); flex-wrap: wrap;'
  });

  const tabs = [
    { id: 'overview', label: 'Umumiy hisobot' },
    { id: 'groups', label: 'Guruhlar bo\'yicha' },
    { id: 'debtors', label: 'Qarzdorlar' },
    { id: 'annual', label: 'Yillik hisobot' }
  ];

  function renderTabButtons() {
    clearElement(tabButtonsContainer);
    tabs.forEach((tab) => {
      const isActive = currentTab === tab.id;
      const btn = el('button', {
        type: 'button',
        className: `btn btn-sm ${isActive ? 'btn-primary' : 'btn-secondary'}`,
        'data-tab': tab.id,
        onClick: () => {
          if (currentTab !== tab.id) {
            currentTab = tab.id;
            renderTabButtons();
            loadCurrentTab();
          }
        }
      }, tab.label);
      tabButtonsContainer.appendChild(btn);
    });
  }

  renderTabButtons();

  const filterToolbar = el('div', {},
    createSectionToolbar(
      [
        el('label', { className: 'form-label', htmlFor: 'debtor-month-input', style: 'margin-bottom: 0;' }, 'Hisobot oyi:'),
        monthInput
      ],
      monthLabel
    ),
    tabButtonsContainer
  );

  const reportContent = el('div', { id: 'report-content' });

  const shell = createPageShell({
    header: pageHeader,
    toolbar: filterToolbar,
    body: reportContent
  });
  container.appendChild(shell.element);

  async function loadCurrentTab() {
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
      if (currentTab === 'overview') {
        const overview = await fetchReportOverview(targetMonth);
        if (requestId !== activeRequestId) return;
        clearElement(reportContent);
        renderOverviewView(reportContent, overview, targetMonth);
      } else if (currentTab === 'groups') {
        const groupData = await fetchReportGroups(targetMonth);
        if (requestId !== activeRequestId) return;
        clearElement(reportContent);
        renderGroupsView(reportContent, groupData, targetMonth);
      } else if (currentTab === 'annual') {
        const year = targetMonth.split('-')[0];
        const annualData = await fetchReportAnnual(year);
        if (requestId !== activeRequestId) return;
        clearElement(reportContent);
        renderAnnualView(reportContent, annualData, year);
      } else {
        // Debtors tab
        const debtors = await fetchMonthlyDebtors(targetMonth);
        if (requestId !== activeRequestId) return;
        clearElement(reportContent);
        renderDebtorsView(reportContent, debtors, targetMonth, shell);
      }
    } catch (err) {
      if (requestId !== activeRequestId) return;
      clearElement(reportContent);
      reportContent.appendChild(
        el('div', { className: 'error-banner' },
          el('span', {}, err.message || 'Hisobotni yuklashda xatolik yuz berdi.'),
          el('button', {
            type: 'button',
            className: 'btn btn-secondary btn-sm',
            onClick: loadCurrentTab
          }, 'Qayta urinish')
        )
      );
    }
  }

  await loadCurrentTab();
}

/**
 * 1. Overview Tab
 */
function renderOverviewView(container, data, monthStr) {
  const cards = el('div', { className: 'stats-grid', style: 'margin-bottom: var(--space-6);' },
    el('div', { className: 'stat-card' },
      el('span', { className: 'stat-label' }, 'Kutilayotgan to\'lov (Reja)'),
      el('div', { className: 'stat-value' }, formatUzbekSom(data.total_expected)),
      el('span', { className: 'stat-desc' }, `${formatMonthName(monthStr)} oylik reja summasi`)
    ),
    el('div', { className: 'stat-card accent-green' },
      el('span', { className: 'stat-label' }, 'Jami tushum (Tasdiqlangan)'),
      el('div', { className: 'stat-value' }, formatUzbekSom(data.total_confirmed)),
      el('span', { className: 'stat-desc' }, `Yig'im ko'rsatkichi: ${data.collection_rate}%`)
    ),
    el('div', { className: 'stat-card accent-amber' },
      el('span', { className: 'stat-label' }, 'Kutilayotgan to\'lovlar (Tasdiqlanmagan)'),
      el('div', { className: 'stat-value' }, formatUzbekSom(data.total_pending)),
      el('span', { className: 'stat-desc' }, `${data.pending_count} ta to'lov tasdiqlash arafasida`)
    ),
    el('div', { className: 'stat-card accent-red' },
      el('span', { className: 'stat-label' }, 'Jami qoldiq qarzdorlik'),
      el('div', { className: 'stat-value' }, formatUzbekSom(data.total_debt)),
      el('span', { className: 'stat-desc' }, `${data.debtor_count} nafar qarzdor o'quvchi`)
    )
  );

  const subCards = el('div', { className: 'stats-grid', style: 'margin-bottom: var(--space-6);' },
    el('div', { className: 'stat-card' },
      el('span', { className: 'stat-label' }, 'To\'liq to\'lagan o\'quvchilar'),
      el('div', { className: 'stat-value', style: 'color: var(--status-success);' }, `${data.fully_paid_count} nafar`),
      el('span', { className: 'stat-desc' }, 'Oylik to\'lovni to\'liq yopganlar')
    ),
    el('div', { className: 'stat-card' },
      el('span', { className: 'stat-label' }, 'Qarzdor o\'quvchilar'),
      el('div', { className: 'stat-value', style: 'color: var(--status-danger);' }, `${data.debtor_count} nafar`),
      el('span', { className: 'stat-desc' }, 'To\'lovi to\'liq emas yoki to\'lamaganlar')
    ),
    el('div', { className: 'stat-card' },
      el('span', { className: 'stat-label' }, 'Yig\'im samaradorligi'),
      el('div', { className: 'stat-value' }, `${data.collection_rate}%`),
      el('span', { className: 'stat-desc' }, 'Kutilayotgan tushumga nisbatan')
    )
  );

  const notice = el('div', {
    style: 'background-color: var(--bg-surface); border: 1px solid var(--border-light); border-radius: var(--radius-md); padding: var(--space-4); font-size: 0.875rem; color: var(--text-secondary); line-height: 1.6;'
  },
    el('p', { style: 'margin: 0; font-weight: 500; color: var(--text-primary); margin-bottom: 4px;' },
      '📌 Moliyaviy qoidalar eslatmasi:'
    ),
    el('p', { style: 'margin: 0;' },
      'Kutilayotgan to\'lov (Reja) — ushbu oyda o\'qigan barcha o\'quvchilarning belgilangan oylik to\'lov stavkalari yig\'indisi. ' +
      'Jami tushum — faqatgina tasdiqlangan va aynan ushbu oyga biriktirilgan to\'lovlardir. Kutilayotgan to\'lovlar tasdiqlanmaguncha qarzdan chegirilmaydi.'
    )
  );

  container.appendChild(cards);
  container.appendChild(subCards);
  container.appendChild(notice);
}

/**
 * 2. Groups Tab
 */
function renderGroupsView(container, groupData, monthStr) {
  if (groupData.length === 0) {
    container.appendChild(
      el('div', { className: 'empty-state' },
        el('div', { className: 'empty-state-icon' }, '📁'),
        el('h3', { className: 'empty-state-title' }, 'Guruhlar mavjud emas'),
        el('p', { className: 'empty-state-description' }, 'Hozircha tizimda guruhlar mavjud emas.')
      )
    );
    return;
  }

  let totalExpected = 0n;
  let totalConfirmed = 0n;
  let totalPending = 0n;
  let totalDebt = 0n;
  let totalDebtors = 0;
  let totalStudents = 0;

  for (const g of groupData) {
    totalExpected += BigInt(g.total_expected);
    totalConfirmed += BigInt(g.total_confirmed);
    totalPending += BigInt(g.total_pending);
    totalDebt += BigInt(g.total_debt);
    totalDebtors += g.debtor_count;
    totalStudents += g.student_count;
  }

  const summary = el('div', { className: 'stats-grid', style: 'margin-bottom: var(--space-6);' },
    el('div', { className: 'stat-card' },
      el('span', { className: 'stat-label' }, 'Guruhlar soni'),
      el('div', { className: 'stat-value' }, `${groupData.length} ta`),
      el('span', { className: 'stat-desc' }, `Jami ${totalStudents} nafar o'quvchi`)
    ),
    el('div', { className: 'stat-card accent-green' },
      el('span', { className: 'stat-label' }, 'Jami tasdiqlangan tushum'),
      el('div', { className: 'stat-value' }, formatUzbekSom(totalConfirmed)),
      el('span', { className: 'stat-desc' }, `${formatMonthName(monthStr)} bo'yicha`)
    ),
    el('div', { className: 'stat-card accent-red' },
      el('span', { className: 'stat-label' }, 'Guruhlar bo\'yicha jami qarz'),
      el('div', { className: 'stat-value' }, formatUzbekSom(totalDebt)),
      el('span', { className: 'stat-desc' }, `${totalDebtors} nafar qarzdor`)
    )
  );

  const tableWrapper = el('div', { className: 'table-container' });
  const tbody = el('tbody', {},
    ...groupData.map((g) =>
      el('tr', {},
        el('td', { style: 'font-weight: 600;' },
          g.group_id
            ? el('a', { href: `#/groups/${g.group_id}`, style: 'color: var(--text-primary); text-decoration: none;' }, g.group_name)
            : el('span', { style: 'color: var(--text-muted);' }, g.group_name)
        ),
        el('td', { className: 'col-numeric' }, `${g.student_count} nafar`),
        el('td', { className: 'col-numeric' }, formatUzbekSom(g.total_expected)),
        el('td', { className: 'col-numeric', style: 'color: var(--status-success); font-weight: 600;' }, formatUzbekSom(g.total_confirmed)),
        el('td', { className: 'col-numeric', style: 'color: var(--accent-primary);' }, formatUzbekSom(g.total_pending)),
        el('td', { className: 'col-numeric', style: 'color: var(--status-danger); font-weight: 700;' }, formatUzbekSom(g.total_debt)),
        el('td', { className: 'col-numeric' }, `${g.debtor_count} nafar`),
        el('td', { className: 'col-actions' },
          el('button', {
            type: 'button',
            className: 'btn btn-secondary btn-sm',
            onClick: () => showGroupInspectModal(g, monthStr)
          }, 'Tafsilotlar')
        )
      )
    ),
    // Reconciled Totals Row
    el('tr', { style: 'font-weight: 700; background-color: var(--bg-surface); border-top: 2px solid var(--border-medium);' },
      el('td', {}, 'JAMI:'),
      el('td', { className: 'col-numeric' }, `${totalStudents} nafar`),
      el('td', { className: 'col-numeric' }, formatUzbekSom(totalExpected)),
      el('td', { className: 'col-numeric', style: 'color: var(--status-success);' }, formatUzbekSom(totalConfirmed)),
      el('td', { className: 'col-numeric', style: 'color: var(--accent-primary);' }, formatUzbekSom(totalPending)),
      el('td', { className: 'col-numeric', style: 'color: var(--status-danger);' }, formatUzbekSom(totalDebt)),
      el('td', { className: 'col-numeric' }, `${totalDebtors} nafar`),
      el('td', {})
    )
  );

  tableWrapper.appendChild(
    el('table', { className: 'data-table' },
      el('thead', {},
        el('tr', {},
          el('th', {}, 'Guruh nomi'),
          el('th', { className: 'col-numeric' }, 'O\'quvchilar'),
          el('th', { className: 'col-numeric' }, 'Kutilayotgan'),
          el('th', { className: 'col-numeric' }, 'Tasdiqlangan'),
          el('th', { className: 'col-numeric' }, 'Kutilmoqda'),
          el('th', { className: 'col-numeric' }, 'Qoldiq qarz'),
          el('th', { className: 'col-numeric' }, 'Qarzdorlar'),
          el('th', { className: 'col-actions' }, 'Amallar')
        )
      ),
      tbody
    )
  );

  const card = el('div', { className: 'card card-table' },
    el('div', { className: 'card-header' },
      el('h2', { className: 'card-title' }, `Guruhlar kesimida hisobot (${formatMonthName(monthStr)})`),
      el('span', { style: 'font-size: 0.8125rem; color: var(--text-muted);' },
        `Jami ${groupData.length} ta guruh / toifa`
      )
    ),
    el('div', { className: 'card-body', style: 'padding: 0;' }, tableWrapper)
  );

  container.appendChild(summary);
  container.appendChild(card);
}

function showGroupInspectModal(group, monthStr) {
  const students = group.students || [];

  const tableBody = el('tbody', {},
    ...students.map((s) => {
      let statusBadge;
      if (s.status === 'exempt') {
        statusBadge = el('span', { className: 'badge', style: 'background: rgba(148, 163, 184, 0.2); color: var(--text-muted);' }, 'Imtiyozli');
      } else if (s.status === 'paid') {
        statusBadge = el('span', { className: 'badge', style: 'background: rgba(34, 197, 94, 0.2); color: var(--status-success);' }, 'To\'liq to\'langan');
      } else if (s.status === 'partial') {
        statusBadge = el('span', { className: 'badge', style: 'background: rgba(245, 158, 11, 0.2); color: var(--status-warning);' }, 'Qisman to\'langan');
      } else if (s.status === 'pending') {
        statusBadge = el('span', { className: 'badge', style: 'background: rgba(56, 189, 248, 0.2); color: var(--accent-primary);' }, 'Tasdiqlash kutilmoqda');
      } else {
        statusBadge = el('span', { className: 'badge', style: 'background: rgba(239, 68, 68, 0.2); color: var(--status-danger);' }, 'To\'lanmagan');
      }

      return el('tr', {},
        el('td', { style: 'font-weight: 500;' },
          el('a', { href: `#/students/${s.id}`, style: 'color: var(--text-primary); text-decoration: none;' }, s.full_name)
        ),
        el('td', { className: 'col-numeric' }, formatUzbekSom(s.monthly_fee)),
        el('td', { className: 'col-numeric', style: 'color: var(--status-success);' }, formatUzbekSom(s.total_paid)),
        el('td', { className: 'col-numeric', style: 'color: var(--accent-primary);' }, formatUzbekSom(s.pending_paid)),
        el('td', { className: 'col-numeric', style: 'color: var(--status-danger); font-weight: 700;' }, formatUzbekSom(s.debt)),
        el('td', {}, statusBadge)
      );
    })
  );

  const body = el('div', {},
    el('div', { style: 'margin-bottom: var(--space-4); display: flex; gap: var(--space-4); flex-wrap: wrap;' },
      el('span', { style: 'color: var(--text-secondary); font-size: 0.875rem;' },
        `O'quvchilar: `, el('strong', { style: 'color: var(--text-primary);' }, `${students.length} nafar`)
      ),
      el('span', { style: 'color: var(--text-secondary); font-size: 0.875rem;' },
        `Kutilayotgan: `, el('strong', { style: 'color: var(--text-primary);' }, formatUzbekSom(group.total_expected))
      ),
      el('span', { style: 'color: var(--text-secondary); font-size: 0.875rem;' },
        `Tasdiqlangan: `, el('strong', { style: 'color: var(--status-success);' }, formatUzbekSom(group.total_confirmed))
      ),
      el('span', { style: 'color: var(--text-secondary); font-size: 0.875rem;' },
        `Qoldiq qarz: `, el('strong', { style: 'color: var(--status-danger);' }, formatUzbekSom(group.total_debt))
      )
    ),
    el('div', { className: 'table-container', style: 'max-height: 380px; overflow-y: auto;' },
      el('table', { className: 'data-table' },
        el('thead', {},
          el('tr', {},
            el('th', {}, 'O\'quvchi'),
            el('th', { className: 'col-numeric' }, 'Oylik stavka'),
            el('th', { className: 'col-numeric' }, 'Tasdiqlangan'),
            el('th', { className: 'col-numeric' }, 'Kutilmoqda'),
            el('th', { className: 'col-numeric' }, 'Qoldiq qarz'),
            el('th', {}, 'Holat')
          )
        ),
        tableBody
      )
    )
  );

  const footer = el('div', { style: 'display: flex; justify-content: flex-end;' },
    el('button', {
      type: 'button',
      className: 'btn btn-secondary',
      onClick: closeModal
    }, 'Yopish')
  );

  openModal({
    title: `${group.group_name} — O'quvchilar tafsiloti (${formatMonthName(monthStr)})`,
    body,
    footer
  });
}

/**
 * 3. Debtors Tab (Authoritative Debtor List)
 */
function renderDebtorsView(container, debtors, targetMonth, shell) {
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
    el('div', { className: 'card-body', style: 'padding: 0;' }, debtorsTableEl)
  );

  container.appendChild(summaryCards);
  container.appendChild(ruleNotice);
  container.appendChild(tableCard);
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
  let filterText = '';
  const wrapper = el('div', { className: 'table-container' });

  // Optional search bar within table
  const searchBar = el('div', {
    style: 'padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--border-light); display: flex; gap: var(--space-2); align-items: center;'
  },
    el('input', {
      type: 'search',
      id: 'debtors-search-input',
      className: 'form-input',
      placeholder: 'Qarzdor o\'quvchini qidirish...',
      style: 'max-width: 300px; font-size: 0.875rem;',
      onInput: (e) => {
        filterText = (e.target.value || '').trim().toLowerCase();
        currentPage = 1;
        renderPage();
      }
    })
  );

  function getFilteredItems() {
    if (!filterText) return debtors;
    return debtors.filter((d) =>
      d.full_name.toLowerCase().includes(filterText) ||
      (d.group_name && d.group_name.toLowerCase().includes(filterText))
    );
  }

  function renderPage() {
    clearElement(wrapper);
    wrapper.appendChild(searchBar);

    const filtered = getFilteredItems();
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;

    const startIdx = (currentPage - 1) * PAGE_SIZE;
    const pageItems = filtered.slice(startIdx, startIdx + PAGE_SIZE);

    const tbody = el('tbody', {},
      ...pageItems.map((d) => {
        const groupDisplay = d.group_name || 'Guruhsiz';
        let statusBadge;
        if (d.total_paid === 0 && d.pending_paid > 0) {
          statusBadge = el('span', { className: 'badge', style: 'background: rgba(56, 189, 248, 0.2); color: var(--accent-primary);' }, 'Tasdiqlash kutilmoqda');
        } else if (d.total_paid === 0) {
          statusBadge = el('span', { className: 'badge', style: 'background: rgba(239, 68, 68, 0.2); color: var(--status-danger);' }, 'To\'lanmagan');
        } else {
          statusBadge = el('span', { className: 'badge', style: 'background: rgba(245, 158, 11, 0.2); color: var(--status-warning);' }, 'Qisman to\'langan');
        }

        return el('tr', {},
          el('td', { style: 'font-weight: 500;' },
            el('a', {
              href: `#/students/${d.student_id}`,
              style: 'color: var(--text-primary); text-decoration: none;'
            }, d.full_name)
          ),
          el('td', { style: 'color: var(--text-secondary); font-size: 0.875rem;' }, groupDisplay),
          el('td', { className: 'col-numeric' }, formatUzbekSom(d.monthly_fee)),
          el('td', { className: 'col-numeric', style: 'color: var(--accent-primary); font-weight: 600;' }, formatUzbekSom(d.total_paid)),
          el('td', { className: 'col-numeric', style: 'color: var(--status-danger); font-weight: 700;' }, formatUzbekSom(d.debt)),
          el('td', {}, statusBadge),
          el('td', { className: 'col-actions' },
            el('a', {
              href: `#/payments?student_id=${d.student_id}&month=${monthStr}`,
              className: 'btn btn-primary btn-sm'
            }, 'To\'lash')
          )
        );
      })
    );

    wrapper.appendChild(
      el('table', { className: 'data-table' },
        el('thead', {},
          el('tr', {},
            el('th', {}, 'O\'quvchi F.I.SH.'),
            el('th', {}, 'Guruh'),
            el('th', { className: 'col-numeric' }, 'Oylik stavka'),
            el('th', { className: 'col-numeric' }, 'To\'langan summa'),
            el('th', { className: 'col-numeric' }, 'Qoldiq qarz'),
            el('th', {}, 'Holat'),
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

/**
 * 4. Annual Overview Tab
 */
function renderAnnualView(container, data, yearStr) {
  const months = data.months || [];
  const totals = data.totals || {};

  const summary = el('div', { className: 'stats-grid', style: 'margin-bottom: var(--space-6);' },
    el('div', { className: 'stat-card' },
      el('span', { className: 'stat-label' }, 'Yillik kutilayotgan to\'lov'),
      el('div', { className: 'stat-value' }, formatUzbekSom(totals.total_expected)),
      el('span', { className: 'stat-desc' }, `${yearStr}-yil bo'yicha jami reja`)
    ),
    el('div', { className: 'stat-card accent-green' },
      el('span', { className: 'stat-label' }, 'Yillik tasdiqlangan tushum'),
      el('div', { className: 'stat-value' }, formatUzbekSom(totals.total_confirmed_billing)),
      el('span', { className: 'stat-desc' }, 'Hisoblangan oylar bo\'yicha')
    ),
    el('div', { className: 'stat-card' },
      el('span', { className: 'stat-label' }, 'Kassaga kirim (Fakt)'),
      el('div', { className: 'stat-value' }, formatUzbekSom(totals.total_cash_received)),
      el('span', { className: 'stat-desc' }, 'To\'lov sanasi bo\'yicha tushum')
    ),
    el('div', { className: 'stat-card accent-red' },
      el('span', { className: 'stat-label' }, 'Yillik qoldiq qarzdorlik'),
      el('div', { className: 'stat-value' }, formatUzbekSom(totals.total_debt)),
      el('span', { className: 'stat-desc' }, 'To\'lanmay qolgan qarzlar')
    )
  );

  const tbody = el('tbody', {},
    ...months.map((m) =>
      el('tr', {},
        el('td', { style: 'font-weight: 600;' }, m.month_name),
        el('td', { style: 'color: var(--text-muted); font-size: 0.8125rem;' }, m.month),
        el('td', { className: 'col-numeric' }, formatUzbekSom(m.expected)),
        el('td', { className: 'col-numeric', style: 'color: var(--status-success); font-weight: 600;' }, formatUzbekSom(m.confirmed_billing)),
        el('td', { className: 'col-numeric', style: 'color: var(--accent-primary);' }, formatUzbekSom(m.pending_billing)),
        el('td', { className: 'col-numeric', style: 'color: var(--status-danger); font-weight: 700;' }, formatUzbekSom(m.debt)),
        el('td', { className: 'col-numeric' }, `${m.debtor_count} nafar`),
        el('td', { className: 'col-numeric', style: 'color: var(--text-primary); font-weight: 500;' }, formatUzbekSom(m.cash_received_by_date))
      )
    ),
    // Totals Row
    el('tr', { style: 'font-weight: 700; background-color: var(--bg-surface); border-top: 2px solid var(--border-medium);' },
      el('td', { colSpan: 2 }, 'JAMI YILLIK:'),
      el('td', { className: 'col-numeric' }, formatUzbekSom(totals.total_expected)),
      el('td', { className: 'col-numeric', style: 'color: var(--status-success);' }, formatUzbekSom(totals.total_confirmed_billing)),
      el('td', { className: 'col-numeric', style: 'color: var(--accent-primary);' }, formatUzbekSom(totals.total_pending_billing)),
      el('td', { className: 'col-numeric', style: 'color: var(--status-danger);' }, formatUzbekSom(totals.total_debt)),
      el('td', { className: 'col-numeric' }, '—'),
      el('td', { className: 'col-numeric', style: 'color: var(--text-primary);' }, formatUzbekSom(totals.total_cash_received))
    )
  );

  const tableWrapper = el('div', { className: 'table-container' },
    el('table', { className: 'data-table' },
      el('thead', {},
        el('tr', {},
          el('th', {}, 'Oy'),
          el('th', {}, 'Kodi'),
          el('th', { className: 'col-numeric' }, 'Kutilayotgan'),
          el('th', { className: 'col-numeric' }, 'Tasdiqlangan'),
          el('th', { className: 'col-numeric' }, 'Kutilmoqda'),
          el('th', { className: 'col-numeric' }, 'Qoldiq qarz'),
          el('th', { className: 'col-numeric' }, 'Qarzdorlar'),
          el('th', { className: 'col-numeric' }, 'Kassaga kirim (Fakt)')
        )
      ),
      tbody
    )
  );

  const card = el('div', { className: 'card card-table' },
    el('div', { className: 'card-header' },
      el('h2', { className: 'card-title' }, `${yearStr}-yil bo'yicha 12 oylik moliya hisoboti`),
      el('span', { style: 'font-size: 0.8125rem; color: var(--text-muted);' },
        'To\'lov sanasi bo\'yicha kassa kirimi va hisobot oyi bo\'yicha tushumlar taqqoslanishi'
      )
    ),
    el('div', { className: 'card-body', style: 'padding: 0;' }, tableWrapper)
  );

  container.appendChild(summary);
  container.appendChild(card);
}
