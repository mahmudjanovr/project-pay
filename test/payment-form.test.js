import test from 'node:test';
import assert from 'node:assert/strict';

import { parsePaymentAmount } from '../public/js/amountParser.js';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db/connection.js';
import { initDatabase } from '../src/db/init.js';
import { createStudent } from '../src/services/students.js';

// Setup Mock DOM environment for studentCombobox testing in Node.js
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

  querySelectorAll(selector) {
    const results = [];
    function search(node) {
      for (const c of node.children) {
        if (c instanceof MockElement) {
          if (selector.startsWith('.') && c.className.split(/\s+/).includes(selector.slice(1))) {
            results.push(c);
          } else if (selector.startsWith('#') && c.id === selector.slice(1)) {
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

// Dynamically import combobox after DOM polyfill is established
const { createStudentCombobox } = await import('../public/js/studentCombobox.js');

function createTestContext() {
  const db = createDatabase(':memory:');
  initDatabase(db);
  const app = createApp(db);
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    db,
    app,
    server,
    baseUrl,
    close: () => server.close()
  };
}

// ==============================================================================
// 1. Amount Parsing & Validation Unit Tests
// ==============================================================================
test('Financial Amount Parsing (parsePaymentAmount)', async (t) => {
  await t.test('parses pure integers: 120000 and 120001 correctly', () => {
    const r1 = parsePaymentAmount('120000');
    assert.equal(r1.valid, true);
    assert.equal(r1.value, 120000);
    assert.ok(r1.formatted.includes('120'));

    const r2 = parsePaymentAmount('120001');
    assert.equal(r2.valid, true);
    assert.equal(r2.value, 120001);
    assert.ok(r2.formatted.includes('120'));
  });

  await t.test('parses comma-separated thousands: 120,000 and 120,001', () => {
    const r1 = parsePaymentAmount('120,000');
    assert.equal(r1.valid, true);
    assert.equal(r1.value, 120000);

    const r2 = parsePaymentAmount('120,001');
    assert.equal(r2.valid, true);
    assert.equal(r2.value, 120001);

    const r3 = parsePaymentAmount('1,200,000');
    assert.equal(r3.valid, true);
    assert.equal(r3.value, 1200000);
  });

  await t.test('parses space-separated thousands: 120 000 and 1 200 000', () => {
    const r1 = parsePaymentAmount('120 000');
    assert.equal(r1.valid, true);
    assert.equal(r1.value, 120000);

    const r2 = parsePaymentAmount('1 200 000');
    assert.equal(r2.valid, true);
    assert.equal(r2.value, 1200000);
  });

  await t.test('120000, 120,000, and 120 000 produce identical numeric integer values', () => {
    const plain = parsePaymentAmount('120000');
    const comma = parsePaymentAmount('120,000');
    const space = parsePaymentAmount('120 000');

    assert.equal(plain.value, 120000);
    assert.equal(comma.value, 120000);
    assert.equal(space.value, 120000);
    assert.strictEqual(plain.value, comma.value);
    assert.strictEqual(comma.value, space.value);
  });

  await t.test('parses boundary amounts: 1 UZS and Number.MAX_SAFE_INTEGER', () => {
    const r1 = parsePaymentAmount('1');
    assert.equal(r1.valid, true);
    assert.equal(r1.value, 1);

    const rMax = parsePaymentAmount(String(Number.MAX_SAFE_INTEGER));
    assert.equal(rMax.valid, true);
    assert.equal(rMax.value, Number.MAX_SAFE_INTEGER);
  });

  await t.test('rejects zero and negative numbers', () => {
    const rZero = parsePaymentAmount('0');
    assert.equal(rZero.valid, false);
    assert.ok(rZero.error.includes('0 dan katta'));

    const rNeg = parsePaymentAmount('-120000');
    assert.equal(rNeg.valid, false);
    assert.ok(rNeg.error.includes('0 dan katta'));
  });

  await t.test('rejects decimals with dot (e.g. 120000.00 or 120.50)', () => {
    const r1 = parsePaymentAmount('120000.00');
    assert.equal(r1.valid, false);
    assert.ok(r1.error.includes('tiyinlar qabul qilinmaydi'));

    const r2 = parsePaymentAmount('120.50');
    assert.equal(r2.valid, false);
    assert.ok(r2.error.includes('tiyinlar qabul qilinmaydi'));
  });

  await t.test('rejects decimals with comma and malformed separators (120,50, 120,00, 120,5)', () => {
    // 120,50 is NOT a valid thousands separator (2 digits after comma instead of 3)
    const r1 = parsePaymentAmount('120,50');
    assert.equal(r1.valid, false);
    assert.ok(r1.error.includes('Minglik ajratgichlardan to\'g\'ri foydalaning'));

    const r2 = parsePaymentAmount('120,00');
    assert.equal(r2.valid, false);
    assert.ok(r2.error.includes('Minglik ajratgichlardan to\'g\'ri foydalaning'));

    const r3 = parsePaymentAmount('120,5');
    assert.equal(r3.valid, false);
    assert.ok(r3.error.includes('Minglik ajratgichlardan to\'g\'ri foydalaning'));

    const r4 = parsePaymentAmount('120 00');
    assert.equal(r4.valid, false);
    assert.ok(r4.error.includes('Bo\'sh joy'));
  });

  await t.test('rejects mixed, multiple, or trailing separators', () => {
    assert.equal(parsePaymentAmount('120,000 000').valid, false);
    assert.equal(parsePaymentAmount('120,,000').valid, false);
    assert.equal(parsePaymentAmount('120,000,00').valid, false);
    assert.equal(parsePaymentAmount(',120000').valid, false);
    assert.equal(parsePaymentAmount('120000,').valid, false);
  });

  await t.test('rejects unsafe integers exceeding Number.MAX_SAFE_INTEGER', () => {
    const unsafeVal = '9007199254740992';
    const r = parsePaymentAmount(unsafeVal);
    assert.equal(r.valid, false);
    assert.ok(r.error.includes('maksimal miqdordan oshib ketdi'));
  });

  await t.test('rejects empty, null, and non-numeric inputs', () => {
    assert.equal(parsePaymentAmount('').valid, false);
    assert.equal(parsePaymentAmount('   ').valid, false);
    assert.equal(parsePaymentAmount(null).valid, false);
    assert.equal(parsePaymentAmount(undefined).valid, false);
    assert.equal(parsePaymentAmount('abc').valid, false);
    assert.equal(parsePaymentAmount('120a').valid, false);
  });
});

// ==============================================================================
// 2. Searchable Student Combobox Component Tests
// ==============================================================================
test('Searchable Student Combobox (createStudentCombobox)', async (t) => {
  const sampleStudents = [
    { id: 1, full_name: 'Alisher Navoiy', monthly_fee: 1200000 },
    { id: 2, full_name: 'Bobur Mirzo', monthly_fee: 1000000 },
    { id: 3, full_name: 'Nodira Begim', monthly_fee: 900000 },
    { id: 4, full_name: 'Anvar Olimov', monthly_fee: 1500000 },
    { id: 5, full_name: 'Ali Valiyev', monthly_fee: 800000 }
  ];

  await t.test('initializes with no selection and renders combobox controls', () => {
    const cb = createStudentCombobox({ students: sampleStudents });
    assert.equal(cb.getSelectedStudent(), null);
    assert.equal(cb.getSelectedStudentId(), null);

    const searchInput = cb.element.querySelector('.combobox-input');
    assert.ok(searchInput);
    assert.equal(searchInput.getAttribute('role'), 'combobox');
    assert.equal(searchInput.getAttribute('aria-expanded'), 'false');
  });

  await t.test('filters students by exact full name case-insensitively', () => {
    const cb = createStudentCombobox({ students: sampleStudents });
    const searchInput = cb.element.querySelector('.combobox-input');

    // Simulate user typing 'alisher navoiy'
    searchInput.value = 'alisher navoiy';
    searchInput.dispatchEvent({ type: 'input', target: searchInput });

    const dropdown = cb.element.querySelector('.combobox-dropdown');
    const options = dropdown.querySelectorAll('.combobox-option');
    assert.equal(options.length, 1);
    assert.equal(options[0].getAttribute('data-student-id'), '1');
  });

  await t.test('filters students by partial name (first name, last name, middle substring)', () => {
    const cb = createStudentCombobox({ students: sampleStudents });
    const searchInput = cb.element.querySelector('.combobox-input');

    // Searching 'ali' should match 'Alisher Navoiy' and 'Ali Valiyev'
    searchInput.value = 'ali';
    searchInput.dispatchEvent({ type: 'input', target: searchInput });

    const dropdown = cb.element.querySelector('.combobox-dropdown');
    const options = dropdown.querySelectorAll('.combobox-option');
    assert.equal(options.length, 2);
    const ids = options.map((o) => o.getAttribute('data-student-id'));
    assert.ok(ids.includes('1'));
    assert.ok(ids.includes('5'));

    // Searching 'mirzo' matches 'Bobur Mirzo'
    searchInput.value = 'mirzo';
    searchInput.dispatchEvent({ type: 'input', target: searchInput });
    const mirzoOptions = dropdown.querySelectorAll('.combobox-option');
    assert.equal(mirzoOptions.length, 1);
    assert.equal(mirzoOptions[0].getAttribute('data-student-id'), '2');
  });

  await t.test('displays clear empty state when no students match', () => {
    const cb = createStudentCombobox({ students: sampleStudents });
    const searchInput = cb.element.querySelector('.combobox-input');

    searchInput.value = 'ZzzzzNotExist';
    searchInput.dispatchEvent({ type: 'input', target: searchInput });

    const dropdown = cb.element.querySelector('.combobox-dropdown');
    const emptyEl = dropdown.querySelector('.combobox-empty');
    assert.ok(emptyEl);
    const options = dropdown.querySelectorAll('.combobox-option');
    assert.equal(options.length, 0);
  });

  await t.test('selecting a student sets active state and displays selected student card', () => {
    let selectedCallbackData = null;
    const cb = createStudentCombobox({
      students: sampleStudents,
      onSelect: (student) => {
        selectedCallbackData = student;
      }
    });

    cb.selectStudent(sampleStudents[1]); // Bobur Mirzo

    assert.equal(cb.getSelectedStudent().id, 2);
    assert.equal(cb.getSelectedStudentId(), 2);
    assert.equal(selectedCallbackData.full_name, 'Bobur Mirzo');

    const selectedCard = cb.element.querySelector('.selected-student-card');
    assert.equal(selectedCard.style.display, 'flex');
    const nameEl = selectedCard.querySelector('.selected-student-name');
    assert.ok(nameEl);
  });

  await t.test('preserves preselected student when preselectedStudentId is provided', () => {
    const cb = createStudentCombobox({
      students: sampleStudents,
      preselectedStudentId: '4' // Anvar Olimov
    });

    assert.equal(cb.getSelectedStudentId(), 4);
    assert.equal(cb.getSelectedStudent().full_name, 'Anvar Olimov');

    const selectedCard = cb.element.querySelector('.selected-student-card');
    assert.equal(selectedCard.style.display, 'flex');
  });

  await t.test('clearing selection resets state and shows search input again', () => {
    const cb = createStudentCombobox({
      students: sampleStudents,
      preselectedStudentId: 3
    });

    assert.equal(cb.getSelectedStudentId(), 3);
    cb.clearSelection();

    assert.equal(cb.getSelectedStudent(), null);
    assert.equal(cb.getSelectedStudentId(), null);

    const selectedCard = cb.element.querySelector('.selected-student-card');
    assert.equal(selectedCard.style.display, 'none');

    const searchWrapper = cb.element.querySelector('.combobox-search-wrapper');
    assert.equal(searchWrapper.style.display, 'block');
  });

  await t.test('keyboard navigation: Enter on filtered result selects student', () => {
    const cb = createStudentCombobox({ students: sampleStudents });
    const searchInput = cb.element.querySelector('.combobox-input');

    // Focus / open dropdown
    searchInput.dispatchEvent({ type: 'focus' });

    // Type 'nodira'
    searchInput.value = 'nodira';
    searchInput.dispatchEvent({ type: 'input', target: searchInput });

    // Press Enter to select single filtered result
    searchInput.dispatchEvent({
      type: 'keydown',
      key: 'Enter',
      preventDefault: () => {}
    });

    assert.equal(cb.getSelectedStudentId(), 3);
    assert.equal(cb.getSelectedStudent().full_name, 'Nodira Begim');
  });
});

// ==============================================================================
// 3. API Submission & Amount Integrity Tests (120000 vs 120001)
// ==============================================================================
test('API Submission for 120000 and 120001 Payments', async (t) => {
  const ctx = createTestContext();
  t.after(() => ctx.close());

  // Create student in db
  const student = createStudent(ctx.db, {
    full_name: 'Test Student',
    monthly_fee: 1200000
  });

  await t.test('submits 120000 successfully and verifies exact payload stored', async () => {
    const parsed = parsePaymentAmount('120000');
    assert.equal(parsed.valid, true);

    const payload = {
      student_id: student.id,
      amount: parsed.value,
      payment_date: '2026-10-26'
    };

    const res = await fetch(`${ctx.baseUrl}/api/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.amount, 120000);
    assert.equal(typeof data.amount, 'number');
    assert.equal(data.student_id, student.id);
  });

  await t.test('submits 120001 successfully and verifies exact payload stored', async () => {
    const parsed = parsePaymentAmount('120001');
    assert.equal(parsed.valid, true);

    const payload = {
      student_id: student.id,
      amount: parsed.value,
      payment_date: '2026-10-26'
    };

    const res = await fetch(`${ctx.baseUrl}/api/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.amount, 120001);
    assert.equal(typeof data.amount, 'number');
  });

  await t.test('entering 120,000 produces identical payload and DB state as 120000', async () => {
    const parsedFormatted = parsePaymentAmount('120,000');
    const parsedPlain = parsePaymentAmount('120000');
    const parsedSpace = parsePaymentAmount('120 000');

    assert.strictEqual(parsedFormatted.value, parsedPlain.value);
    assert.strictEqual(parsedSpace.value, parsedPlain.value);

    const payload = {
      student_id: student.id,
      amount: parsedFormatted.value,
      payment_date: '2026-10-26'
    };

    const res = await fetch(`${ctx.baseUrl}/api/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.amount, 120000);
  });
});
