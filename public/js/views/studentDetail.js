/**
 * Student Details & Payment History View for Ecomdev.
 * Shows student profile, payment history, confirmation statuses,
 * stable PDF receipts download, and month/year filtering.
 */

import { fetchStudent, fetchStudentPayments, fetchGroups, confirmPayment, rejectPayment } from '../api.js';
import { formatUzbekSom, formatDate, formatMonthName } from '../formatters.js';
import { el, clearElement } from '../dom.js';
import { showToast } from '../notifications.js';
import { showEditStudentModal } from './students.js';
import { createPageShell, renderStateView } from '../pageLayout.js';

/**
 * Renders the Student Detail & Payment History view into the target container.
 *
 * @param {HTMLElement} container
 * @param {string} studentId
 */
export async function renderStudentDetail(container, studentId) {
  const loadingEl = el('div', { className: 'loading-indicator' },
    el('div', { className: 'spinner' }),
    el('p', {}, 'O\'quvchi ma\'lumotlari yuklanmoqda...')
  );
  renderStateView(container, loadingEl);

  try {
    const [student, payments, groups] = await Promise.all([
      fetchStudent(studentId),
      fetchStudentPayments(studentId),
      fetchGroups()
    ]);

    clearElement(container);

    // Calculate confirmed and pending totals accurately using BigInt
    let confirmedPaid = 0n;
    let pendingPaid = 0n;
    for (const p of payments) {
      if (Number.isSafeInteger(p.amount)) {
        if (p.status === 'pending') {
          pendingPaid += BigInt(p.amount);
        } else if (p.status !== 'rejected') {
          confirmedPaid += BigInt(p.amount);
        }
      }
    }

    // Page Header
    const pageHeader = el('div', { className: 'page-header' },
      el('div', {},
        el('div', { style: 'margin-bottom: var(--space-2);' },
          el('a', {
            href: '#/students',
            className: 'btn btn-secondary btn-sm',
            style: 'padding: 0.25rem 0.5rem;'
          }, '← O\'quvchilar ro\'yxatiga qaytish')
        ),
        el('h1', { className: 'page-title' }, student.full_name),
        el('p', { className: 'page-description' },
          `ID: #${student.id} | Telefon: ${student.phone || 'Kiritilmagan'} | Guruh: ${student.group_name || 'Guruhsiz'} | Ro'yxatdan o'tgan sana: ${formatDate(student.created_at)}`
        )
      ),
      el('div', { className: 'page-actions' },
        el('button', {
          type: 'button',
          className: 'btn btn-secondary',
          onClick: () => showEditStudentModal(student, groups, () => renderStudentDetail(container, studentId))
        }, 'Tahrirlash'),
        el('a', {
          href: `#/payments?student_id=${student.id}`,
          className: 'btn btn-primary'
        }, '+ To\'lov kiritish')
      )
    );

    // Student Info Card
    const infoGrid = el('div', { className: 'stats-grid' },
      el('div', { className: 'stat-card' },
        el('span', { className: 'stat-label' }, 'Biriktirilgan guruh va aloqa'),
        el('div', { className: 'stat-value', style: 'font-size: 1.25rem;' },
          student.group_name ? student.group_name : 'Guruhsiz'
        ),
        el('span', { className: 'stat-desc' },
          student.phone ? `Telefon: ${student.phone}` : 'Telefon raqami kiritilmagan'
        )
      ),
      el('div', { className: 'stat-card' },
        el('span', { className: 'stat-label' }, 'Oylik to\'lov stavkasi'),
        el('div', { className: 'stat-value' }, formatUzbekSom(student.monthly_fee)),
        el('span', { className: 'stat-desc' }, 'Har oy to\'lanishi belgilangan summa')
      ),
      el('div', { className: 'stat-card accent-green' },
        el('span', { className: 'stat-label' }, 'Jami tasdiqlangan to\'lovlar'),
        el('div', { className: 'stat-value' }, formatUzbekSom(confirmedPaid)),
        el('span', { className: 'stat-desc' },
          pendingPaid > 0n
            ? `Kutilmoqda: ${formatUzbekSom(pendingPaid)}`
            : `${payments.length} ta to'lov operatsiyasi bo'yicha`
        )
      ),
      el('div', { className: 'stat-card' },
        el('span', { className: 'stat-label' }, 'To\'lovlar soni'),
        el('div', { className: 'stat-value' }, `${payments.length} ta`),
        el('span', { className: 'stat-desc' }, 'Kiritilgan barcha to\'lovlar')
      )
    );

    // Payment History and Filter Bar
    let selectedFilter = 'all';
    const filterSelect = el('select', {
      className: 'form-input',
      style: 'max-width: 200px; font-size: 0.8125rem;',
      onChange: (e) => {
        selectedFilter = e.target.value;
        renderHistory();
      }
    }, el('option', { value: 'all' }, 'Barcha to\'lovlar'));

    // Populate filter options from available dates
    const distinctMonths = new Set();
    for (const p of payments) {
      const m = p.billing_month || p.payment_date.substring(0, 7);
      distinctMonths.add(m);
    }
    for (const m of Array.from(distinctMonths).sort().reverse()) {
      filterSelect.appendChild(el('option', { value: m }, formatMonthName(m)));
    }

    const tableCardBody = el('div', { className: 'card-body', style: 'padding: 0;' });

    function renderHistory() {
      clearElement(tableCardBody);
      const filtered = selectedFilter === 'all'
        ? payments
        : payments.filter((p) => {
            const m = p.billing_month || p.payment_date.substring(0, 7);
            return m === selectedFilter;
          });

      tableCardBody.appendChild(
        renderPaymentsTable(filtered, student, () => renderStudentDetail(container, studentId))
      );
    }

    renderHistory();

    const paymentsCard = el('div', { className: payments.length > 0 ? 'card card-table' : 'card' },
      el('div', { className: 'card-header', style: 'display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: var(--space-3);' },
        el('div', {},
          el('h2', { className: 'card-title' }, 'To\'lovlar tarixi va cheklar'),
          el('span', { style: 'font-size: 0.8125rem; color: var(--text-muted);' },
            `Jami: ${payments.length} ta to'lov yozuvi`
          )
        ),
        payments.length > 0 ? el('div', { style: 'display: flex; align-items: center; gap: var(--space-2);' },
          el('label', { style: 'font-size: 0.8125rem; color: var(--text-secondary);' }, 'Davr:'),
          filterSelect
        ) : null
      ),
      tableCardBody
    );

    const shell = createPageShell({
      header: pageHeader,
      body: [infoGrid, paymentsCard]
    });
    container.appendChild(shell.element);

  } catch (err) {
    renderStateView(
      container,
      el('div', { className: 'error-banner' },
        el('span', {}, err.message || 'O\'quvchi ma\'lumotlarini yuklashda xatolik yuz berdi.'),
        el('a', {
          href: '#/students',
          className: 'btn btn-secondary btn-sm'
        }, 'O\'quvchilar ro\'yxatiga qaytish')
      )
    );
  }
}

function renderPaymentsTable(payments, student, onRefresh) {
  if (payments.length === 0) {
    return el('div', { className: 'empty-state' },
      el('div', { className: 'empty-state-icon' }, '💳'),
      el('h3', { className: 'empty-state-title' }, 'To\'lovlar tarixi mavjud emas'),
      el('p', { className: 'empty-state-description' }, 'Ushbu davr bo\'yicha to\'lov yozuvlari topilmadi.'),
      el('a', {
        href: `#/payments?student_id=${student.id}`,
        className: 'btn btn-primary btn-sm'
      }, '+ To\'lov kiritish')
    );
  }

  const tbody = el('tbody', {},
    ...payments.map((p) => {
      const isPending = p.status === 'pending';
      const billingMonthStr = formatMonthName(p.billing_month || p.payment_date.substring(0, 7));

      let statusBadge;
      if (isPending) {
        statusBadge = el('span', {
          className: 'badge',
          style: 'background: rgba(245, 158, 11, 0.2); color: var(--status-warning); font-size: 0.75rem;'
        }, 'Kutilmoqda');
      } else if (p.status === 'rejected') {
        statusBadge = el('span', {
          className: 'badge',
          style: 'background: rgba(239, 68, 68, 0.2); color: var(--status-danger); font-size: 0.75rem;'
        }, 'Rad etilgan');
      } else {
        statusBadge = el('span', {
          className: 'badge',
          style: 'background: rgba(34, 197, 94, 0.2); color: var(--status-success); font-size: 0.75rem;'
        }, 'Tasdiqlangan');
      }

      // Actions cell
      const actionsCell = el('td', { className: 'col-actions', style: 'display: flex; gap: var(--space-2); align-items: center;' });
      if (isPending) {
        const confirmBtn = el('button', {
          type: 'button',
          className: 'btn btn-primary btn-sm',
          onClick: async () => {
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Tasdiqlanmoqda...';
            try {
              await confirmPayment(p.id);
              showToast('To\'lov muvaffaqiyatli tasdiqlandi!', 'success');
              if (typeof onRefresh === 'function') onRefresh();
            } catch (cErr) {
              confirmBtn.disabled = false;
              confirmBtn.textContent = 'Tasdiqlash';
              showToast(cErr.message || 'Tasdiqlashda xatolik yuz berdi.', 'error');
            }
          }
        }, 'Tasdiqlash');

        const rejectBtn = el('button', {
          type: 'button',
          className: 'btn btn-danger-outline btn-sm',
          onClick: async () => {
            rejectBtn.disabled = true;
            rejectBtn.textContent = 'Rad etilmoqda...';
            try {
              await rejectPayment(p.id);
              showToast('To\'lov rad etildi!', 'success');
              if (typeof onRefresh === 'function') onRefresh();
            } catch (rErr) {
              rejectBtn.disabled = false;
              rejectBtn.textContent = 'Rad etish';
              showToast(rErr.message || 'Rad etishda xatolik yuz berdi.', 'error');
            }
          }
        }, 'Rad etish');

        actionsCell.appendChild(confirmBtn);
        actionsCell.appendChild(rejectBtn);
      } else if (p.status === 'confirmed' && p.receipt_id) {
        const pdfLink = el('a', {
          href: `/api/receipts/${p.receipt_id}/pdf`,
          target: '_blank',
          className: 'btn btn-secondary btn-sm',
          title: 'To\'lov kvitansiyasini yuklab olish (PDF)'
        }, 'Chek (PDF)');
        actionsCell.appendChild(pdfLink);
      } else {
        actionsCell.appendChild(el('span', { style: 'color: var(--text-muted);' }, '—'));
      }

      return el('tr', {},
        el('td', { style: 'font-weight: 500;' }, `#${p.id}`),
        el('td', {}, formatDate(p.payment_date)),
        el('td', { style: 'font-size: 0.875rem;' }, billingMonthStr),
        el('td', { className: 'col-numeric', style: 'color: var(--accent-primary); font-weight: 600;' }, formatUzbekSom(p.amount)),
        el('td', {}, statusBadge),
        el('td', { style: 'font-family: monospace; font-size: 0.8125rem;' },
          p.receipt_number ? p.receipt_number : el('span', { style: 'color: var(--text-muted);' }, '—')
        ),
        actionsCell
      );
    })
  );

  return el('div', { className: 'table-container' },
    el('table', { className: 'data-table' },
      el('thead', {},
        el('tr', {},
          el('th', {}, 'ID'),
          el('th', {}, 'To\'lov sanasi'),
          el('th', {}, 'Hisobot oyi'),
          el('th', { className: 'col-numeric' }, 'Summa'),
          el('th', {}, 'Holati'),
          el('th', {}, 'Chek raqami'),
          el('th', { className: 'col-actions' }, 'Amallar')
        )
      ),
      tbody
    )
  );
}
