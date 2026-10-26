/**
 * Record Payment View for Project Pay.
 * Form for submitting payments with searchable student selection, robust amount parsing,
 * duplicate protection, and financial validation.
 */

import { fetchStudents, recordPayment } from '../api.js';
import { formatUzbekSom, getCurrentLocalDateString } from '../formatters.js';
import { parsePaymentAmount } from '../amountParser.js';
import { createStudentCombobox } from '../studentCombobox.js';
import { el, clearElement } from '../dom.js';
import { showToast } from '../notifications.js';

/**
 * Renders the Record Payment form view into the target container.
 *
 * @param {HTMLElement} container
 * @param {URLSearchParams} [queryParams]
 */
export async function renderPayments(container, queryParams = new URLSearchParams()) {
  clearElement(container);

  const loadingEl = el('div', { className: 'loading-indicator' },
    el('div', { className: 'spinner' }),
    el('p', {}, 'To\'lov formasi yuklanmoqda...')
  );
  container.appendChild(loadingEl);

  try {
    const students = await fetchStudents();
    clearElement(container);

    const preselectedStudentId = queryParams.get('student_id');

    // Page Header
    const pageHeader = el('div', { className: 'page-header' },
      el('div', {},
        el('h1', { className: 'page-title' }, 'To\'lov qabul qilish'),
        el('p', { className: 'page-description' }, 'O\'quvchi hisobiga amalga oshirilgan to\'lovni qayd etish')
      )
    );

    if (students.length === 0) {
      container.appendChild(pageHeader);
      container.appendChild(
        el('div', { className: 'card' },
          el('div', { className: 'empty-state' },
            el('div', { className: 'empty-state-icon' }, '⚠️'),
            el('h3', { className: 'empty-state-title' }, 'O\'quvchilar mavjud emas'),
            el('p', { className: 'empty-state-description' }, 'To\'lov kiritish uchun avval kamida bitta o\'quvchini ro\'yxatdan o\'tkazishingiz kerak.'),
            el('a', {
              href: '#/students?action=new',
              className: 'btn btn-primary btn-sm'
            }, '+ O\'quvchi qo\'shish')
          )
        )
      );
      return;
    }

    // Accessible Searchable Student Combobox
    const studentCombobox = createStudentCombobox({
      students,
      preselectedStudentId
    });

    const amountPreview = el('span', { className: 'form-help' }, 'Summa: 0 so\'m');

    // Text input with numeric inputmode: supports plain digits, comma, and space separators
    const amountInput = el('input', {
      type: 'text',
      inputmode: 'numeric',
      autocomplete: 'off',
      className: 'form-input',
      id: 'payment-amount-input',
      placeholder: 'Masalan: 120000 yoki 120,000',
      required: true,
      onInput: (e) => {
        const raw = e.target.value;
        if (!raw.trim()) {
          amountPreview.textContent = 'Summa: 0 so\'m';
          amountPreview.style.color = 'var(--text-muted)';
          amountPreview.style.fontWeight = 'normal';
          return;
        }

        const result = parsePaymentAmount(raw);
        if (result.valid) {
          amountPreview.textContent = `Summa: ${result.formatted}`;
          amountPreview.style.color = 'var(--accent-primary)';
          amountPreview.style.fontWeight = '600';
        } else {
          amountPreview.textContent = result.error;
          amountPreview.style.color = 'var(--status-danger)';
          amountPreview.style.fontWeight = 'normal';
        }
      }
    });

    const dateInput = el('input', {
      type: 'date',
      className: 'form-input',
      id: 'payment-date-input',
      value: getCurrentLocalDateString(),
      required: true
    });

    const errorBox = el('div', {
      className: 'form-error',
      id: 'payment-error-box',
      style: 'display: none; margin-bottom: var(--space-4);'
    });

    const submitBtn = el('button', {
      type: 'submit',
      id: 'payment-submit-btn',
      className: 'btn btn-primary btn-lg'
    }, '✓ To\'lovni saqlash');

    const successBanner = el('div', {
      className: 'card',
      id: 'payment-success-banner',
      style: 'display: none; background-color: var(--status-success-bg); border-color: var(--status-success-border); margin-top: var(--space-6);'
    });

    // Payment Form Element with native validation disabled (novalidate) to prevent stepMismatch tooltip blocking
    const form = el('form', {
      novalidate: true,
      onSubmit: async (e) => {
        e.preventDefault();
        errorBox.style.display = 'none';
        successBanner.style.display = 'none';

        const studentIdVal = studentCombobox.getSelectedStudentId();
        if (!studentIdVal || !Number.isSafeInteger(studentIdVal)) {
          errorBox.textContent = 'Iltimos, o\'quvchini tanlang.';
          errorBox.style.display = 'block';
          studentCombobox.focus();
          return;
        }

        const amountResult = parsePaymentAmount(amountInput.value);
        if (!amountResult.valid) {
          errorBox.textContent = amountResult.error || 'To\'lov summasi musbat butun son bo\'lishi shart.';
          errorBox.style.display = 'block';
          amountInput.focus();
          return;
        }

        const dateVal = dateInput.value;
        if (!dateVal || !/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
          errorBox.textContent = 'Iltimos, to\'g\'ri sanani tanlang (YYYY-MM-DD).';
          errorBox.style.display = 'block';
          dateInput.focus();
          return;
        }

        // Duplicate submission prevention
        submitBtn.disabled = true;
        submitBtn.textContent = 'To\'lov saqlanmoqda...';

        try {
          const newPayment = await recordPayment({
            student_id: studentIdVal,
            amount: amountResult.value,
            payment_date: dateVal
          });

          showToast('To\'lov muvaffaqiyatli saqlandi!', 'success');

          // Display success state with action links
          clearElement(successBanner);
          successBanner.appendChild(
            el('div', { className: 'card-body', style: 'padding: var(--space-5);' },
              el('h3', { style: 'color: var(--accent-text); margin-bottom: var(--space-2);' }, '✓ To\'lov muvaffaqiyatli qabul qilindi'),
              el('p', { style: 'margin-bottom: var(--space-4);' },
                `To'lov ID: #${newPayment.id} | Summa: ${formatUzbekSom(newPayment.amount)} | Sana: ${newPayment.payment_date}`
              ),
              el('div', { style: 'display: flex; gap: var(--space-3); flex-wrap: wrap;' },
                el('a', {
                  href: `#/students/${newPayment.student_id}`,
                  className: 'btn btn-secondary btn-sm'
                }, 'O\'quvchi to\'lovlar tarixini ko\'rish'),
                el('a', {
                  href: '#/debtors',
                  className: 'btn btn-secondary btn-sm'
                }, 'Qarzdorlar hisobotiga o\'tish'),
                el('button', {
                  type: 'button',
                  className: 'btn btn-primary btn-sm',
                  onClick: () => {
                    amountInput.value = '';
                    amountPreview.textContent = 'Summa: 0 so\'m';
                    amountPreview.style.color = 'var(--text-muted)';
                    amountPreview.style.fontWeight = 'normal';
                    studentCombobox.clearSelection();
                    successBanner.style.display = 'none';
                    studentCombobox.focus();
                  }
                }, '+ Yana boshqa to\'lov kiritish')
              )
            )
          );
          successBanner.style.display = 'block';

        } catch (err) {
          errorBox.textContent = err.message || 'To\'lovni saqlashda xatolik yuz berdi.';
          errorBox.style.display = 'block';
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = '✓ To\'lovni saqlash';
        }
      }
    },
      el('div', { className: 'form-group' },
        el('label', { className: 'form-label required', htmlFor: 'student-combobox-input' }, 'O\'quvchi'),
        studentCombobox.element,
        el('span', { className: 'form-help' }, 'O\'quvchi F.I.SH. bo\'yicha qidiring va ro\'yxatdan tanlang.')
      ),
      el('div', { className: 'form-group' },
        el('label', { className: 'form-label required', htmlFor: 'payment-amount-input' }, 'To\'lov summasi (so\'mda)'),
        amountInput,
        amountPreview
      ),
      el('div', { className: 'form-group' },
        el('label', { className: 'form-label required', htmlFor: 'payment-date-input' }, 'To\'lov sanasi'),
        dateInput,
        el('span', { className: 'form-help' }, 'Standart holatda bugungi sana ko\'rsatilgan.')
      ),
      errorBox,
      el('div', { style: 'margin-top: var(--space-6);' },
        submitBtn
      )
    );

    const formCard = el('div', { className: 'card' },
      el('div', { className: 'card-header' },
        el('h2', { className: 'card-title' }, 'To\'lov tafsilotlari')
      ),
      el('div', { className: 'card-body' },
        form
      )
    );

    container.appendChild(pageHeader);
    container.appendChild(formCard);
    container.appendChild(successBanner);

  } catch (err) {
    clearElement(container);
    container.appendChild(
      el('div', { className: 'error-banner' },
        el('span', {}, err.message || 'Ma\'lumotlarni yuklashda xatolik yuz berdi.'),
        el('button', {
          className: 'btn btn-secondary btn-sm',
          onClick: () => renderPayments(container, queryParams)
        }, 'Qayta urinish')
      )
    );
  }
}
