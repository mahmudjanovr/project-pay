/**
 * Groups Management View for Ecomdev.
 * Provides group listing with assigned student counts, creating, renaming, and safe deletion.
 */

import { fetchGroups, createGroup, updateGroup, deleteGroup } from '../api.js';
import { formatDate } from '../formatters.js';
import { el, clearElement } from '../dom.js';
import { openModal, closeModal } from '../modal.js';
import { showToast } from '../notifications.js';
import { createPageShell, renderStateView } from '../pageLayout.js';

/**
 * Renders the Groups management interface into the target container.
 *
 * @param {HTMLElement} container
 * @param {URLSearchParams} [queryParams]
 */
export async function renderGroups(container, queryParams = new URLSearchParams()) {
  const loadingEl = el('div', { className: 'loading-indicator' },
    el('div', { className: 'spinner' }),
    el('p', {}, 'Guruhlar ro\'yxati yuklanmoqda...')
  );
  renderStateView(container, loadingEl);

  try {
    const groups = await fetchGroups();
    clearElement(container);

    // Calculate total assigned students across all groups
    const totalAssignedStudents = groups.reduce((sum, g) => sum + (g.student_count || 0), 0);

    // Page Header
    const pageHeader = el('div', { className: 'page-header' },
      el('div', {},
        el('h1', { className: 'page-title' }, 'Guruhlar'),
        el('p', { className: 'page-description' }, 'O\'quv markazidagi barcha guruhlar va ulardagi o\'quvchilar soni')
      ),
      el('div', { className: 'page-actions' },
        el('button', {
          type: 'button',
          className: 'btn btn-primary',
          onClick: () => showAddGroupModal(() => renderGroups(container))
        }, '+ Yangi guruh ochish')
      )
    );

    // Summary Stat Cards
    const statsGrid = el('div', { className: 'stats-grid', style: 'margin-bottom: var(--space-6);' },
      el('div', { className: 'stat-card' },
        el('span', { className: 'stat-label' }, 'Jami guruhlar'),
        el('div', { className: 'stat-value' }, `${groups.length} ta`),
        el('span', { className: 'stat-desc' }, 'Faol o\'quv guruhlari soni')
      ),
      el('div', { className: 'stat-card accent-green' },
        el('span', { className: 'stat-label' }, 'Biriktirilgan o\'quvchilar'),
        el('div', { className: 'stat-value' }, `${totalAssignedStudents} nafar`),
        el('span', { className: 'stat-desc' }, 'Guruhlarga taqsimlangan barcha o\'quvchilar')
      )
    );

    const contentCard = el('div', { className: groups.length > 0 ? 'card card-table' : 'card' });

    if (groups.length === 0) {
      contentCard.appendChild(
        el('div', { className: 'empty-state' },
          el('div', { className: 'empty-state-icon' }, '📁'),
          el('h3', { className: 'empty-state-title' }, 'Hozircha guruhlar mavjud emas'),
          el('p', { className: 'empty-state-description' }, 'O\'quvchilarni guruhlarga ajratish va boshqarish uchun yangi guruh yarating.'),
          el('button', {
            type: 'button',
            className: 'btn btn-primary btn-sm',
            onClick: () => showAddGroupModal(() => renderGroups(container))
          }, '+ Guruh yaratish')
        )
      );
    } else {
      const tbody = el('tbody', {},
        ...groups.map((group) =>
          el('tr', {
            style: 'cursor: pointer;',
            onClick: (e) => {
              if (e.target.closest('button') || e.target.closest('a')) return;
              window.location.hash = `#/groups/${group.id}`;
            }
          },
            el('td', { style: 'font-weight: 600;' },
              el('a', {
                href: `#/groups/${group.id}`,
                style: 'color: var(--text-primary); text-decoration: none;',
                title: `${group.name} tafsilotlarini ko'rish`
              }, group.name)
            ),
            el('td', { className: 'col-numeric' },
              el('span', {
                className: group.student_count > 0 ? 'badge-group' : '',
                style: group.student_count > 0 ? 'color: var(--accent-primary); font-weight: 600;' : 'color: var(--text-muted);'
              }, `${group.student_count} nafar`)
            ),
            el('td', { style: 'color: var(--text-muted); font-size: 0.8125rem;' }, formatDate(group.created_at)),
            el('td', { className: 'col-actions' },
              el('div', { style: 'display: flex; gap: var(--space-2); justify-content: flex-end;' },
                el('a', {
                  href: `#/groups/${group.id}`,
                  className: 'btn btn-secondary btn-sm',
                  title: 'Guruh o\'quvchilarini ko\'rish'
                }, 'O\'quvchilar'),
                el('button', {
                  type: 'button',
                  className: 'btn btn-secondary btn-sm',
                  title: 'Guruh nomini tahrirlash',
                  onClick: () => showEditGroupModal(group, () => renderGroups(container))
                }, 'Tahrirlash'),
                el('button', {
                  type: 'button',
                  className: 'btn btn-danger-outline btn-sm',
                  title: 'Guruhni o\'chirish',
                  onClick: () => confirmDeleteGroup(group, () => renderGroups(container))
                }, 'O\'chirish')
              )
            )
          )
        )
      );

      const table = el('div', { className: 'table-container' },
        el('table', { className: 'data-table' },
          el('thead', {},
            el('tr', {},
              el('th', {}, 'Guruh nomi'),
              el('th', { className: 'col-numeric' }, 'O\'quvchilar soni'),
              el('th', {}, 'Yaratilgan sana'),
              el('th', { className: 'col-actions' }, 'Amallar')
            )
          ),
          tbody
        )
      );

      contentCard.appendChild(table);
    }

    const shell = createPageShell({
      header: pageHeader,
      body: [statsGrid, contentCard]
    });
    container.appendChild(shell.element);

    // Auto-open modal if query parameter action=new is present
    if (queryParams.get('action') === 'new') {
      showAddGroupModal(() => renderGroups(container));
    }

  } catch (err) {
    renderStateView(
      container,
      el('div', { className: 'error-banner' },
        el('span', {}, err.message || 'Guruhlar ma\'lumotini yuklashda xatolik yuz berdi.'),
        el('button', {
          className: 'btn btn-secondary btn-sm',
          onClick: () => renderGroups(container, queryParams)
        }, 'Qayta urinish')
      )
    );
  }
}

/**
 * Modal dialog for creating a new group.
 *
 * @param {() => void} onSuccess
 */
export function showAddGroupModal(onSuccess) {
  const nameInputId = 'add-group-name';
  const nameInput = el('input', {
    type: 'text',
    id: nameInputId,
    className: 'form-input',
    placeholder: 'Masalan: Frontend Dasturlash',
    maxlength: '150',
    required: true,
    autocomplete: 'off'
  });

  const errorBox = el('div', {
    className: 'form-error',
    style: 'display: none; margin-top: var(--space-3);'
  });

  const form = el('form', {
    novalidate: true,
    onSubmit: async (e) => {
      e.preventDefault();
      errorBox.style.display = 'none';

      const nameVal = nameInput.value.trim();
      if (!nameVal) {
        errorBox.textContent = 'Guruh nomi bo\'sh bo\'lishi mumkin emas.';
        errorBox.style.display = 'block';
        nameInput.focus();
        return;
      }

      if (nameVal.length > 150) {
        errorBox.textContent = 'Guruh nomi 150 ta belgidan oshmasligi kerak.';
        errorBox.style.display = 'block';
        nameInput.focus();
        return;
      }

      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;

      try {
        await createGroup({ name: nameVal });
        closeModal();
        showToast('Guruh muvaffaqiyatli yaratildi!', 'success');
        if (typeof onSuccess === 'function') onSuccess();
      } catch (err) {
        errorBox.textContent = err.message || 'Guruhni saqlashda xatolik yuz berdi.';
        errorBox.style.display = 'block';
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    }
  },
    el('div', { className: 'form-group' },
      el('label', { className: 'form-label required', for: nameInputId }, 'Guruh nomi'),
      nameInput,
      el('span', { className: 'form-help' }, 'O\'quv kursi yoki guruhning aniq nomini kiriting.')
    ),
    errorBox,
    el('div', { className: 'modal-footer', style: 'padding: var(--space-4) 0 0 0; background: none; border: none;' },
      el('button', {
        type: 'button',
        className: 'btn btn-secondary',
        onClick: closeModal
      }, 'Bekor qilish'),
      el('button', {
        type: 'submit',
        className: 'btn btn-primary'
      }, 'Saqlash')
    )
  );

  openModal({
    title: 'Yangi guruh ochish',
    body: form
  });
}

/**
 * Modal dialog for renaming an existing group.
 *
 * @param {Object} group
 * @param {() => void} onSuccess
 */
export function showEditGroupModal(group, onSuccess) {
  const nameInputId = `edit-group-name-${group.id}`;
  const nameInput = el('input', {
    type: 'text',
    id: nameInputId,
    className: 'form-input',
    value: group.name,
    maxlength: '150',
    required: true,
    autocomplete: 'off'
  });

  const errorBox = el('div', {
    className: 'form-error',
    style: 'display: none; margin-top: var(--space-3);'
  });

  const form = el('form', {
    novalidate: true,
    onSubmit: async (e) => {
      e.preventDefault();
      errorBox.style.display = 'none';

      const nameVal = nameInput.value.trim();
      if (!nameVal) {
        errorBox.textContent = 'Guruh nomi bo\'sh bo\'lishi mumkin emas.';
        errorBox.style.display = 'block';
        nameInput.focus();
        return;
      }

      if (nameVal.length > 150) {
        errorBox.textContent = 'Guruh nomi 150 ta belgidan oshmasligi kerak.';
        errorBox.style.display = 'block';
        nameInput.focus();
        return;
      }

      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;

      try {
        await updateGroup(group.id, { name: nameVal });
        closeModal();
        showToast('Guruh nomi yangilandi!', 'success');
        if (typeof onSuccess === 'function') onSuccess();
      } catch (err) {
        errorBox.textContent = err.message || 'Guruhni yangilashda xatolik yuz berdi.';
        errorBox.style.display = 'block';
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    }
  },
    el('div', { className: 'form-group' },
      el('label', { className: 'form-label required', for: nameInputId }, 'Guruh nomi'),
      nameInput
    ),
    errorBox,
    el('div', { className: 'modal-footer', style: 'padding: var(--space-4) 0 0 0; background: none; border: none;' },
      el('button', {
        type: 'button',
        className: 'btn btn-secondary',
        onClick: closeModal
      }, 'Bekor qilish'),
      el('button', {
        type: 'submit',
        className: 'btn btn-primary'
      }, 'Yangilash')
    )
  );

  openModal({
    title: 'Guruh nomini tahrirlash',
    body: form
  });
}

/**
 * Confirmation modal for deleting a group.
 * Explains clearly why groups with assigned students cannot be deleted.
 *
 * @param {Object} group
 * @param {() => void} onSuccess
 */
export function confirmDeleteGroup(group, onSuccess) {
  if (group.student_count > 0) {
    const body = el('div', {},
      el('p', { style: 'color: var(--text-primary); font-size: 0.9375rem; margin-bottom: var(--space-3);' },
        el('strong', {}, group.name),
        ` nomli guruhda `,
        el('strong', { style: 'color: var(--status-danger);' }, `${group.student_count} nafar`),
        ` o'quvchi biriktirilgan.`
      ),
      el('p', { style: 'font-size: 0.875rem; color: var(--text-secondary); line-height: 1.5;' },
        'Ushbu guruhda o\'quvchilar mavjud bo\'lganligi sababli uni o\'chirib bo\'lmaydi. Guruhni o\'chirish uchun avval undagi barcha o\'quvchilarni boshqa guruhga o\'tkazing yoki ularni guruhsiz qoldiring.'
      )
    );

    const footer = el('div', { style: 'display: flex; justify-content: flex-end;' },
      el('button', {
        type: 'button',
        className: 'btn btn-secondary',
        onClick: closeModal
      }, 'Tushunarli')
    );

    openModal({
      title: 'Guruhni o\'chirib bo\'lmaydi',
      body,
      footer
    });
    return;
  }

  // Group has 0 students: safe to delete
  const errorBox = el('div', {
    className: 'form-error',
    style: 'display: none; margin-top: var(--space-3);'
  });

  const body = el('div', {},
    el('p', {},
      el('strong', {}, group.name),
      ' nomli bo\'sh guruhni o\'chirishni tasdiqlaysizmi?'
    ),
    el('p', { style: 'font-size: 0.8125rem; color: var(--text-muted); margin-top: var(--space-2);' },
      'Ushbu guruhda hech qanday o\'quvchi yo\'q. Guruh butunlay o\'chiriladi.'
    ),
    errorBox
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
        errorBox.style.display = 'none';

        try {
          await deleteGroup(group.id);
          closeModal();
          showToast('Guruh muvaffaqiyatli o\'chirildi.', 'success');
          if (typeof onSuccess === 'function') onSuccess();
        } catch (err) {
          if (btn) btn.disabled = false;
          errorBox.textContent = err.message || 'O\'chirishda xatolik yuz berdi.';
          errorBox.style.display = 'block';
        }
      }
    }, 'O\'chirish')
  );

  openModal({
    title: 'Guruhni o\'chirish',
    body,
    footer
  });
}
