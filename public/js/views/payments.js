/**
 * Record Payment View for Ecomdev.
 * Form for submitting payments with searchable student selection, robust amount parsing,
 * billing month selection, duplicate protection, explicit confirmation workflow, and receipt generation.
 */

import { fetchStudents, recordPayment, confirmPayment } from '../api.js';
import {
  formatUzbekSom,
  formatMonthName,
  formatDateUzbek,
  formatFriendlyMonthUzbek,
  getCurrentLocalDateString,
  getCurrentLocalMonthString,
  isValidCalendarDateString,
  parseDateInput,
  parseBillingMonthInput
} from '../formatters.js';
import { parsePaymentAmount } from '../amountParser.js';
import { createStudentCombobox } from '../studentCombobox.js';
import { el, clearElement } from '../dom.js';
import { showToast } from '../notifications.js';
import { createPageShell, renderStateView } from '../pageLayout.js';

/**
 * Renders the Record Payment form view into the target container.
 *
 * @param {HTMLElement} container
 * @param {URLSearchParams} [queryParams]
 */
export async function renderPayments(container, queryParams = new URLSearchParams()) {
  const loadingEl = el('div', { className: 'loading-indicator' },
    el('div', { className: 'spinner' }),
    el('p', {}, 'To\'lov formasi yuklanmoqda...')
  );
  renderStateView(container, loadingEl);

  try {
    const students = await fetchStudents();
    clearElement(container);

    const preselectedStudentId = queryParams.get('student_id');
    const preselectedMonth = queryParams.get('month') || getCurrentLocalMonthString();

    // Page Header
    const pageHeader = el('div', { className: 'page-header' },
      el('div', {},
        el('h1', { className: 'page-title' }, 'To\'lov qabul qilish'),
        el('p', { className: 'page-description' }, 'O\'quvchi hisobiga amalga oshirilgan to\'lovni qayd etish, tasdiqlash va kvitansiya chiqarish')
      )
    );

    if (students.length === 0) {
      const emptyShell = createPageShell({
        header: pageHeader,
        body: el('div', { className: 'card' },
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
      });
      container.appendChild(emptyShell.element);
      return;
    }

    // Accessible Searchable Student Combobox
    const studentCombobox = createStudentCombobox({
      students,
      preselectedStudentId
    });

    const studentInfoBox = el('div', {
      id: 'selected-student-info',
      style: 'display: none; background: var(--bg-surface); border: 1px solid var(--border-light); border-radius: var(--radius-md); padding: var(--space-3) var(--space-4); margin-top: var(--space-2); font-size: 0.875rem;'
    });

    function updateStudentInfo(studentId) {
      if (!studentId) {
        studentInfoBox.style.display = 'none';
        return;
      }
      const st = students.find((s) => s.id === studentId);
      if (st) {
        clearElement(studentInfoBox);
        studentInfoBox.appendChild(
          el('div', { style: 'display: flex; gap: var(--space-4); flex-wrap: wrap; align-items: center;' },
            el('span', {}, el('strong', {}, 'Guruh: '), st.group_name || 'Guruhsiz'),
            el('span', {}, el('strong', {}, 'Oylik to\'lov stavkasi: '), formatUzbekSom(st.monthly_fee)),
            st.phone ? el('span', {}, el('strong', {}, 'Tel: '), st.phone) : null
          )
        );
        studentInfoBox.style.display = 'block';
      }
    }

    if (preselectedStudentId) {
      updateStudentInfo(Number(preselectedStudentId));
    }

    const amountPreview = el('span', { className: 'form-help' }, 'Summa: 0 so\'m');

    
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

    const monthInput = el('input', {
      type: 'month',
      className: 'form-input',
      id: 'payment-month-input',
      value: preselectedMonth,
      required: true
    });

    const monthPreviewText = el('span', {
      id: 'payment-month-preview-text',
      style: 'font-weight: 600; color: var(--accent-primary);'
    }, formatFriendlyMonthUzbek(preselectedMonth));

    const monthPreviewBadge = el('div', {
      id: 'payment-month-preview-badge',
      className: 'form-help',
      style: 'margin-top: var(--space-1); display: flex; align-items: center; gap: var(--space-2); font-size: 0.875rem;'
    },
      el('span', { style: 'color: var(--text-muted);' }, 'Tanlangan hisob oyi:'),
      monthPreviewText
    );
// oy formati
    function updateMonthPreview() {
      const parsed = parseBillingMonthInput(monthInput.value);
      if (parsed.valid) {
        monthPreviewText.textContent = formatFriendlyMonthUzbek(parsed.month);
        monthPreviewText.style.color = 'var(--accent-primary)';
      } else {
        monthPreviewText.textContent = 'Noto\'g\'ri oy formati (YYYY-MM talab qilinadi)';
        monthPreviewText.style.color = 'var(--status-danger)';
      }
    }
    monthInput.addEventListener('input', updateMonthPreview);
    monthInput.addEventListener('change', updateMonthPreview);

    const todayIso = getCurrentLocalDateString();
    const todayUz = formatDateUzbek(todayIso);

    const dateInput = el('input', {
      type: 'text',
      className: 'form-input',
      id: 'payment-date-input',
      value: todayUz,
      placeholder: 'KK.OO.YYYY (masalan: 28.10.2026)',
      autocomplete: 'off',
      required: true
    });

    const methodSelect = el('select', {
      className: 'form-input',
      id: 'payment-method-select'
    },
      el('option', { value: 'cash', selected: true }, 'Naqd pul (Kassa)'),
      el('option', { value: 'card' }, 'Plastik karta (Humo / UzCard)'),
      el('option', { value: 'bank_transfer' }, 'Bank o\'tkazmasi (Hisob raqam)'),
      el('option', { value: 'other' }, 'Boshqa to\'lov usuli')
    );

    const errorBox = el('div', {
      className: 'form-error',
      id: 'payment-error-box',
      style: 'display: none; margin-bottom: var(--space-4);'
    });

    const submitBtn = el('button', {
      type: 'submit',
      id: 'payment-submit-btn',
      className: 'btn btn-primary btn-lg'
    }, '✓ To\'lovni tasdiqlash va chek chiqarish');

    const pendingBtn = el('button', {
      type: 'button',
      id: 'payment-pending-btn',
      className: 'btn btn-secondary btn-lg'
    }, '⏳ Kutilayotgan to\'lov sifatida saqlash');

    const successBanner = el('div', {
      className: 'card',
      id: 'payment-success-banner',
      style: 'display: none; background-color: var(--status-success-bg); border-color: var(--status-success-border); margin-top: var(--space-6);'
    });

    async function handlePaymentSubmission(statusToSet = 'confirmed') {
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

      const parsedDate = parseDateInput(dateInput.value);
      if (!parsedDate.valid) {
        errorBox.textContent = parsedDate.error || 'Iltimos, haqiqiy taqvim sanasini kiriting (KK.OO.YYYY yoki YYYY-MM-DD).';
        errorBox.style.display = 'block';
        dateInput.focus();
        return;
      }
      const dateVal = parsedDate.isoDate;

      const parsedMonth = parseBillingMonthInput(monthInput.value);
      if (!parsedMonth.valid) {
        errorBox.textContent = 'Iltimos, to\'lov qaysi oy uchun ekanligini to\'g\'ri tanlang (YYYY-MM, masalan: 2026-10).';
        errorBox.style.display = 'block';
        monthInput.focus();
        return;
      }
      const billingMonthVal = parsedMonth.month;

      // Duplicate submission prevention
      submitBtn.disabled = true;
      pendingBtn.disabled = true;
      submitBtn.textContent = 'To\'lov saqlanmoqda...';

      try {
        const newPayment = await recordPayment({
          student_id: studentIdVal,
          amount: amountResult.value,
          payment_date: dateVal,
          billing_month: billingMonthVal,
          payment_method: methodSelect.value,
          status: statusToSet
        });

        const isConfirmed = newPayment.status === 'confirmed';
        showToast(
          isConfirmed ? 'To\'lov muvaffaqiyatli tasdiqlandi va chek berildi!' : 'To\'lov kutilayotgan holatda saqlandi!',
          'success'
        );

        // Display success state with receipt and action links
        renderSuccessBanner(newPayment);
        successBanner.style.display = 'block';
        if (typeof successBanner.scrollIntoView === 'function') {
          successBanner.scrollIntoView({ block: 'nearest' });
        }

      } catch (err) {
        errorBox.textContent = err.message || 'To\'lovni saqlashda xatolik yuz berdi.';
        errorBox.style.display = 'block';
      } finally {
        submitBtn.disabled = false;
        pendingBtn.disabled = false;
        submitBtn.textContent = '✓ To\'lovni tasdiqlash va chek chiqarish';
      }
    }

    function renderSuccessBanner(payment) {
      clearElement(successBanner);
      const isConfirmed = payment.status === 'confirmed';

      const bannerContent = el('div', { className: 'card-body', style: 'padding: var(--space-5);' });

      if (isConfirmed) {
        bannerContent.appendChild(
          el('h3', { style: 'color: var(--accent-text); margin-bottom: var(--space-2);' },
            '✓ To\'lov muvaffaqiyatli tasdiqlandi va chek berildi'
          )
        );
        bannerContent.appendChild(
          el('p', { style: 'margin-bottom: var(--space-3); color: var(--text-primary);' },
            `To'lov ID: #${payment.id} | Chek raqami: `,
            el('strong', { style: 'color: var(--status-success); font-family: monospace;' }, payment.receipt_number || 'REC-AUTO'),
            ` | Summa: ${formatUzbekSom(payment.amount)} | To'lov oyi: ${formatFriendlyMonthUzbek(payment.billing_month || payment.payment_date.substring(0, 7))} | Kassa sanasi: ${formatDateUzbek(payment.payment_date)}`
          )
        );
      } else {
        bannerContent.appendChild(
          el('h3', { style: 'color: var(--status-warning); margin-bottom: var(--space-2);' },
            '⏳ To\'lov kutilayotgan holatda saqlandi'
          )
        );
        bannerContent.appendChild(
          el('p', { style: 'margin-bottom: var(--space-3); color: var(--text-secondary);' },
            `To'lov ID: #${payment.id} | Summa: ${formatUzbekSom(payment.amount)} | Holati: Kutilmoqda. `,
            el('em', {}, 'Diqqat: To\'lov tasdiqlanmaguncha qarz hisobidan chegirilmaydi.')
          )
        );
      }

      const actionsRow = el('div', { style: 'display: flex; gap: var(--space-3); flex-wrap: wrap; align-items: center;' });

      if (isConfirmed && payment.receipt_id) {
        actionsRow.appendChild(
          el('a', {
            href: `/api/receipts/${payment.receipt_id}/pdf`,
            target: '_blank',
            className: 'btn btn-secondary btn-sm',
            id: 'btn-view-pdf-receipt'
          }, '📄 Chekni ko\'rish / Yuklab olish (PDF)')
        );
      } else if (!isConfirmed) {
        const confirmNowBtn = el('button', {
          type: 'button',
          className: 'btn btn-primary btn-sm',
          onClick: async () => {
            confirmNowBtn.disabled = true;
            confirmNowBtn.textContent = 'Tasdiqlanmoqda...';
            try {
              const res = await confirmPayment(payment.id);
              showToast('To\'lov muvaffaqiyatli tasdiqlandi!', 'success');
              renderSuccessBanner({
                ...res.payment,
                receipt_id: res.receipt.id,
                receipt_number: res.receipt.receipt_number
              });
            } catch (cErr) {
              confirmNowBtn.disabled = false;
              confirmNowBtn.textContent = '✓ Hozir tasdiqlash';
              showToast(cErr.message || 'Tasdiqlashda xatolik yuz berdi.', 'error');
            }
          }
        }, '✓ Hozir tasdiqlash va chek chiqarish');
        actionsRow.appendChild(confirmNowBtn);
      }

      actionsRow.appendChild(
        el('a', {
          href: `#/students/${payment.student_id}`,
          className: 'btn btn-secondary btn-sm'
        }, 'O\'quvchi profiliga o\'tish')
      );

      actionsRow.appendChild(
        el('a', {
          href: '#/debtors',
          className: 'btn btn-secondary btn-sm'
        }, 'Qarzdorlar hisobotiga o\'tish')
      );

      actionsRow.appendChild(
        el('button', {
          type: 'button',
          className: 'btn btn-primary btn-sm',
          onClick: () => {
            amountInput.value = '';
            amountPreview.textContent = 'Summa: 0 so\'m';
            amountPreview.style.color = 'var(--text-muted)';
            amountPreview.style.fontWeight = 'normal';
            dateInput.value = formatDateUzbek(getCurrentLocalDateString());
            monthInput.value = getCurrentLocalMonthString();
            updateMonthPreview();
            studentCombobox.clearSelection();
            studentInfoBox.style.display = 'none';
            successBanner.style.display = 'none';
            shell.resetScroll();
            studentCombobox.focus();
          }
        }, '+ Yana boshqa to\'lov kiritish')
      );

      bannerContent.appendChild(actionsRow);
      successBanner.appendChild(bannerContent);
    }

    pendingBtn.onclick = () => handlePaymentSubmission('pending');

    // Payment Form Element with native validation disabled
    const form = el('form', {
      novalidate: true,
      onSubmit: (e) => {
        e.preventDefault();
        return handlePaymentSubmission('confirmed');
      }
    },
      el('div', { className: 'form-group' },
        el('label', { className: 'form-label required', htmlFor: 'student-combobox-input' }, 'O\'quvchi'),
        studentCombobox.element,
        studentInfoBox,
        el('span', { className: 'form-help' }, 'O\'quvchi F.I.SH. bo\'yicha qidiring va ro\'yxatdan tanlang.')
      ),
      el('div', { className: 'form-group' },
        el('label', { className: 'form-label required', htmlFor: 'payment-amount-input' }, 'To\'lov summasi (so\'mda)'),
        amountInput,
        amountPreview
      ),
      el('div', { className: 'form-group' },
        el('label', { className: 'form-label required', htmlFor: 'payment-month-input' }, 'To\'lov qaysi oy uchun? (Hisob oyi)'),
        monthInput,
        monthPreviewBadge,
        el('span', { className: 'form-help' }, 'Ushbu to\'lov qaysi oyning o\'qish to\'lovi hisobiga yozilishi (masalan, sentabr oyi qarzini oktabrda to\'lash mumkin).')
      ),
      el('div', { className: 'form-group' },
        el('label', { className: 'form-label required', htmlFor: 'payment-date-input' }, 'To\'lov qabul qilingan sana (Kassa sanasi)'),
        dateInput,
        el('span', { className: 'form-help' }, 'Pul amalda qabul qilingan sana (KK.OO.YYYY formatida, masalan: 28.10.2026). Standart holatda bugungi sana ko\'rsatilgan.')
      ),
      el('div', { className: 'form-group' },
        el('label', { className: 'form-label', htmlFor: 'payment-method-select' }, 'To\'lov usuli'),
        methodSelect
      ),
      errorBox,
      el('div', { style: 'margin-top: var(--space-6); display: flex; gap: var(--space-3); flex-wrap: wrap;' },
        submitBtn,
        pendingBtn
      )
    );

    const formCard = el('div', { className: 'card card-allow-overflow' },
      el('div', { className: 'card-header' },
        el('h2', { className: 'card-title' }, 'To\'lov tafsilotlari')
      ),
      el('div', { className: 'card-body' }, form)
    );

    const shell = createPageShell({
      header: pageHeader,
      body: [formCard, successBanner]
    });
    container.appendChild(shell.element);

    if (container.isConnected === false) {
      studentCombobox.destroy();
    }

    return () => {
      studentCombobox.destroy();
    };

  } catch (err) {
    renderStateView(
      container,
      el('div', { className: 'error-banner' },
        el('span', {}, err.message || 'Ma\'lumotlarni yuklashda xatolik yuz berdi.'),
        el('button', {
          className: 'btn btn-secondary btn-sm',
          onClick: () => renderPayments(container, queryParams)
        }, 'Qayta urinish')
      )
    );
    return undefined;
  }
}
