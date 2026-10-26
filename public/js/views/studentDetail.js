/**
 * Student Details & Payment History View for Project Pay.
 */

import { fetchStudent, fetchStudentPayments, fetchGroups } from '../api.js';
import { formatUzbekSom, formatDate } from '../formatters.js';
import { el, clearElement } from '../dom.js';
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

    // Calculate total payments made by this student across all time using BigInt to prevent safe-integer overflow
    let allTimePaid = 0n;
    for (const p of payments) {
      if (Number.isSafeInteger(p.amount)) {
        allTimePaid += BigInt(p.amount);
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
        el('span', { className: 'stat-label' }, 'Jami to\'langan summa'),
        el('div', { className: 'stat-value' }, formatUzbekSom(allTimePaid)),
        el('span', { className: 'stat-desc' }, `${payments.length} ta to'lov operatsiyasi bo'yicha`)
      ),
      el('div', { className: 'stat-card' },
        el('span', { className: 'stat-label' }, 'To\'lovlar soni'),
        el('div', { className: 'stat-value' }, `${payments.length} ta`),
        el('span', { className: 'stat-desc' }, 'Qabul qilingan barcha to\'lovlar')
      )
    );

    // Payment History Card
    const paymentsCard = el('div', { className: payments.length > 0 ? 'card card-table' : 'card' },
      el('div', { className: 'card-header' },
        el('h2', { className: 'card-title' }, 'To\'lovlar tarixi'),
        el('span', { style: 'font-size: 0.8125rem; color: var(--text-muted);' },
          `Jami yozuvlar: ${payments.length} ta`
        )
      ),
      el('div', { className: 'card-body', style: 'padding: 0;' },
        renderPaymentsTable(payments, student)
      )
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

function renderPaymentsTable(payments, student) {
  if (payments.length === 0) {
    return el('div', { className: 'empty-state' },
      el('div', { className: 'empty-state-icon' }, '💳'),
      el('h3', { className: 'empty-state-title' }, 'To\'lovlar tarixi mavjud emas'),
      el('p', { className: 'empty-state-description' }, 'Ushbu o\'quvchi hisobiga hali to\'lov kiritilmagan.'),
      el('a', {
        href: `#/payments?student_id=${student.id}`,
        className: 'btn btn-primary btn-sm'
      }, '+ To\'lov kiritish')
    );
  }

  const tbody = el('tbody', {},
    ...payments.map((p) =>
      el('tr', {},
        el('td', { style: 'font-weight: 500;' }, `#${p.id}`),
        el('td', {}, formatDate(p.payment_date)),
        el('td', { className: 'col-numeric', style: 'color: var(--accent-primary); font-weight: 600;' }, formatUzbekSom(p.amount)),
        el('td', { style: 'color: var(--text-muted); font-size: 0.8125rem;' }, formatDate(p.created_at))
      )
    )
  );

  return el('div', { className: 'table-container' },
    el('table', { className: 'data-table' },
      el('thead', {},
        el('tr', {},
          el('th', {}, 'To\'lov ID'),
          el('th', {}, 'To\'lov sanasi'),
          el('th', { className: 'col-numeric' }, 'Summa'),
          el('th', {}, 'Tizimga kiritilgan sana')
        )
      ),
      tbody
    )
  );
}
