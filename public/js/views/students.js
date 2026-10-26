/**
 * Students Management View for Project Pay.
 * Provides student listing with group tags, real-time filtering, adding, editing, and deletion with conflict safety.
 */

import { fetchStudents, fetchGroups, createStudent, updateStudent, deleteStudent } from '../api.js';
import { formatUzbekSom, formatDate } from '../formatters.js';
import { el, clearElement } from '../dom.js';
import { openModal, closeModal } from '../modal.js';
import { showToast } from '../notifications.js';

/**
 * Renders the Students list and CRUD interface into the target container.
 *
 * @param {HTMLElement} container
 * @param {URLSearchParams} [queryParams]
 */
export async function renderStudents(container, queryParams = new URLSearchParams()) {
  clearElement(container);

  const loadingEl = el('div', { className: 'loading-indicator' },
    el('div', { className: 'spinner' }),
    el('p', {}, 'O\'quvchilar ro\'yxati yuklanmoqda...')
  );
  container.appendChild(loadingEl);

  try {
    const [students, groups] = await Promise.all([
      fetchStudents(),
      fetchGroups()
    ]);
    clearElement(container);

    let currentFilter = '';

    // Page Header
    const pageHeader = el('div', { className: 'page-header' },
      el('div', {},
        el('h1', { className: 'page-title' }, 'O\'quvchilar'),
        el('p', { className: 'page-description' }, 'O\'quv markazining barcha talabalari va ularning to\'lov stavkalari')
      ),
      el('div', { className: 'page-actions' },
        el('button', {
          type: 'button',
          className: 'btn btn-primary',
          onClick: () => showAddStudentModal(groups, () => renderStudents(container))
        }, '+ Yangi o\'quvchi qo\'shish')
      )
    );

    // Search and Filter Bar Card
    const searchInput = el('input', {
      type: 'search',
      className: 'form-input search-input',
      placeholder: 'F.I.SH. bo\'yicha qidirish...',
      'aria-label': 'O\'quvchilarni qidirish',
      onInput: (e) => {
        currentFilter = e.target.value.trim().toLowerCase();
        updateTable();
      }
    });

    const searchCard = el('div', { className: 'card', style: 'margin-bottom: var(--space-6);' },
      el('div', { className: 'card-body', style: 'padding: var(--space-4) var(--space-6); display: flex; justify-content: space-between; align-items: center; gap: var(--space-4); flex-wrap: wrap;' },
        el('div', { className: 'search-input-wrapper' },
          el('span', { className: 'search-icon' }, '🔍'),
          searchInput
        ),
        el('div', { style: 'font-size: 0.875rem; color: var(--text-muted);' },
          el('span', { id: 'students-count-badge' }, `Jami: ${students.length} nafar`)
        )
      )
    );

    const tableWrapper = el('div', { className: 'table-container' });

    function updateTable() {
      const filtered = students.filter((s) =>
        s.full_name.toLowerCase().includes(currentFilter)
      );

      const countBadge = document.getElementById('students-count-badge');
      if (countBadge) {
        countBadge.textContent = `Ko'rsatildi: ${filtered.length} / ${students.length} nafar`;
      }

      clearElement(tableWrapper);

      if (filtered.length === 0) {
        if (students.length === 0) {
          tableWrapper.appendChild(
            el('div', { className: 'empty-state' },
              el('div', { className: 'empty-state-icon' }, '👥'),
              el('h3', { className: 'empty-state-title' }, 'Hozircha o\'quvchilar yo\'q'),
              el('p', { className: 'empty-state-description' }, 'Markazga birinchi o\'quvchini ro\'yxatdan o\'tkazing.'),
              el('button', {
                className: 'btn btn-primary btn-sm',
                onClick: () => showAddStudentModal(groups, () => renderStudents(container))
              }, '+ O\'quvchi qo\'shish')
            )
          );
        } else {
          tableWrapper.appendChild(
            el('div', { className: 'empty-state' },
              el('div', { className: 'empty-state-icon' }, '🔍'),
              el('h3', { className: 'empty-state-title' }, 'O\'quvchi topilmadi'),
              el('p', { className: 'empty-state-description' }, `"${currentFilter}" so'rovi bo'yicha hech kim topilmadi.`)
            )
          );
        }
        return;
      }

      const tbody = el('tbody', {},
        ...filtered.map((student) =>
          el('tr', {},
            el('td', { style: 'font-weight: 500;' },
              el('a', {
                href: `#/students/${student.id}`,
                style: 'color: var(--text-primary); text-decoration: none;'
              }, student.full_name)
            ),
            el('td', {},
              student.group_name
                ? el('span', { className: 'badge-group' }, student.group_name)
                : el('span', { style: 'color: var(--text-muted); font-size: 0.8125rem;' }, '—')
            ),
            el('td', { className: 'col-numeric' }, formatUzbekSom(student.monthly_fee)),
            el('td', { style: 'color: var(--text-muted); font-size: 0.8125rem;' }, formatDate(student.created_at)),
            el('td', { className: 'col-actions' },
              el('div', { style: 'display: flex; gap: var(--space-2); justify-content: flex-end;' },
                el('a', {
                  href: `#/students/${student.id}`,
                  className: 'btn btn-secondary btn-sm',
                  title: 'To\'lovlar tarixini ko\'rish'
                }, 'Tarix'),
                el('button', {
                  type: 'button',
                  className: 'btn btn-secondary btn-sm',
                  title: 'Tahrirlash',
                  onClick: () => showEditStudentModal(student, groups, () => renderStudents(container))
                }, 'Tahrirlash'),
                el('button', {
                  type: 'button',
                  className: 'btn btn-danger-outline btn-sm',
                  title: 'O\'chirish',
                  onClick: () => confirmDeleteStudent(student, () => renderStudents(container))
                }, 'O\'chirish')
              )
            )
          )
        )
      );

      tableWrapper.appendChild(
        el('table', { className: 'data-table' },
          el('thead', {},
            el('tr', {},
              el('th', {}, 'F.I.SH.'),
              el('th', {}, 'Guruh'),
              el('th', { className: 'col-numeric' }, 'Oylik to\'lov'),
              el('th', {}, 'Qo\'shilgan sana'),
              el('th', { className: 'col-actions' }, 'Amallar')
            )
          ),
          tbody
        )
      );
    }

    updateTable();

    container.appendChild(pageHeader);
    container.appendChild(searchCard);
    container.appendChild(tableWrapper);

    // Auto-open new student modal if query param action=new is passed
    if (queryParams.get('action') === 'new') {
      showAddStudentModal(groups, () => renderStudents(container));
    }

  } catch (err) {
    clearElement(container);
    container.appendChild(
      el('div', { className: 'error-banner' },
        el('span', {}, err.message || 'O\'quvchilarni yuklashda xatolik yuz berdi.'),
        el('button', {
          className: 'btn btn-secondary btn-sm',
          onClick: () => renderStudents(container)
        }, 'Qayta urinish')
      )
    );
  }
}

/**
 * Modal dialog for creating a new student with group selection.
 *
 * @param {Array<Object>} groups
 * @param {() => void} onSuccess
 */
function showAddStudentModal(groups, onSuccess) {
  const nameInput = el('input', {
    type: 'text',
    className: 'form-input',
    placeholder: 'Masalan: Alisher Navoiy',
    required: true
  });

  const feeInput = el('input', {
    type: 'number',
    className: 'form-input',
    placeholder: 'Masalan: 1200000',
    min: '0',
    step: '1000',
    required: true
  });

  const groupSelect = el('select', {
    className: 'form-select',
    id: 'student-group-select'
  },
    el('option', { value: '' }, '-- Guruhsiz --'),
    ...groups.map((g) => el('option', { value: String(g.id) }, g.name))
  );

  const groupHelp = groups.length === 0
    ? el('span', { className: 'form-help' },
        'Hozircha guruhlar mavjud emas. ',
        el('a', {
          href: '#/groups?action=new',
          onClick: closeModal,
          style: 'color: var(--accent-primary); font-weight: 500;'
        }, 'Guruh yaratish →')
      )
    : el('span', { className: 'form-help' }, 'O\'quvchi biriktiriladigan guruhni tanlang (ixtiyoriy).');

  const errorBox = el('div', { className: 'form-error', style: 'display: none; margin-top: var(--space-3);' });

  const form = el('form', {
    onSubmit: async (e) => {
      e.preventDefault();
      errorBox.style.display = 'none';

      const fullName = nameInput.value.trim();
      if (!fullName) {
        errorBox.textContent = 'O\'quvchi F.I.SH. bo\'sh bo\'lishi mumkin emas.';
        errorBox.style.display = 'block';
        nameInput.focus();
        return;
      }

      const feeVal = Number(feeInput.value);
      if (!Number.isSafeInteger(feeVal) || feeVal < 0) {
        errorBox.textContent = 'Oylik to\'lov noldan kichik bo\'lmagan butun son bo\'lishi shart.';
        errorBox.style.display = 'block';
        feeInput.focus();
        return;
      }

      const groupIdVal = groupSelect.value ? parseInt(groupSelect.value, 10) : null;

      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;

      try {
        await createStudent({ full_name: fullName, monthly_fee: feeVal, group_id: groupIdVal });
        closeModal();
        showToast('O\'quvchi muvaffaqiyatli qo\'shildi!', 'success');
        onSuccess();
      } catch (err) {
        errorBox.textContent = err.message || 'O\'quvchini saqlashda xatolik yuz berdi.';
        errorBox.style.display = 'block';
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    }
  },
    el('div', { className: 'form-group' },
      el('label', { className: 'form-label required' }, 'O\'quvchi F.I.SH.'),
      nameInput
    ),
    el('div', { className: 'form-group' },
      el('label', { className: 'form-label required' }, 'Oylik to\'lov summasi (so\'mda)'),
      feeInput,
      el('span', { className: 'form-help' }, 'Grant/bepul o\'quvchilar uchun 0 deb kiriting.')
    ),
    el('div', { className: 'form-group' },
      el('label', { className: 'form-label' }, 'Guruh'),
      groupSelect,
      groupHelp
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
    title: 'Yangi o\'quvchi qo\'shish',
    body: form
  });
}

/**
 * Modal dialog for editing an existing student with group assignment.
 *
 * @param {Object} student
 * @param {Array<Object>} groups
 * @param {() => void} onSuccess
 */
function showEditStudentModal(student, groups, onSuccess) {
  const nameInput = el('input', {
    type: 'text',
    className: 'form-input',
    value: student.full_name,
    required: true
  });

  const feeInput = el('input', {
    type: 'number',
    className: 'form-input',
    value: String(student.monthly_fee),
    min: '0',
    step: '1000',
    required: true
  });

  const groupSelect = el('select', {
    className: 'form-select',
    id: 'student-group-edit-select'
  },
    el('option', { value: '' }, '-- Guruhsiz --'),
    ...groups.map((g) => {
      const optProps = { value: String(g.id) };
      if (student.group_id && student.group_id === g.id) {
        optProps.selected = true;
      }
      return el('option', optProps, g.name);
    })
  );

  const errorBox = el('div', { className: 'form-error', style: 'display: none; margin-top: var(--space-3);' });

  const form = el('form', {
    onSubmit: async (e) => {
      e.preventDefault();
      errorBox.style.display = 'none';

      const fullName = nameInput.value.trim();
      if (!fullName) {
        errorBox.textContent = 'O\'quvchi F.I.SH. bo\'sh bo\'lishi mumkin emas.';
        errorBox.style.display = 'block';
        nameInput.focus();
        return;
      }

      const feeVal = Number(feeInput.value);
      if (!Number.isSafeInteger(feeVal) || feeVal < 0) {
        errorBox.textContent = 'Oylik to\'lov noldan kichik bo\'lmagan butun son bo\'lishi shart.';
        errorBox.style.display = 'block';
        feeInput.focus();
        return;
      }

      const groupIdVal = groupSelect.value ? parseInt(groupSelect.value, 10) : null;

      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;

      try {
        await updateStudent(student.id, { full_name: fullName, monthly_fee: feeVal, group_id: groupIdVal });
        closeModal();
        showToast('O\'quvchi ma\'lumotlari yangilandi!', 'success');
        onSuccess();
      } catch (err) {
        errorBox.textContent = err.message || 'Yangilashda xatolik yuz berdi.';
        errorBox.style.display = 'block';
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    }
  },
    el('div', { className: 'form-group' },
      el('label', { className: 'form-label required' }, 'O\'quvchi F.I.SH.'),
      nameInput
    ),
    el('div', { className: 'form-group' },
      el('label', { className: 'form-label required' }, 'Oylik to\'lov summasi (so\'mda)'),
      feeInput
    ),
    el('div', { className: 'form-group' },
      el('label', { className: 'form-label' }, 'Guruh'),
      groupSelect
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
    title: 'O\'quvchini tahrirlash',
    body: form
  });
}

/**
 * Confirmation modal for deleting a student with 409 conflict handling.
 */
function confirmDeleteStudent(student, onSuccess) {
  const errorBox = el('div', { className: 'form-error', style: 'display: none; margin-top: var(--space-3);' });

  const body = el('div', {},
    el('p', {},
      el('strong', {}, student.full_name),
      ' nomli o\'quvchini o\'chirishni tasdiqlaysizmi?'
    ),
    el('p', { style: 'font-size: 0.8125rem; color: var(--text-muted); margin-top: var(--space-2);' },
      'Eslatma: Agar o\'quvchida to\'lovlar tarixi mavjud bo\'lsa, u tizimdan o\'chirilmaydi.'
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
        const btn = e.target;
        btn.disabled = true;
        errorBox.style.display = 'none';

        try {
          await deleteStudent(student.id);
          closeModal();
          showToast('O\'quvchi muvaffaqiyatli o\'chirildi.', 'success');
          onSuccess();
        } catch (err) {
          btn.disabled = false;
          if (err.status === 409) {
            errorBox.textContent = 'Ushbu o\'quvchida to\'lovlar tarixi mavjud bo\'lganligi sababli uni o\'chirib bo\'lmaydi.';
          } else {
            errorBox.textContent = err.message || 'O\'chirishda xatolik yuz berdi.';
          }
          errorBox.style.display = 'block';
        }
      }
    }, 'O\'chirish')
  );

  openModal({
    title: 'O\'quvchini o\'chirish',
    body,
    footer
  });
}
