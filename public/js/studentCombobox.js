/**
 * Accessible Searchable Student Combobox Component for Ecomdev.
 * Provides instant client-side filtering, keyboard navigation, clear selected state,
 * and preselection support.
 */

import { el, clearElement } from './dom.js';
import { formatUzbekSom } from './formatters.js';

/**
 * Creates a searchable student combobox element and controller.
 *
 * @param {Object} options
 * @param {Array<Object>} options.students - Array of student records from API.
 * @param {string|number} [options.preselectedStudentId] - Optional student ID to preselect.
 * @param {(student: Object|null) => void} [options.onSelect] - Callback when selection changes.
 * @returns {{
 *   element: HTMLElement,
 *   getSelectedStudent: () => Object|null,
 *   getSelectedStudentId: () => number|null,
 *   selectStudent: (student: Object) => void,
 *   clearSelection: () => void,
 *   focus: () => void
 * }}
 */
export function createStudentCombobox({
  students = [],
  preselectedStudentId = null,
  onSelect = null
}) {
  let selectedStudent = null;
  let filteredStudents = [...students];
  let highlightedIndex = -1;
  let isOpen = false;

  const container = el('div', {
    className: 'student-combobox-container',
    id: 'student-combobox'
  });

  // Hidden input for form integration
  const hiddenInput = el('input', {
    type: 'hidden',
    name: 'student_id',
    id: 'student-id-hidden',
    value: ''
  });

  // Search input element
  const searchInput = el('input', {
    type: 'text',
    className: 'form-input combobox-input',
    id: 'student-combobox-input',
    placeholder: 'O\'quvchi F.I.SH. bo\'yicha qidiring...',
    role: 'combobox',
    'aria-autocomplete': 'list',
    'aria-expanded': 'false',
    'aria-haspopup': 'listbox',
    'aria-controls': 'student-combobox-listbox',
    autocomplete: 'off'
  });

  const searchIcon = el('span', { className: 'combobox-search-icon', 'aria-hidden': 'true' }, '🔍');

  const searchWrapper = el('div', { className: 'combobox-search-wrapper' },
    searchIcon,
    searchInput
  );

  // Dropdown listbox
  const dropdownList = el('div', {
    id: 'student-combobox-listbox',
    className: 'combobox-dropdown',
    role: 'listbox',
    'aria-label': 'O\'quvchilar ro\'yxati',
    style: 'display: none;'
  });

  // Selected student card display
  const selectedCard = el('div', {
    className: 'selected-student-card',
    id: 'selected-student-card',
    style: 'display: none;',
    role: 'region',
    'aria-label': 'Tanlangan o\'quvchi'
  });

  container.appendChild(hiddenInput);
  container.appendChild(searchWrapper);
  container.appendChild(dropdownList);
  container.appendChild(selectedCard);

  function openDropdown() {
    if (isOpen) return;
    isOpen = true;
    searchInput.setAttribute('aria-expanded', 'true');
    dropdownList.style.display = 'block';
    renderList();
  }

  function closeDropdown() {
    if (!isOpen) return;
    isOpen = false;
    searchInput.setAttribute('aria-expanded', 'false');
    dropdownList.style.display = 'none';
    highlightedIndex = -1;
    searchInput.removeAttribute('aria-activedescendant');
  }

  function setHighlighted(index) {
    const options = dropdownList.querySelectorAll('.combobox-option');
    options.forEach((opt, idx) => {
      if (idx === index) {
        opt.classList.add('highlighted');
        searchInput.setAttribute('aria-activedescendant', opt.id);
        opt.scrollIntoView({ block: 'nearest' });
      } else {
        opt.classList.remove('highlighted');
      }
    });
    highlightedIndex = index;
  }

  const MAX_VISIBLE_OPTIONS = 100;

  function renderList() {
    clearElement(dropdownList);

    if (filteredStudents.length === 0) {
      const query = searchInput.value.trim();
      const emptyEl = el('div', {
        className: 'combobox-empty',
        role: 'status'
      }, query ? `"${query}" bo'yicha hech qanday o'quvchi topilmadi` : 'O\'quvchilar ro\'yxati bo\'sh');
      dropdownList.appendChild(emptyEl);
      return;
    }

    const visibleStudents = filteredStudents.slice(0, MAX_VISIBLE_OPTIONS);

    visibleStudents.forEach((student, index) => {
      const optionId = `student-option-${student.id}`;
      const optionEl = el('div', {
        id: optionId,
        className: 'combobox-option',
        role: 'option',
        'aria-selected': selectedStudent?.id === student.id ? 'true' : 'false',
        dataset: { studentId: String(student.id), index: String(index) },
        onMousedown: (e) => {
          // Use mousedown so blur does not dismiss before selection
          e.preventDefault();
          selectStudent(student);
        },
        onMouseenter: () => {
          setHighlighted(index);
        }
      },
        el('div', { className: 'combobox-option-name' }, student.full_name),
        el('div', { className: 'combobox-option-fee' },
          `Oylik to'lov: ${formatUzbekSom(student.monthly_fee)}`
        )
      );

      if (index === highlightedIndex) {
        optionEl.classList.add('highlighted');
      }

      dropdownList.appendChild(optionEl);
    });

    if (filteredStudents.length > MAX_VISIBLE_OPTIONS) {
      dropdownList.appendChild(
        el('div', {
          className: 'combobox-more-hint',
          role: 'status',
          style: 'padding: var(--space-2) var(--space-4); font-size: 0.75rem; color: var(--text-muted); text-align: center; background-color: var(--bg-subtle); border-top: 1px solid var(--border-light);'
        }, `Dastlabki ${MAX_VISIBLE_OPTIONS} ta natija ko'rsatildi (jami ${filteredStudents.length} ta). Aniqroq topish uchun qidiruvga yozing.`)
      );
    }
  }

  function filter(query) {
    const q = query.trim().toLowerCase();
    if (!q) {
      filteredStudents = [...students];
    } else {
      filteredStudents = students.filter((s) =>
        s.full_name.toLowerCase().includes(q)
      );
    }
    highlightedIndex = filteredStudents.length > 0 ? 0 : -1;
    renderList();
    if (highlightedIndex >= 0) {
      setHighlighted(0);
    }
  }

  function selectStudent(student) {
    selectedStudent = student;
    hiddenInput.value = student ? String(student.id) : '';

    if (student) {
      closeDropdown();
      searchWrapper.style.display = 'none';

      clearElement(selectedCard);
      selectedCard.appendChild(
        el('div', { className: 'selected-student-info' },
          el('div', { className: 'selected-student-badge' }, '✓ Tanlangan o\'quvchi'),
          el('div', { className: 'selected-student-name' }, student.full_name),
          el('div', { className: 'selected-student-meta' },
            `ID: #${student.id} · Oylik to'lov: ${formatUzbekSom(student.monthly_fee)}`
          )
        )
      );

      const changeBtn = el('button', {
        type: 'button',
        className: 'btn btn-secondary btn-sm combobox-change-btn',
        'aria-label': 'Boshqa o\'quvchini tanlash',
        onClick: (e) => {
          e.preventDefault();
          clearSelection();
          searchInput.focus();
          openDropdown();
        }
      }, 'O\'zgartirish');

      selectedCard.appendChild(changeBtn);
      selectedCard.style.display = 'flex';
    } else {
      selectedCard.style.display = 'none';
      searchWrapper.style.display = 'block';
    }

    if (typeof onSelect === 'function') {
      onSelect(selectedStudent);
    }
  }

  function clearSelection() {
    selectedStudent = null;
    hiddenInput.value = '';
    selectedCard.style.display = 'none';
    searchWrapper.style.display = 'block';
    searchInput.value = '';
    filteredStudents = [...students];
    highlightedIndex = -1;

    if (typeof onSelect === 'function') {
      onSelect(null);
    }
  }

  // Search input events
  searchInput.addEventListener('focus', () => {
    openDropdown();
  });

  searchInput.addEventListener('click', () => {
    openDropdown();
  });

  searchInput.addEventListener('input', (e) => {
    openDropdown();
    filter(e.target.value);
  });

  searchInput.addEventListener('keydown', (e) => {
    const visibleCount = Math.min(filteredStudents.length, MAX_VISIBLE_OPTIONS);

    if (!isOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      openDropdown();
      if (visibleCount > 0) {
        setHighlighted(e.key === 'ArrowDown' ? 0 : visibleCount - 1);
      }
      e.preventDefault();
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (visibleCount > 0) {
          const nextIndex = highlightedIndex < visibleCount - 1 ? highlightedIndex + 1 : 0;
          setHighlighted(nextIndex);
        }
        break;

      case 'ArrowUp':
        e.preventDefault();
        if (visibleCount > 0) {
          const prevIndex = highlightedIndex > 0 ? highlightedIndex - 1 : visibleCount - 1;
          setHighlighted(prevIndex);
        }
        break;

      case 'Enter':
        e.preventDefault();
        if (isOpen && highlightedIndex >= 0 && highlightedIndex < visibleCount) {
          selectStudent(filteredStudents[highlightedIndex]);
        } else if (isOpen && filteredStudents.length === 1) {
          selectStudent(filteredStudents[0]);
        }
        break;

      case 'Escape':
        e.preventDefault();
        closeDropdown();
        break;

      case 'Tab':
        closeDropdown();
        break;
    }
  });

  // Document click listener to close dropdown on outside clicks
  function handleDocumentClick(e) {
    if (container.isConnected === false) {
      document.removeEventListener('click', handleDocumentClick);
      return;
    }
    if (!container.contains(e.target)) {
      closeDropdown();
    }
  }
  document.addEventListener('click', handleDocumentClick);

  // Apply preselection if supplied
  if (preselectedStudentId) {
    const found = students.find((s) => String(s.id) === String(preselectedStudentId));
    if (found) {
      selectStudent(found);
    }
  }

  return {
    element: container,
    getSelectedStudent: () => selectedStudent,
    getSelectedStudentId: () => (selectedStudent ? selectedStudent.id : null),
    selectStudent,
    clearSelection,
    focus: () => {
      if (selectedStudent) {
        const changeBtn = selectedCard.querySelector('.combobox-change-btn');
        if (changeBtn) changeBtn.focus();
      } else {
        searchInput.focus();
      }
    },
    destroy: () => {
      document.removeEventListener('click', handleDocumentClick);
    }
  };
}
