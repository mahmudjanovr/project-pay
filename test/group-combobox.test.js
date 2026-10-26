import test from 'node:test';
import assert from 'node:assert/strict';

// Setup Mock DOM environment for groupCombobox testing in Node.js
class MockElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.dataset = {};
    this.style = {};
    this.value = '';
    this.id = '';
    this.className = '';
    this.parentNode = null;
  }

  appendChild(child) {
    if (child instanceof MockElement || child instanceof MockTextNode) {
      child.parentNode = this;
      this.children.push(child);
    }
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  get firstChild() {
    return this.children[0] || null;
  }

  setAttribute(k, v) {
    this.attributes.set(k, String(v));
    if (k === 'id') this.id = String(v);
    if (k === 'class' || k === 'className') this.className = String(v);
    if (k === 'style') {
      const parts = String(v).split(';');
      for (const part of parts) {
        const [prop, val] = part.split(':');
        if (prop && val) {
          const camel = prop.trim().replace(/-([a-z])/g, (_, g) => g.toUpperCase());
          this.style[camel] = val.trim();
        }
      }
    }
  }

  getAttribute(k) {
    if (k.startsWith('data-')) {
      const camel = k.slice(5).replace(/-([a-z])/g, (_, g) => g.toUpperCase());
      if (this.dataset && camel in this.dataset) return this.dataset[camel];
    }
    return this.attributes.get(k) || null;
  }

  removeAttribute(k) {
    this.attributes.delete(k);
    if (k === 'id') this.id = '';
    if (k === 'class' || k === 'className') this.className = '';
  }

  addEventListener(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(handler);
  }

  removeEventListener(event, handler) {
    const list = this.listeners.get(event) || [];
    const idx = list.indexOf(handler);
    if (idx !== -1) list.splice(idx, 1);
  }

  dispatchEvent(event) {
    const list = this.listeners.get(event.type) || [];
    for (const h of list) h.call(this, event);
  }

  scrollIntoView() {}
  focus() {}

  contains(other) {
    let curr = other;
    while (curr) {
      if (curr === this) return true;
      curr = curr.parentNode;
    }
    return false;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  get textContent() {
    let text = '';
    for (const c of this.children) {
      if (c instanceof MockTextNode) {
        text += c.textContent;
      } else if (c instanceof MockElement) {
        text += c.textContent;
      }
    }
    return text;
  }

  set textContent(val) {
    this.children = [new MockTextNode(val)];
  }

  querySelectorAll(selector) {
    const results = [];
    function matchNode(el, sel) {
      let tag = null;
      let rest = sel;
      const tagMatch = sel.match(/^([a-zA-Z]+)(.*)/);
      if (tagMatch) {
        tag = tagMatch[1].toUpperCase();
        rest = tagMatch[2];
      }
      if (tag && el.tagName !== tag) return false;
      if (!rest) return true;

      if (rest.startsWith('.')) {
        const cls = rest.slice(1);
        return el.className.split(/\s+/).includes(cls);
      }
      if (rest.startsWith('#')) {
        return el.id === rest.slice(1);
      }
      if (rest.startsWith('[') && rest.endsWith(']')) {
        const inner = rest.slice(1, -1);
        if (inner.includes('=')) {
          const [k, v] = inner.split('=');
          const val = v.replace(/['"]/g, '');
          return el.getAttribute(k) === val;
        }
        return el.getAttribute(inner) !== null;
      }
      return false;
    }

    function search(node) {
      for (const c of node.children) {
        if (c instanceof MockElement) {
          if (matchNode(c, selector)) {
            results.push(c);
          }
          search(c);
        }
      }
    }
    search(this);
    return results;
  }

  get classList() {
    return {
      add: (cls) => {
        const parts = this.className ? this.className.split(/\s+/) : [];
        if (!parts.includes(cls)) {
          parts.push(cls);
          this.className = parts.join(' ').trim();
        }
      },
      remove: (cls) => {
        const parts = this.className ? this.className.split(/\s+/) : [];
        this.className = parts.filter((p) => p !== cls).join(' ').trim();
      },
      contains: (cls) => {
        const parts = this.className ? this.className.split(/\s+/) : [];
        return parts.includes(cls);
      }
    };
  }
}

class MockTextNode {
  constructor(text) {
    this.textContent = String(text);
    this.parentNode = null;
  }
}

if (!globalThis.document) {
  globalThis.Node = MockElement;
  globalThis.document = {
    createElement: (tag) => new MockElement(tag),
    createTextNode: (text) => new MockTextNode(text),
    addEventListener: () => {},
    removeEventListener: () => {}
  };
}

// Import after setting up mock DOM
const { createGroupCombobox, NO_GROUP_OPTION } = await import('../public/js/groupCombobox.js');

const SAMPLE_GROUPS = [
  { id: 1, name: 'Node.js Backend', student_count: 14, created_at: '2026-01-10T10:00:00.000Z' },
  { id: 2, name: 'Frontend React', student_count: 8, created_at: '2026-02-15T10:00:00.000Z' },
  { id: 3, name: 'Python Data Science', student_count: 0, created_at: '2026-03-01T10:00:00.000Z' }
];

test('Searchable Group Combobox (createGroupCombobox)', async (t) => {
  await t.test('initializes with no selection and renders combobox controls', () => {
    const cb = createGroupCombobox({ groups: SAMPLE_GROUPS });

    assert.ok(cb.element);
    assert.equal(cb.getSelectedGroup(), null);
    assert.equal(cb.getSelectedGroupId(), null);

    const hiddenInput = cb.element.querySelector('input[type="hidden"]');
    assert.ok(hiddenInput);
    assert.equal(hiddenInput.value, '');

    const searchInput = cb.element.querySelector('input[role="combobox"]');
    assert.ok(searchInput);
    assert.equal(searchInput.getAttribute('aria-expanded'), 'false');

    const dropdown = cb.element.querySelector('[role="listbox"]');
    assert.ok(dropdown);
    assert.equal(dropdown.style.display, 'none');

    cb.destroy();
  });

  await t.test('filters groups by exact and partial name case-insensitively', () => {
    const cb = createGroupCombobox({ groups: SAMPLE_GROUPS });
    const searchInput = cb.element.querySelector('input[role="combobox"]');
    const dropdown = cb.element.querySelector('[role="listbox"]');

    // Focus opens dropdown
    searchInput.dispatchEvent({ type: 'focus' });
    assert.equal(dropdown.style.display, 'block');

    // All options visible: Guruhsiz + 3 groups = 4 options
    let options = dropdown.querySelectorAll('.combobox-option');
    assert.equal(options.length, 4);

    // Search 'react'
    searchInput.value = 'react';
    searchInput.dispatchEvent({ type: 'input', target: searchInput });

    options = dropdown.querySelectorAll('.combobox-option');
    assert.equal(options.length, 1);
    assert.ok(options[0].textContent.includes('Frontend React'));

    // Search 'backend' (case-insensitive)
    searchInput.value = 'BACKEND';
    searchInput.dispatchEvent({ type: 'input', target: searchInput });

    options = dropdown.querySelectorAll('.combobox-option');
    assert.equal(options.length, 1);
    assert.ok(options[0].textContent.includes('Node.js Backend'));

    cb.destroy();
  });

  await t.test('includes "Guruhsiz" option when query is empty or matches guruhsiz', () => {
    const cb = createGroupCombobox({ groups: SAMPLE_GROUPS });
    const searchInput = cb.element.querySelector('input[role="combobox"]');
    const dropdown = cb.element.querySelector('[role="listbox"]');

    searchInput.value = 'guruhsiz';
    searchInput.dispatchEvent({ type: 'input', target: searchInput });

    const options = dropdown.querySelectorAll('.combobox-option');
    assert.ok(options.length >= 1);
    assert.ok(options[0].textContent.includes('Guruhsiz'));

    cb.destroy();
  });

  await t.test('selecting a group sets active state and displays selected group card', () => {
    let chosen = null;
    const cb = createGroupCombobox({
      groups: SAMPLE_GROUPS,
      onSelect: (g) => { chosen = g; }
    });

    const searchInput = cb.element.querySelector('input[role="combobox"]');
    const dropdown = cb.element.querySelector('[role="listbox"]');
    const selectedCard = cb.element.querySelector('.selected-group-card');
    const hiddenInput = cb.element.querySelector('input[type="hidden"]');

    searchInput.dispatchEvent({ type: 'focus' });
    const options = dropdown.querySelectorAll('.combobox-option');

    // Select group 1 ('Node.js Backend', index 1 because index 0 is Guruhsiz)
    const nodeOption = options.find((opt) => opt.textContent.includes('Node.js Backend'));
    assert.ok(nodeOption);
    nodeOption.dispatchEvent({ type: 'mousedown', preventDefault: () => {} });

    assert.equal(cb.getSelectedGroupId(), 1);
    assert.equal(cb.getSelectedGroup().name, 'Node.js Backend');
    assert.equal(hiddenInput.value, '1');
    assert.equal(chosen.id, 1);

    // Selected card is visible, dropdown and search input hidden
    assert.equal(selectedCard.style.display, 'flex');
    assert.ok(selectedCard.textContent.includes('Node.js Backend'));
    assert.ok(selectedCard.textContent.includes('14 nafar'));

    cb.destroy();
  });

  await t.test('selecting "Guruhsiz" sets unassigned state with null ID', () => {
    let chosen = null;
    const cb = createGroupCombobox({
      groups: SAMPLE_GROUPS,
      onSelect: (g) => { chosen = g; }
    });

    const searchInput = cb.element.querySelector('input[role="combobox"]');
    const dropdown = cb.element.querySelector('[role="listbox"]');
    const selectedCard = cb.element.querySelector('.selected-group-card');
    const hiddenInput = cb.element.querySelector('input[type="hidden"]');

    searchInput.dispatchEvent({ type: 'focus' });
    const options = dropdown.querySelectorAll('.combobox-option');

    // First option is Guruhsiz
    const noGroupOpt = options[0];
    assert.ok(noGroupOpt.textContent.includes('Guruhsiz'));
    noGroupOpt.dispatchEvent({ type: 'mousedown', preventDefault: () => {} });

    assert.equal(cb.getSelectedGroupId(), null);
    assert.equal(cb.getSelectedGroup().name, 'Guruhsiz');
    assert.equal(hiddenInput.value, '');
    assert.equal(chosen.id, null);

    assert.equal(selectedCard.style.display, 'flex');
    assert.ok(selectedCard.textContent.includes('Guruhsiz'));

    cb.destroy();
  });

  await t.test('clicking O\'zgartirish button clears selection and displays search input', () => {
    const cb = createGroupCombobox({
      groups: SAMPLE_GROUPS,
      preselectedGroupId: 2
    });

    const selectedCard = cb.element.querySelector('.selected-group-card');
    assert.equal(selectedCard.style.display, 'flex');
    assert.equal(cb.getSelectedGroupId(), 2);

    const changeBtn = selectedCard.querySelector('.combobox-change-btn');
    assert.ok(changeBtn);

    changeBtn.dispatchEvent({ type: 'click' });

    assert.equal(selectedCard.style.display, 'none');
    assert.equal(cb.getSelectedGroup(), null);
    assert.equal(cb.getSelectedGroupId(), null);

    cb.destroy();
  });

  await t.test('preserves preselected group when preselectedGroupId is provided', () => {
    const cb = createGroupCombobox({
      groups: SAMPLE_GROUPS,
      preselectedGroupId: 3
    });

    assert.equal(cb.getSelectedGroupId(), 3);
    assert.equal(cb.getSelectedGroup().name, 'Python Data Science');

    const selectedCard = cb.element.querySelector('.selected-group-card');
    assert.equal(selectedCard.style.display, 'flex');
    assert.ok(selectedCard.textContent.includes('Python Data Science'));

    cb.destroy();
  });

  await t.test('preserves preselected null group when preselectedGroupId is null', () => {
    const cb = createGroupCombobox({
      groups: SAMPLE_GROUPS,
      preselectedGroupId: null
    });

    assert.equal(cb.getSelectedGroupId(), null);
    assert.equal(cb.getSelectedGroup().name, 'Guruhsiz');

    const selectedCard = cb.element.querySelector('.selected-group-card');
    assert.equal(selectedCard.style.display, 'flex');
    assert.ok(selectedCard.textContent.includes('Guruhsiz'));

    cb.destroy();
  });

  await t.test('displays clear empty state when no groups match search query', () => {
    const cb = createGroupCombobox({ groups: SAMPLE_GROUPS });
    const searchInput = cb.element.querySelector('input[role="combobox"]');
    const dropdown = cb.element.querySelector('[role="listbox"]');

    searchInput.value = 'nonexistent_group_query_xyz';
    searchInput.dispatchEvent({ type: 'input', target: searchInput });

    const emptyStatus = dropdown.querySelector('.combobox-empty');
    assert.ok(emptyStatus);
    assert.ok(emptyStatus.textContent.includes('topilmadi'));

    cb.destroy();
  });

  await t.test('displays useful guidance and create link when groups list is empty', () => {
    const cb = createGroupCombobox({ groups: [] });

    assert.ok(cb.element);
    assert.equal(cb.getSelectedGroupId(), null);

    const notice = cb.element.querySelector('.combobox-no-data-notice');
    assert.ok(notice);
    assert.ok(notice.textContent.includes('Hozircha guruhlar mavjud emas'));

    const createLink = notice.querySelector('a');
    assert.ok(createLink);
    assert.equal(createLink.getAttribute('href'), '#/groups?action=new');

    cb.destroy();
  });

  await t.test('keyboard navigation: ArrowDown and Enter selects highlighted group', () => {
    const cb = createGroupCombobox({ groups: SAMPLE_GROUPS });
    const searchInput = cb.element.querySelector('input[role="combobox"]');
    const dropdown = cb.element.querySelector('[role="listbox"]');

    // Open dropdown with ArrowDown
    searchInput.dispatchEvent({ type: 'keydown', key: 'ArrowDown', preventDefault: () => {} });
    assert.equal(dropdown.style.display, 'block');

    // Move to next item (index 0 -> index 1 = Node.js Backend)
    searchInput.dispatchEvent({ type: 'keydown', key: 'ArrowDown', preventDefault: () => {} });
    searchInput.dispatchEvent({ type: 'keydown', key: 'ArrowDown', preventDefault: () => {} });

    // Press Enter to select
    searchInput.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault: () => {} });

    assert.ok(cb.getSelectedGroup());
    assert.ok(cb.getSelectedGroupId() > 0);

    cb.destroy();
  });
});
