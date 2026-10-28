/**
 * Dedicated Group Details View for Ecomdev.
 * Displays group information, assigned students, group actions,
 * and existing registered student assignment to the group.
 */

import {
  fetchGroup,
  fetchGroupStudents,
  fetchGroups,
  fetchStudents,
  assignStudentsToGroup,
  updateStudent
} from '../api.js';
import { formatUzbekSom, formatDate } from '../formatters.js';
import { el, clearElement } from '../dom.js';
import { showToast } from '../notifications.js';
import { openModal, closeModal } from '../modal.js';
import { showEditStudentModal } from './students.js';
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
          id: 'btn-group-add-student',
          className: 'btn btn-primary',
          title: 'Mavjud o\'quvchilarni ushbu guruhga biriktirish',
          onClick: () => showAssignExistingStudentsModal(
            group,
            () => renderGroupDetail(container, numericGroupId)
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

    // Auto-open assignment modal if query parameter action=add_student is passed
    if (queryParams.get('action') === 'add_student') {
      showAssignExistingStudentsModal(
        group,
        () => renderGroupDetail(container, numericGroupId)
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
 * Modal to select and assign existing registered students to a group.
 * Does NOT open new student registration form.
 *
 * @param {Object} group
 * @param {() => void} onRefresh
 */
export async function showAssignExistingStudentsModal(group, onRefresh) {
  const modalBody = el('div', { style: 'min-height: 250px;' },
    el('div', { className: 'loading-indicator' },
      el('div', { className: 'spinner' }),
      el('p', {}, 'Mavjud o\'quvchilar ro\'yxati yuklanmoqda...')
    )
  );

  const errorBox = el('div', {
    className: 'form-error',
    style: 'display: none; margin-bottom: var(--space-3);'
  });

  const countBadge = el('span', {
    style: 'font-size: 0.875rem; color: var(--text-secondary); margin-right: auto;'
  }, 'Tanlandi: 0 nafar');

  const submitBtn = el('button', {
    type: 'button',
    className: 'btn btn-primary',
    disabled: true,
    id: 'btn-assign-students-submit'
  }, 'Biriktirish (0 ta)');

  const footer = el('div', {
    style: 'display: flex; gap: var(--space-3); align-items: center; justify-content: flex-end; width: 100%;'
  },
    countBadge,
    el('button', {
      type: 'button',
      className: 'btn btn-secondary',
      onClick: closeModal
    }, 'Bekor qilish'),
    submitBtn
  );

  openModal({
    title: `Guruhga mavjud o'quvchilarni biriktirish: ${group.name}`,
    body: el('div', {}, errorBox, modalBody),
    footer
  });

  try {
    const allStudents = await fetchStudents();
    clearElement(modalBody);

    if (allStudents.length === 0) {
      modalBody.appendChild(
        el('div', { className: 'empty-state' },
          el('div', { className: 'empty-state-icon' }, '👥'),
          el('h3', { className: 'empty-state-title' }, 'Tizimda o\'quvchilar mavjud emas'),
          el('p', { className: 'empty-state-description' },
            'Avval "O\'quvchilar" bo\'limida o\'quvchilarni ro\'yxatdan o\'tkazing.'
          )
        )
      );
      return;
    }

    const selectedStudentIds = new Set();
    let filterQuery = '';

    // Search Input
    const searchInput = el('input', {
      type: 'search',
      className: 'form-input',
      id: 'assign-student-search',
      placeholder: 'O\'quvchi F.I.SH. yoki telefon raqami bo\'yicha qidirish...',
      style: 'margin-bottom: var(--space-3);',
      onInput: (e) => {
        filterQuery = (e.target.value || '').trim().toLowerCase();
        renderStudentList();
      }
    });

    const listContainer = el('div', {
      className: 'table-container',
      style: 'max-height: 340px; overflow-y: auto; border: 1px solid var(--border-light); border-radius: var(--radius-md);'
    });

    modalBody.appendChild(searchInput);
    modalBody.appendChild(listContainer);

    function updateCounter() {
      const count = selectedStudentIds.size;
      countBadge.textContent = `Tanlandi: ${count} nafar`;
      submitBtn.textContent = `Biriktirish (${count} ta)`;
      submitBtn.disabled = count === 0;
    }

    function renderStudentList() {
      clearElement(listContainer);

      const filtered = allStudents.filter((s) => {
        if (!filterQuery) return true;
        const nameMatch = s.full_name && s.full_name.toLowerCase().includes(filterQuery);
        const phoneMatch = s.phone && s.phone.toLowerCase().includes(filterQuery);
        return nameMatch || phoneMatch;
      });

      if (filtered.length === 0) {
        listContainer.appendChild(
          el('div', { style: 'padding: var(--space-6); text-align: center; color: var(--text-muted); font-size: 0.875rem;' },
            'Qidiruv natijasida hech qanday o\'quvchi topilmadi.'
          )
        );
        return;
      }

      const rows = filtered.map((student) => {
        const isCurrentGroup = student.group_id === group.id;
        const hasOtherGroup = student.group_id && student.group_id !== group.id;

        const checkbox = el('input', {
          type: 'checkbox',
          className: 'assign-student-checkbox',
          disabled: isCurrentGroup,
          checked: isCurrentGroup || selectedStudentIds.has(student.id),
          onChange: (e) => {
            if (e.target.checked) {
              selectedStudentIds.add(student.id);
            } else {
              selectedStudentIds.delete(student.id);
            }
            updateCounter();
          }
        });

        let groupBadge;
        if (isCurrentGroup) {
          groupBadge = el('span', {
            className: 'badge',
            style: 'background: rgba(59, 130, 246, 0.15); color: var(--accent-primary); font-size: 0.75rem;'
          }, 'Joriy guruhda');
        } else if (hasOtherGroup) {
          groupBadge = el('span', {
            className: 'badge',
            style: 'background: rgba(245, 158, 11, 0.15); color: var(--status-warning); font-size: 0.75rem;'
          }, `Guruh: ${student.group_name}`);
        } else {
          groupBadge = el('span', {
            className: 'badge',
            style: 'background: rgba(148, 163, 184, 0.15); color: var(--text-muted); font-size: 0.75rem;'
          }, 'Guruhsiz');
        }

        const tr = el('tr', {
          style: isCurrentGroup ? 'opacity: 0.6; background-color: var(--bg-surface);' : 'cursor: pointer;',
          onClick: (e) => {
            if (isCurrentGroup) return;
            if (e.target.tagName !== 'INPUT') {
              checkbox.checked = !checkbox.checked;
              checkbox.dispatchEvent(new Event('change'));
            }
          }
        },
          el('td', { style: 'width: 38px; text-align: center;' }, checkbox),
          el('td', { style: 'font-weight: 500;' },
            el('div', {}, student.full_name),
            student.phone ? el('small', { style: 'color: var(--text-muted); font-size: 0.8125rem;' }, student.phone) : null
          ),
          el('td', { className: 'col-numeric' }, formatUzbekSom(student.monthly_fee)),
          el('td', {}, groupBadge)
        );

        return tr;
      });

      const table = el('table', { className: 'data-table', style: 'margin: 0;' },
        el('thead', {},
          el('tr', {},
            el('th', { style: 'width: 38px;' }, ''),
            el('th', {}, 'F.I.SH. va telefon'),
            el('th', { className: 'col-numeric' }, 'Oylik to\'lov'),
            el('th', {}, 'Joriy holati')
          )
        ),
        el('tbody', {}, ...rows)
      );

      listContainer.appendChild(table);
    }

    renderStudentList();

    // Setup submit handler with double-click protection
    let isSubmitting = false;
    submitBtn.onclick = async () => {
      if (isSubmitting || selectedStudentIds.size === 0) return;
      isSubmitting = true;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Biriktirilmoqda...';
      errorBox.style.display = 'none';

      try {
        const idsToAssign = Array.from(selectedStudentIds);
        await assignStudentsToGroup(group.id, idsToAssign);
        closeModal();
        showToast(
          `${idsToAssign.length} nafar o'quvchi "${group.name}" guruhiga muvaffaqiyatli biriktirildi!`,
          'success'
        );
        onRefresh();
      } catch (err) {
        isSubmitting = false;
        submitBtn.disabled = false;
        submitBtn.textContent = `Biriktirish (${selectedStudentIds.size} ta)`;
        errorBox.textContent = err.message || 'O\'quvchilarni guruhga biriktirishda xatolik yuz berdi.';
        errorBox.style.display = 'block';
      }
    };

  } catch (err) {
    clearElement(modalBody);
    modalBody.appendChild(
      el('div', { className: 'error-banner' },
        el('span', {}, err.message || 'O\'quvchilar ro\'yxatini yuklashda xatolik yuz berdi.')
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
        'Guruhga mavjud o\'quvchilarni biriktirish uchun quyidagi tugmani bosing.'
      ),
      el('button', {
        type: 'button',
        className: 'btn btn-primary btn-sm',
        onClick: () => showAssignExistingStudentsModal(group, onRefresh)
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
