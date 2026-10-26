/**
 * Students Management View for Project Pay.
 * Provides student listing with group tags, real-time filtering, adding, editing, and deletion with conflict safety.
 */

import { fetchStudents, fetchGroups, createStudent, updateStudent, deleteStudent } from '../api.js';
import { formatUzbekSom, formatDate } from '../formatters.js';
import { parseMonthlyFee } from '../amountParser.js';
import { el, clearElement } from '../dom.js';
import { openModal, closeModal } from '../modal.js';
import { showToast } from '../notifications.js';
import { createGroupCombobox } from '../groupCombobox.js';
import { createPageShell, createSectionToolbar, renderStateView } from '../pageLayout.js';

/**
 * Renders the Students list and CRUD interface into the target container.
 *
 * @param {HTMLElement} container
 * @param {URLSearchParams} [queryParams]
 */
export async function renderStudents(container, queryParams = new URLSearchParams(), initialState = {}) {
  const loadingEl = el('div', { className: 'loading-indicator' },
    el('div', { className: 'spinner' }),
    el('p', {}, 'O\'quvchilar ro\'yxati yuklanmoqda...')
  );
  renderStateView(container, loadingEl);

  try {
    const [students, groups] = await Promise.all([
      fetchStudents(),
      fetchGroups()
    ]);
    clearElement(container);

    const PAGE_SIZE = 100;
    const initialFilterRaw = typeof initialState.filter === 'string' ? initialState.filter : '';
    let currentFilter = initialFilterRaw.trim().toLowerCase();
    let currentPage = Number.isSafeInteger(initialState.page) && initialState.page > 0 ? initialState.page : 1;

    // Search and Filter Toolbar Input
    const searchInput = el('input', {
      type: 'search',
      className: 'form-input search-input',
      value: initialFilterRaw || undefined,
      placeholder: 'F.I.SH. yoki telefon bo\'yicha qidirish...',
      'aria-label': 'O\'quvchilarni qidirish',
      onInput: (e) => {
        currentFilter = e.target.value.trim().toLowerCase();
        currentPage = 1;
        updateTable();
      }
    });

    const refreshStudentsView = () =>
      renderStudents(container, new URLSearchParams(), {
        filter: searchInput.value,
        page: currentPage
      });

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
          onClick: () => showAddStudentModal(groups, refreshStudentsView)
        }, '+ Yangi o\'quvchi qo\'shish')
      )
    );

    const countBadge = el('span', { id: 'students-count-badge' }, `Jami: ${students.length} nafar`);

    const searchToolbar = createSectionToolbar(
      el('div', { className: 'search-input-wrapper' },
        el('span', { className: 'search-icon', 'aria-hidden': 'true' }, '🔍'),
        searchInput
      ),
      countBadge
    );

    const tablePanel = el('div', { className: 'table-panel' });
    const shell = createPageShell({
      header: pageHeader,
      toolbar: searchToolbar,
      body: tablePanel,
      variant: 'table'
    });

    function updateTable() {
      const filtered = students.filter((s) =>
        s.full_name.toLowerCase().includes(currentFilter) ||
        (s.phone && s.phone.toLowerCase().includes(currentFilter))
      );

      const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
      if (currentPage > totalPages) {
        currentPage = totalPages;
      }

      const startIdx = (currentPage - 1) * PAGE_SIZE;
      const pageItems = filtered.slice(startIdx, startIdx + PAGE_SIZE);

      if (filtered.length > PAGE_SIZE) {
        countBadge.textContent = `Ko'rsatildi: ${startIdx + 1}–${startIdx + pageItems.length} / ${filtered.length} nafar (Jami: ${students.length})`;
      } else {
        countBadge.textContent = `Ko'rsatildi: ${filtered.length} / ${students.length} nafar`;
      }

      shell.bindScrollTarget(null);
      clearElement(tablePanel);

      if (filtered.length === 0) {
        if (students.length === 0) {
          tablePanel.appendChild(
            el('div', { className: 'empty-state' },
              el('div', { className: 'empty-state-icon' }, '👥'),
              el('h3', { className: 'empty-state-title' }, 'Hozircha o\'quvchilar yo\'q'),
              el('p', { className: 'empty-state-description' }, 'Markazga birinchi o\'quvchini ro\'yxatdan o\'tkazing.'),
              el('button', {
                type: 'button',
                className: 'btn btn-primary btn-sm',
                onClick: () => showAddStudentModal(groups, refreshStudentsView)
              }, '+ O\'quvchi qo\'shish')
            )
          );
        } else {
          tablePanel.appendChild(
            el('div', { className: 'empty-state' },
              el('div', { className: 'empty-state-icon' }, '🔍'),
              el('h3', { className: 'empty-state-title' }, 'O\'quvchi topilmadi'),
              el('p', { className: 'empty-state-description' }, `"${currentFilter}" so'rovi bo'yicha hech kim topilmadi.`),
              el('button', {
                type: 'button',
                className: 'btn btn-secondary btn-sm',
                onClick: () => {
                  searchInput.value = '';
                  currentFilter = '';
                  currentPage = 1;
                  updateTable();
                }
              }, 'Qidiruvni tozalash')
            )
          );
        }
        return;
      }

      const tbody = el('tbody', {},
        ...pageItems.map((student) =>
          el('tr', {},
            el('td', { style: 'font-weight: 500;' },
              el('a', {
                href: `#/students/${student.id}`,
                style: 'color: var(--text-primary); text-decoration: none;'
              }, student.full_name)
            ),
            el('td', { style: 'color: var(--text-secondary); font-size: 0.875rem;' },
              student.phone
                ? student.phone
                : el('span', { style: 'color: var(--text-muted); font-size: 0.8125rem;' }, '—')
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
                  onClick: () => showEditStudentModal(student, groups, refreshStudentsView)
                }, 'Tahrirlash'),
                el('button', {
                  type: 'button',
                  className: 'btn btn-danger-outline btn-sm',
                  title: 'O\'chirish',
                  onClick: () => confirmDeleteStudent(student, refreshStudentsView)
                }, 'O\'chirish')
              )
            )
          )
        )
      );

      const tableScroll = el('div', { className: 'table-container table-scroll' },
        el('table', { className: 'data-table' },
          el('thead', {},
            el('tr', {},
              el('th', {}, 'F.I.SH.'),
              el('th', {}, 'Telefon'),
              el('th', {}, 'Guruh'),
              el('th', { className: 'col-numeric' }, 'Oylik to\'lov'),
              el('th', {}, 'Qo\'shilgan sana'),
              el('th', { className: 'col-actions' }, 'Amallar')
            )
          ),
          tbody
        )
      );

      tablePanel.appendChild(tableScroll);
      shell.bindScrollTarget(tableScroll);

      if (totalPages > 1) {
        tablePanel.appendChild(
          el('div', { className: 'pagination-bar' },
            el('button', {
              type: 'button',
              className: 'btn btn-secondary btn-sm',
              disabled: currentPage <= 1,
              onClick: () => {
                if (currentPage > 1) {
                  currentPage -= 1;
                  updateTable();
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
                  updateTable();
                }
              }
            }, 'Keyingi →')
          )
        );
      }
    }

    updateTable();

    container.appendChild(shell.element);

    // Auto-open new student modal if query param action=new is passed
    if (queryParams.get('action') === 'new') {
      const rawGroupParam = queryParams.get('group_id');
      const parsedGroupId = rawGroupParam ? parseInt(rawGroupParam, 10) : null;
      const defaultGroupId = Number.isSafeInteger(parsedGroupId) && parsedGroupId > 0 ? parsedGroupId : null;
      showAddStudentModal(groups, refreshStudentsView, defaultGroupId);
    }

  } catch (err) {
    renderStateView(
      container,
      el('div', { className: 'error-banner' },
        el('span', {}, err.message || 'O\'quvchilarni yuklashda xatolik yuz berdi.'),
        el('button', {
          type: 'button',
          className: 'btn btn-secondary btn-sm',
          onClick: () => renderStudents(container, queryParams, initialState)
        }, 'Qayta urinish')
      )
    );
  }
}

/**
 * Creates a consistent monthly fee text input and live formatted UZS preview helper.
 * Avoids HTML <input type="number" step="1000"> locale comma/decimal and stepMismatch bugs.
 *
 * @param {{ id: string, initialValue?: number|null }} options
 * @returns {{ feeInput: HTMLInputElement, feePreview: HTMLElement }}
 */
function createMonthlyFeeField({ id, initialValue = null }) {
  const defaultHelpText = 'Grant/bepul o\'quvchilar uchun 0 deb kiriting.';
  const hasInitial = typeof initialValue === 'number' && Number.isSafeInteger(initialValue) && initialValue >= 0;

  const feePreview = el(
    'span',
    {
      className: 'form-help',
      style: hasInitial ? 'color: var(--accent-primary); font-weight: 600;' : undefined
    },
    hasInitial ? `Oylik to'lov: ${formatUzbekSom(initialValue)}` : defaultHelpText
  );

  const feeInput = el('input', {
    type: 'text',
    inputmode: 'numeric',
    autocomplete: 'off',
    id,
    className: 'form-input',
    value: hasInitial ? String(initialValue) : undefined,
    placeholder: 'Masalan: 450000 yoki 450,000',
    required: true,
    onInput: (e) => {
      const raw = e.target.value;
      if (!raw.trim()) {
        feePreview.textContent = defaultHelpText;
        feePreview.style.color = 'var(--text-muted)';
        feePreview.style.fontWeight = 'normal';
        return;
      }

      const result = parseMonthlyFee(raw);
      if (result.valid) {
        feePreview.textContent = `Oylik to'lov: ${result.formatted}`;
        feePreview.style.color = 'var(--accent-primary)';
        feePreview.style.fontWeight = '600';
      } else {
        feePreview.textContent = result.error;
        feePreview.style.color = 'var(--status-danger)';
        feePreview.style.fontWeight = 'normal';
      }
    }
  });

  return { feeInput, feePreview };
}

/**
 * Modal dialog for creating a new student with phone input and searchable group combobox.
 *
 * @param {Array<Object>} groups
 * @param {() => void} onSuccess
 * @param {number|null} [defaultGroupId=null]
 */
export function showAddStudentModal(groups, onSuccess, defaultGroupId = null) {
  const comboboxId = 'add-student-group-combobox';
  const nameInput = el('input', {
    type: 'text',
    id: 'add-student-name',
    className: 'form-input',
    placeholder: 'Masalan: Alisher Navoiy',
    maxlength: '200',
    required: true
  });

  const phoneInput = el('input', {
    type: 'tel',
    id: 'add-student-phone',
    className: 'form-input',
    placeholder: 'Masalan: +998 90 123 45 67',
    maxlength: '50',
    autocomplete: 'tel'
  });

  const { feeInput, feePreview } = createMonthlyFeeField({
    id: 'add-student-fee'
  });

  const groupCombobox = createGroupCombobox({
    groups,
    preselectedGroupId: defaultGroupId,
    id: comboboxId
  });

  const errorBox = el('div', { className: 'form-error', style: 'display: none; margin-top: var(--space-3);' });

  const form = el('form', {
    novalidate: true,
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

      if (fullName.length > 200) {
        errorBox.textContent = 'O\'quvchi F.I.SH. 200 ta belgidan oshmasligi kerak.';
        errorBox.style.display = 'block';
        nameInput.focus();
        return;
      }

      const rawPhone = phoneInput.value.trim();
      if (rawPhone.length > 50) {
        errorBox.textContent = 'Telefon raqami 50 ta belgidan oshmasligi kerak.';
        errorBox.style.display = 'block';
        phoneInput.focus();
        return;
      }
      const phoneVal = rawPhone || null;

      const feeResult = parseMonthlyFee(feeInput.value);
      if (!feeResult.valid) {
        errorBox.textContent = feeResult.error || 'Oylik to\'lov noldan kichik bo\'lmagan butun son bo\'lishi shart.';
        errorBox.style.display = 'block';
        feeInput.focus();
        return;
      }

      const groupIdVal = groupCombobox.getSelectedGroupId();

      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;

      try {
        await createStudent({
          full_name: fullName,
          phone: phoneVal,
          monthly_fee: feeResult.value,
          group_id: groupIdVal
        });
        groupCombobox.destroy();
        closeModal();
        showToast('O\'quvchi muvaffaqiyatli qo\'shildi!', 'success');
        if (typeof onSuccess === 'function') onSuccess();
      } catch (err) {
        errorBox.textContent = err.message || 'O\'quvchini saqlashda xatolik yuz berdi.';
        errorBox.style.display = 'block';
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    }
  },
    el('div', { className: 'form-group' },
      el('label', { className: 'form-label required', for: 'add-student-name' }, 'O\'quvchi F.I.SH.'),
      nameInput
    ),
    el('div', { className: 'form-group' },
      el('label', { className: 'form-label', for: 'add-student-phone' }, 'Telefon raqami'),
      phoneInput,
      el('span', { className: 'form-help' }, 'Bog\'lanish uchun telefon raqami (ixtiyoriy).')
    ),
    el('div', { className: 'form-group' },
      el('label', { className: 'form-label required', for: 'add-student-fee' }, 'Oylik to\'lov summasi (so\'mda)'),
      feeInput,
      feePreview
    ),
    el('div', { className: 'form-group' },
      el('label', {
        className: 'form-label',
        for: groups && groups.length > 0 ? `${comboboxId}-input` : undefined
      }, 'Guruh'),
      groupCombobox.element,
      el('span', { className: 'form-help' }, 'O\'quvchi biriktiriladigan guruhni tanlang yoki qidiring (ixtiyoriy).')
    ),
    errorBox,
    el('div', { className: 'modal-footer', style: 'padding: var(--space-4) 0 0 0; background: none; border: none;' },
      el('button', {
        type: 'button',
        className: 'btn btn-secondary',
        onClick: () => {
          groupCombobox.destroy();
          closeModal();
        }
      }, 'Bekor qilish'),
      el('button', {
        type: 'submit',
        className: 'btn btn-primary'
      }, 'Saqlash')
    )
  );

  openModal({
    title: 'Yangi o\'quvchi qo\'shish',
    body: form,
    onClose: () => {
      groupCombobox.destroy();
    }
  });
}

/**
 * Modal dialog for editing an existing student with phone input and searchable group combobox.
 *
 * @param {Object} student
 * @param {Array<Object>} groups
 * @param {() => void} onSuccess
 */
export function showEditStudentModal(student, groups, onSuccess) {
  const nameInputId = `edit-student-name-${student.id}`;
  const phoneInputId = `edit-student-phone-${student.id}`;
  const feeInputId = `edit-student-fee-${student.id}`;
  const comboboxId = `edit-student-group-combobox-${student.id}`;

  const nameInput = el('input', {
    type: 'text',
    id: nameInputId,
    className: 'form-input',
    value: student.full_name,
    maxlength: '200',
    required: true
  });

  const phoneInput = el('input', {
    type: 'tel',
    id: phoneInputId,
    className: 'form-input',
    value: student.phone || '',
    placeholder: 'Masalan: +998 90 123 45 67',
    maxlength: '50',
    autocomplete: 'tel'
  });

  const { feeInput, feePreview } = createMonthlyFeeField({
    id: feeInputId,
    initialValue: student.monthly_fee
  });

  const groupCombobox = createGroupCombobox({
    groups,
    preselectedGroupId: student.group_id,
    id: comboboxId
  });

  const errorBox = el('div', { className: 'form-error', style: 'display: none; margin-top: var(--space-3);' });

  const form = el('form', {
    novalidate: true,
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

      if (fullName.length > 200) {
        errorBox.textContent = 'O\'quvchi F.I.SH. 200 ta belgidan oshmasligi kerak.';
        errorBox.style.display = 'block';
        nameInput.focus();
        return;
      }

      const rawPhone = phoneInput.value.trim();
      if (rawPhone.length > 50) {
        errorBox.textContent = 'Telefon raqami 50 ta belgidan oshmasligi kerak.';
        errorBox.style.display = 'block';
        phoneInput.focus();
        return;
      }
      const phoneVal = rawPhone || null;

      const feeResult = parseMonthlyFee(feeInput.value);
      if (!feeResult.valid) {
        errorBox.textContent = feeResult.error || 'Oylik to\'lov noldan kichik bo\'lmagan butun son bo\'lishi shart.';
        errorBox.style.display = 'block';
        feeInput.focus();
        return;
      }

      const groupIdVal = groupCombobox.getSelectedGroupId();

      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;

      try {
        await updateStudent(student.id, {
          full_name: fullName,
          phone: phoneVal,
          monthly_fee: feeResult.value,
          group_id: groupIdVal
        });
        groupCombobox.destroy();
        closeModal();
        showToast('O\'quvchi ma\'lumotlari yangilandi!', 'success');
        if (typeof onSuccess === 'function') onSuccess();
      } catch (err) {
        errorBox.textContent = err.message || 'Yangilashda xatolik yuz berdi.';
        errorBox.style.display = 'block';
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    }
  },
    el('div', { className: 'form-group' },
      el('label', { className: 'form-label required', for: nameInputId }, 'O\'quvchi F.I.SH.'),
      nameInput
    ),
    el('div', { className: 'form-group' },
      el('label', { className: 'form-label', for: phoneInputId }, 'Telefon raqami'),
      phoneInput,
      el('span', { className: 'form-help' }, 'Raqamni o\'chirish uchun bo\'sh qoldiring.')
    ),
    el('div', { className: 'form-group' },
      el('label', { className: 'form-label required', for: feeInputId }, 'Oylik to\'lov summasi (so\'mda)'),
      feeInput,
      feePreview
    ),
    el('div', { className: 'form-group' },
      el('label', {
        className: 'form-label',
        for: groups && groups.length > 0 ? `${comboboxId}-input` : undefined
      }, 'Guruh'),
      groupCombobox.element,
      el('span', { className: 'form-help' }, 'O\'quvchi biriktiriladigan guruhni tanlang yoki qidiring.')
    ),
    errorBox,
    el('div', { className: 'modal-footer', style: 'padding: var(--space-4) 0 0 0; background: none; border: none;' },
      el('button', {
        type: 'button',
        className: 'btn btn-secondary',
        onClick: () => {
          groupCombobox.destroy();
          closeModal();
        }
      }, 'Bekor qilish'),
      el('button', {
        type: 'submit',
        className: 'btn btn-primary'
      }, 'Yangilash')
    )
  );

  openModal({
    title: 'O\'quvchi ma\'lumotlarini tahrirlash',
    body: form,
    onClose: () => {
      groupCombobox.destroy();
    }
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
        const btn = e.currentTarget || e.target;
        if (btn) btn.disabled = true;
        errorBox.style.display = 'none';

        try {
          await deleteStudent(student.id);
          closeModal();
          showToast('O\'quvchi muvaffaqiyatli o\'chirildi.', 'success');
          onSuccess();
        } catch (err) {
          if (btn) btn.disabled = false;
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
