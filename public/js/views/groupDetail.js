/**
 * Dedicated Group Details View for Project Pay.
 * Displays group information, assigned students, group actions,
 * and quick student addition with this group preselected.
 */

import { fetchGroup, fetchGroupStudents, fetchGroups, updateStudent } from '../api.js';
import { formatUzbekSom, formatDate } from '../formatters.js';
import { el, clearElement } from '../dom.js';
import { showToast } from '../notifications.js';
import { openModal, closeModal } from '../modal.js';
import { showAddStudentModal, showEditStudentModal } from './students.js';
import { showEditGroupModal, confirmDeleteGroup } from './groups.js';
import { createPageShell, renderStateView } from '../pageLayout.js';

/**
 * Renders the Group Detail view showing assigned students and group actions.
 *
 * @param {HTMLElement} container
 * @param {string|number} groupId
 * @param {URLSearchParams} [queryParams]
 */
export async function renderGroupDetail(container, groupId, queryParams = new URLSearchParams()) {
  const numericGroupId = Number(groupId);
  if (!Number.isSafeInteger(numericGroupId) || numericGroupId <= 0) {
    renderStateView(
      container,
      el('div', { className: 'error-banner' },
        el('span', {}, 'Noto\'g\'ri guruh identifikatori ko\'rsatildi.'),
        el('a', {
          href: '#/groups',
          className: 'btn btn-secondary btn-sm'
        }, '← Guruhlar ro\'yxatiga qaytish')
      )
    );
    return;
  }

  const loadingEl = el('div', { className: 'loading-indicator' },
    el('div', { className: 'spinner' }),
    el('p', {}, 'Guruh ma\'lumotlari va o\'quvchilar ro\'yxati yuklanmoqda...')
  );
  renderStateView(container, loadingEl);

  try {
    const [group, students, allGroups] = await Promise.all([
      fetchGroup(numericGroupId),
      fetchGroupStudents(numericGroupId),
      fetchGroups()
    ]);

    clearElement(container);

    // Calculate total monthly tuition sum for this group using BigInt to prevent safe-integer overflow
    const totalMonthlyFee = students.reduce(
      (sum, s) => (Number.isSafeInteger(s.monthly_fee) ? sum + BigInt(s.monthly_fee) : sum),
      0n
    );

    // Page Header with Breadcrumb Back Link
    const pageHeader = el('div', { className: 'page-header' },
      el('div', {},
        el('div', { style: 'margin-bottom: var(--space-2);' },
          el('a', {
            href: '#/groups',
            className: 'btn btn-secondary btn-sm',
            style: 'padding: 0.25rem 0.5rem; display: inline-flex; align-items: center; gap: 4px;'
          }, '← Guruhlar ro\'yxatiga qaytish')
        ),
        el('h1', { className: 'page-title' }, group.name),
        el('p', { className: 'page-description' },
          `ID: #${group.id} | O'quvchilar soni: ${students.length} nafar | Yaratilgan sana: ${formatDate(group.created_at)}`
        )
      ),
      el('div', { className: 'page-actions', style: 'display: flex; gap: var(--space-2); flex-wrap: wrap;' },
        el('button', {
          type: 'button',
          className: 'btn btn-primary',
          title: 'Ushbu guruhga yangi o\'quvchi qo\'shish',
          onClick: () => showAddStudentModal(
            allGroups,
            () => renderGroupDetail(container, numericGroupId),
            group.id
          )
        }, '+ Guruhga o\'quvchi qo\'shish'),
        el('button', {
          type: 'button',
          className: 'btn btn-secondary',
          title: 'Guruh nomini o\'zgartirish',
          onClick: () => showEditGroupModal(
            group,
            () => renderGroupDetail(container, numericGroupId)
          )
        }, 'Nomini o\'zgartirish'),
        el('button', {
          type: 'button',
          className: 'btn btn-danger-outline',
          title: 'Guruhni o\'chirish',
          onClick: () => confirmDeleteGroup(
            { ...group, student_count: students.length },
            () => {
              window.location.hash = '#/groups';
            }
          )
        }, 'O\'chirish')
      )
    );

    // Summary Statistics Cards
    const statsGrid = el('div', { className: 'stats-grid', style: 'margin-bottom: var(--space-6);' },
      el('div', { className: 'stat-card accent-green' },
        el('span', { className: 'stat-label' }, 'Guruhdagi o\'quvchilar'),
        el('div', { className: 'stat-value' }, `${students.length} nafar`),
        el('span', { className: 'stat-desc' }, 'Faol biriktirilgan o\'quvchilar')
      ),
      el('div', { className: 'stat-card' },
        el('span', { className: 'stat-label' }, 'Jami oylik to\'lov summasi'),
        el('div', { className: 'stat-value' }, formatUzbekSom(totalMonthlyFee)),
        el('span', { className: 'stat-desc' }, 'Ushbu guruh o\'quvchilari bo\'yicha oylik reja')
      ),
      el('div', { className: 'stat-card' },
        el('span', { className: 'stat-label' }, 'Guruh holati'),
        el('div', {
          className: 'stat-value',
          style: `font-size: 1.125rem; font-weight: 600; color: ${students.length > 0 ? 'var(--status-success)' : 'var(--text-muted)'};`
        }, students.length > 0 ? 'Faol o\'quv guruhi' : 'Hozircha bo\'sh'),
        el('span', { className: 'stat-desc' },
          students.length > 0 ? 'O\'quv jarayoni davom etmoqda' : 'Yangi o\'quvchilarni qabul qilish mumkin'
        )
      )
    );

    // Students Section Card
    const studentsCard = el('div', { className: students.length > 0 ? 'card card-table' : 'card' },
      el('div', { className: 'card-header' },
        el('h2', { className: 'card-title' }, 'Guruh o\'quvchilari'),
        el('span', { style: 'font-size: 0.8125rem; color: var(--text-muted);' },
          `Jami: ${students.length} nafar`
        )
      ),
      el('div', { className: 'card-body', style: 'padding: 0;' },
        renderGroupStudentsTable(students, group, allGroups, () => renderGroupDetail(container, numericGroupId))
      )
    );

    const shell = createPageShell({
      header: pageHeader,
      body: [statsGrid, studentsCard]
    });
    container.appendChild(shell.element);

    // Auto-open add student modal if query parameter action=add_student is passed
    if (queryParams.get('action') === 'add_student') {
      showAddStudentModal(
        allGroups,
        () => renderGroupDetail(container, numericGroupId),
        group.id
      );
    }

  } catch (err) {
    renderStateView(
      container,
      el('div', { className: 'error-banner' },
        el('span', {}, err.message || `Guruh ma'lumotlarini yuklashda xatolik yuz berdi (ID: ${numericGroupId}).`),
        el('a', {
          href: '#/groups',
          className: 'btn btn-secondary btn-sm'
        }, '← Guruhlar ro\'yxatiga qaytish')
      )
    );
  }
}

/**
 * Renders the table of students belonging to the group, or an empty state.
 *
 * @param {Array<Object>} students
 * @param {Object} group
 * @param {Array<Object>} allGroups
 * @param {() => void} onRefresh
 * @returns {HTMLElement}
 */
function renderGroupStudentsTable(students, group, allGroups, onRefresh) {
  if (students.length === 0) {
    return el('div', { className: 'empty-state' },
      el('div', { className: 'empty-state-icon' }, '👥'),
      el('h3', { className: 'empty-state-title' }, 'Ushbu guruhda hozircha o\'quvchilar yo\'q'),
      el('p', { className: 'empty-state-description' },
        'Guruhga yangi o\'quvchi qo\'shing yoki mavjud o\'quvchilarni tahrirlash orqali ushbu guruhga biriktiring.'
      ),
      el('button', {
        type: 'button',
        className: 'btn btn-primary btn-sm',
        onClick: () => showAddStudentModal(allGroups, onRefresh, group.id)
      }, '+ O\'quvchi qo\'shish')
    );
  }

  const tbody = el('tbody', {},
    ...students.map((student) =>
      el('tr', {},
        el('td', { style: 'font-weight: 500;' },
          el('a', {
            href: `#/students/${student.id}`,
            style: 'color: var(--text-primary); text-decoration: none;',
            title: `${student.full_name} profiliga o'tish`
          }, student.full_name)
        ),
        el('td', { style: 'color: var(--text-secondary); font-size: 0.875rem;' },
          student.phone || '—'
        ),
        el('td', { className: 'col-numeric', style: 'font-weight: 600;' },
          formatUzbekSom(student.monthly_fee)
        ),
        el('td', { style: 'color: var(--text-muted); font-size: 0.8125rem;' },
          formatDate(student.created_at)
        ),
        el('td', { className: 'col-actions' },
          el('div', { style: 'display: flex; gap: var(--space-2); justify-content: flex-end;' },
            el('a', {
              href: `#/students/${student.id}`,
              className: 'btn btn-secondary btn-sm',
              title: 'O\'quvchi profili va to\'lovlar tarixi'
            }, 'Profil'),
            el('button', {
              type: 'button',
              className: 'btn btn-secondary btn-sm',
              title: 'O\'quvchini tahrirlash',
              onClick: () => showEditStudentModal(student, allGroups, onRefresh)
            }, 'Tahrirlash'),
            el('button', {
              type: 'button',
              className: 'btn btn-danger-outline btn-sm',
              title: 'O\'quvchini guruhdan chiqarish',
              onClick: () => confirmUnassignStudent(student, group, onRefresh)
            }, 'Guruhdan chiqarish')
          )
        )
      )
    )
  );

  return el('div', { className: 'table-container' },
    el('table', { className: 'data-table' },
      el('thead', {},
        el('tr', {},
          el('th', {}, 'F.I.SH.'),
          el('th', {}, 'Telefon raqami'),
          el('th', { className: 'col-numeric' }, 'Oylik to\'lov'),
          el('th', {}, 'Qo\'shilgan sana'),
          el('th', { className: 'col-actions' }, 'Amallar')
        )
      ),
      tbody
    )
  );
}

/**
 * Confirmation modal for unassigning a student from the group.
 *
 * @param {Object} student
 * @param {Object} group
 * @param {() => void} onSuccess
 */
function confirmUnassignStudent(student, group, onSuccess) {
  const body = el('div', {},
    el('p', { style: 'color: var(--text-primary); font-size: 0.9375rem; margin-bottom: var(--space-3);' },
      el('strong', {}, student.full_name),
      ' ni ',
      el('strong', {}, group.name),
      ' guruhidan chiqarishni tasdiqlaysizmi?'
    ),
    el('p', { style: 'font-size: 0.875rem; color: var(--text-secondary); line-height: 1.5;' },
      'O\'quvchi tizimdan o\'chirilmaydi, faqatgina ushbu guruhga biriktiruvi bekor qilinadi (Guruhsiz holatiga o\'tadi).'
    )
  );

  const footer = el('div', { style: 'display: flex; gap: var(--space-3); justify-content: flex-end;' },
    el('button', {
      type: 'button',
      className: 'btn btn-secondary',
      onClick: closeModal
    }, 'Bekor qilish'),
    el('button', {
      type: 'button',
      className: 'btn btn-danger',
      onClick: async (e) => {
        const btn = e.currentTarget || e.target;
        if (btn) btn.disabled = true;
        try {
          await updateStudent(student.id, { group_id: null });
          closeModal();
          showToast(`${student.full_name} guruhdan chiqarildi!`, 'success');
          onSuccess();
        } catch (err) {
          if (btn) btn.disabled = false;
          showToast(err.message || 'Xatolik yuz berdi.', 'error');
        }
      }
    }, 'Guruhdan chiqarish')
  );

  openModal({
    title: 'Guruhdan chiqarishni tasdiqlash',
    body,
    footer
  });
}
