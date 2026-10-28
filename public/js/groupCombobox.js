/**
 * Accessible Searchable Group Combobox Component for Ecomdev.
 * Provides instant filtering, keyboard navigation, clear selected state,
 * and support for "Guruhsiz" (unassigned) selection.
 */

import { el, clearElement } from './dom.js';
import { closeModal } from './modal.js';

export const NO_GROUP_OPTION = {
  id: null,
  name: 'Guruhsiz',
  isNoGroup: true,
  student_count: 0
};

/**
 * Creates a searchable group combobox element and controller.
 *
 * @param {Object} options
 * @param {Array<Object>} [options.groups=[]] - Array of group records from API.
 * @param {string|number|null} [options.preselectedGroupId=null] - Group ID to preselect.
 * @param {(group: Object|null) => void} [options.onSelect=null] - Callback when selection changes.
 * @param {string} [options.id='group-combobox'] - Unique ID prefix.
 * @returns {{
 *   element: HTMLElement,
 *   getSelectedGroup: () => Object|null,
 *   getSelectedGroupId: () => number|null,
 *   selectGroup: (group: Object) => void,
 *   clearSelection: () => void,
 *   focus: () => void,
 *   destroy: () => void
 * }}
 */
export function createGroupCombobox({
  groups = [],
  preselectedGroupId = undefined,
  onSelect = null,
  id = 'group-combobox'
} = {}) {
  let selectedGroup = null;
  let highlightedIndex = -1;
  let isOpen = false;

  const container = el('div', {
    className: 'group-combobox-container',
    id
  });

  // If there are no groups in the system, show helpful guidance with link to create group
  if (!groups || groups.length === 0) {
    const hiddenInput = el('input', {
      type: 'hidden',
      name: 'group_id',
      id: `${id}-hidden`,
      value: ''
    });

    const emptyNotice = el('div', {
      className: 'combobox-no-data-notice',
      style: 'padding: var(--space-3) var(--space-4); background-color: var(--bg-surface-hover); border: 1px dashed var(--border-medium); border-radius: var(--radius-md); font-size: 0.875rem;'
    },
      el('span', { style: 'color: var(--text-secondary);' }, 'Hozircha guruhlar mavjud emas. '),
      el('a', {
        href: '#/groups?action=new',
        style: 'color: var(--accent-primary); font-weight: 500;',
        onClick: () => {
          if (typeof closeModal === 'function') closeModal();
        }
      }, 'Yangi guruh ochish →')
    );

    container.appendChild(hiddenInput);
    container.appendChild(emptyNotice);

    return {
      element: container,
      getSelectedGroup: () => NO_GROUP_OPTION,
      getSelectedGroupId: () => null,
      selectGroup: () => {},
      clearSelection: () => {},
      focus: () => {},
      destroy: () => {}
    };
  }

  // Hidden input for standard form serialization
  const hiddenInput = el('input', {
    type: 'hidden',
    name: 'group_id',
    id: `${id}-hidden`,
    value: ''
  });

  // Search input element
  const searchInput = el('input', {
    type: 'text',
    className: 'form-input combobox-input',
    id: `${id}-input`,
    placeholder: 'Guruh nomini qidiring yoki tanlang...',
    role: 'combobox',
    'aria-autocomplete': 'list',
    'aria-expanded': 'false',
    'aria-haspopup': 'listbox',
    'aria-controls': `${id}-listbox`,
    autocomplete: 'off'
  });

  const searchIcon = el('span', { className: 'combobox-search-icon', 'aria-hidden': 'true' }, '📁');

  const searchWrapper = el('div', { className: 'combobox-search-wrapper' },
    searchIcon,
    searchInput
  );

  // Dropdown listbox
  const dropdownList = el('div', {
    id: `${id}-listbox`,
    className: 'combobox-dropdown',
    role: 'listbox',
    'aria-label': 'Guruhlar ro\'yxati',
    style: 'display: none;'
  });

  // Selected group card display
  const selectedCard = el('div', {
    className: 'selected-group-card',
    id: `${id}-selected-card`,
    style: 'display: none;',
    role: 'region',
    'aria-label': 'Tanlangan guruh'
  });

  container.appendChild(hiddenInput);
  container.appendChild(searchWrapper);
  container.appendChild(dropdownList);
  container.appendChild(selectedCard);

  function getAvailableOptions(query = '') {
    const q = query.trim().toLowerCase();
    const result = [];

    // Check if query matches "Guruhsiz" option or if query is empty
    const matchesNoGroup = !q ||
      'guruhsiz'.includes(q) ||
      'siz'.includes(q) ||
      'yo\'q'.includes(q) ||
      'yoq'.includes(q) ||
      'biriktirilmagan'.includes(q) ||
      'mustaqil'.includes(q) ||
      'no'.includes(q);

    if (matchesNoGroup) {
      result.push(NO_GROUP_OPTION);
    }

    const matchingGroups = !q
      ? groups
      : groups.filter((g) => g.name.toLowerCase().includes(q));

    result.push(...matchingGroups);
    return result;
  }

  let currentOptions = getAvailableOptions('');

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

    if (currentOptions.length === 0) {
      const query = searchInput.value.trim();
      const emptyEl = el('div', {
        className: 'combobox-empty',
        role: 'status'
      }, query ? `"${query}" bo'yicha hech qanday guruh topilmadi` : 'Guruhlar ro\'yxati bo\'sh');
      dropdownList.appendChild(emptyEl);
      return;
    }

    const visibleOptions = currentOptions.slice(0, MAX_VISIBLE_OPTIONS);

    visibleOptions.forEach((item, index) => {
      const isNoGroup = item.id === null;
      const optionId = `${id}-option-${isNoGroup ? 'nogroup' : item.id}`;
      const isSelected = selectedGroup && selectedGroup.id === item.id;

      const optionEl = el('div', {
        id: optionId,
        className: `combobox-option${isNoGroup ? ' combobox-option-nogroup' : ''}`,
        role: 'option',
        'aria-selected': isSelected ? 'true' : 'false',
        dataset: { groupId: String(item.id), index: String(index) },
        onMousedown: (e) => {
          // Use mousedown so blur does not dismiss before selection
          e.preventDefault();
          selectGroup(item);
        },
        onMouseenter: () => {
          setHighlighted(index);
        }
      },
        el('div', {
          className: 'combobox-option-name',
          style: isNoGroup ? 'color: var(--text-secondary); font-style: italic;' : ''
        }, isNoGroup ? '— Guruhsiz —' : item.name),
        el('div', { className: 'combobox-option-fee' },
          isNoGroup
            ? 'Guruhga biriktirilmagan (mustaqil)'
            : `${item.student_count || 0} nafar o'quvchi biriktirilgan`
        )
      );

      if (index === highlightedIndex) {
        optionEl.classList.add('highlighted');
      }

      dropdownList.appendChild(optionEl);
    });

    if (currentOptions.length > MAX_VISIBLE_OPTIONS) {
      dropdownList.appendChild(
        el('div', {
          className: 'combobox-more-hint',
          role: 'status',
          style: 'padding: var(--space-2) var(--space-4); font-size: 0.75rem; color: var(--text-muted); text-align: center; background-color: var(--bg-subtle); border-top: 1px solid var(--border-light);'
        }, `Dastlabki ${MAX_VISIBLE_OPTIONS} ta natija ko'rsatildi (jami ${currentOptions.length} ta). Aniqroq topish uchun qidiruvga yozing.`)
      );
    }
  }

  function filter(query) {
    currentOptions = getAvailableOptions(query);
    highlightedIndex = currentOptions.length > 0 ? 0 : -1;
    renderList();
    if (highlightedIndex >= 0) {
      setHighlighted(0);
    }
  }

  function selectGroup(group) {
    selectedGroup = group;
    const isNoGroup = !group || group.id === null;
    hiddenInput.value = isNoGroup ? '' : String(group.id);

    closeDropdown();
    searchWrapper.style.display = 'none';

    clearElement(selectedCard);

    const changeBtn = el('button', {
      type: 'button',
      className: 'btn btn-secondary btn-sm combobox-change-btn',
      onClick: () => {
        clearSelection();
        searchInput.focus();
        openDropdown();
      }
    }, 'O\'zgartirish');

    selectedCard.appendChild(
      el('div', { className: 'selected-group-info' },
        el('div', { className: 'selected-group-badge' },
          isNoGroup ? '✓ Tanlangan holat' : '✓ Tanlangan guruh'
        ),
        el('div', { className: 'selected-group-name' },
          isNoGroup ? 'Guruhsiz' : group.name
        ),
        el('div', { className: 'selected-group-meta' },
          isNoGroup
            ? 'O\'quvchi hech qaysi guruhga biriktirilmagan'
            : `ID: #${group.id} · ${group.student_count || 0} nafar o'quvchi`
        )
      )
    );
    selectedCard.appendChild(changeBtn);
    selectedCard.style.display = 'flex';

    if (typeof onSelect === 'function') {
      onSelect(selectedGroup);
    }
  }

  function clearSelection() {
    selectedGroup = null;
    hiddenInput.value = '';
    selectedCard.style.display = 'none';
    searchWrapper.style.display = 'block';
    searchInput.value = '';
    currentOptions = getAvailableOptions('');
    highlightedIndex = -1;
    searchInput.removeAttribute('aria-activedescendant');

    if (typeof onSelect === 'function') {
      onSelect(null);
    }
  }

  // Event handlers
  searchInput.addEventListener('focus', () => {
    openDropdown();
  });

  searchInput.addEventListener('click', () => {
    openDropdown();
  });

  searchInput.addEventListener('input', (e) => {
    if (!isOpen) openDropdown();
    filter(e.target.value);
  });

  searchInput.addEventListener('keydown', (e) => {
    const visibleCount = Math.min(currentOptions.length, MAX_VISIBLE_OPTIONS);

    if (!isOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      openDropdown();
      if (visibleCount > 0) {
        setHighlighted(e.key === 'ArrowDown' ? 0 : visibleCount - 1);
      }
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
          selectGroup(currentOptions[highlightedIndex]);
        } else if (isOpen && currentOptions.length === 1) {
          selectGroup(currentOptions[0]);
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

  // Apply preselection
  if (preselectedGroupId !== null && preselectedGroupId !== undefined && preselectedGroupId !== '') {
    const found = groups.find((g) => String(g.id) === String(preselectedGroupId));
    if (found) {
      selectGroup(found);
    } else {
      clearSelection();
    }
  } else if (preselectedGroupId === null && (groups.length > 0)) {
    // If preselected explicitly as null, select the Guruhsiz option
    selectGroup(NO_GROUP_OPTION);
  }

  return {
    element: container,
    getSelectedGroup: () => selectedGroup,
    getSelectedGroupId: () => (selectedGroup && selectedGroup.id ? Number(selectedGroup.id) : null),
    selectGroup,
    clearSelection,
    focus: () => {
      if (selectedGroup) {
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
