import test from 'node:test';
import assert from 'node:assert/strict';

import { parsePaymentAmount, parseMonthlyFee } from '../public/js/amountParser.js';
import {
  parsePaymentAmount as reExportedParsePaymentAmount,
  parseMonthlyFee as reExportedParseMonthlyFee
} from '../public/js/formatters.js';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db/connection.js';
import { initDatabase } from '../src/db/init.js';
import { createStudent, getStudentById } from '../src/services/students.js';

// Setup Mock DOM environment for frontend form, modal, and combobox testing in Node.js
class MockNode {}

class MockTextNode extends MockNode {
  constructor(text) {
    super();
    this.textContent = String(text);
    this.parentNode = null;
  }
}

class MockElement extends MockNode {
  constructor(tag) {
    super();
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
    this.disabled = false;
  }

  appendChild(child) {
    if (child instanceof MockNode) {
      if (child.parentNode && child.parentNode !== this) {
        child.parentNode.removeChild(child);
      }
      child.parentNode = this;
      if (!this.children.includes(child)) {
        this.children.push(child);
      }
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

  get textContent() {
    let out = '';
    for (const c of this.children) {
      out += c.textContent;
    }
    return out;
  }

  set textContent(val) {
    this.children = [];
    if (val !== null && val !== undefined && String(val) !== '') {
      this.appendChild(new MockTextNode(String(val)));
    }
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
    return this.attributes.has(k) ? this.attributes.get(k) : null;
  }

  hasAttribute(k) {
    return this.getAttribute(k) !== null;
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

  async dispatchEventAsync(event) {
    const list = this.listeners.get(event.type) || [];
    for (const h of list) {
      await h.call(this, event);
    }
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
    const subSelectors = selector.split(',').map((s) => s.trim()).filter(Boolean);
    const results = [];

    function matchesSingle(el, sel) {
      let working = sel;
      let notClass = null;
      const notMatch = working.match(/:not\(\.([a-zA-Z0-9_-]+)\)$/);
      if (notMatch) {
        notClass = notMatch[1];
        working = working.slice(0, -notMatch[0].length);
      }

      let tag = null;
      const tagMatch = working.match(/^([a-zA-Z0-9]+)(.*)/);
      if (tagMatch) {
        tag = tagMatch[1].toUpperCase();
        working = tagMatch[2];
      }
      if (tag && el.tagName !== tag) return false;
      if (notClass && el.classList.contains(notClass)) return false;
      if (!working) return true;

      if (working.startsWith('.')) {
        return el.classList.contains(working.slice(1));
      }
      if (working.startsWith('#')) {
        return el.id === working.slice(1);
      }
      if (working.startsWith('[') && working.endsWith(']')) {
        const inner = working.slice(1, -1);
        if (inner.includes('=')) {
          const [k, v] = inner.split('=');
          const cleanVal = v.replace(/['"]/g, '');
          return el.getAttribute(k) === cleanVal;
        }
        return el.hasAttribute(inner);
      }
      return false;
    }

    function search(node) {
      for (const c of node.children) {
        if (c instanceof MockElement) {
          if (subSelectors.some((sel) => matchesSingle(c, sel))) {
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

if (!globalThis.document) {
  globalThis.Node = MockNode;
  const mockBody = new MockElement('body');
  globalThis.document = {
    body: mockBody,
    createElement: (tag) => new MockElement(tag),
    createTextNode: (text) => new MockTextNode(text),
    getElementById: (id) => mockBody.querySelector(`#${id}`),
    addEventListener: () => {},
    removeEventListener: () => {}
  };
}

// Dynamically import UI modules after DOM polyfill is established
const { createStudentCombobox } = await import('../public/js/studentCombobox.js');
const { showAddStudentModal, showEditStudentModal } = await import('../public/js/views/students.js');
const { renderPayments } = await import('../public/js/views/payments.js');

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

  await t.test('submits 450,000 and 450000 payments identically as integer 450000', async () => {
    const parsedComma = parsePaymentAmount('450,000');
    const parsedPlain = parsePaymentAmount('450000');
    const parsedSpace = parsePaymentAmount('450 000');
    const parsedNbsp = parsePaymentAmount('450\u00A0000');
    const parsedNarrowNbsp = parsePaymentAmount('450\u202F000');

    assert.equal(parsedComma.valid, true);
    assert.equal(parsedComma.value, 450000);
    assert.strictEqual(parsedPlain.value, 450000);
    assert.strictEqual(parsedSpace.value, 450000);
    assert.strictEqual(parsedNbsp.value, 450000);
    assert.strictEqual(parsedNarrowNbsp.value, 450000);

    const res = await fetch(`${ctx.baseUrl}/api/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_id: student.id,
        amount: parsedComma.value,
        payment_date: '2026-10-26'
      })
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.amount, 450000);
  });
});

// ==============================================================================
// 4. Monthly Fee Parsing & Validation Unit Tests (parseMonthlyFee)
// ==============================================================================
test('Student Monthly Fee Parsing (parseMonthlyFee)', async (t) => {
  await t.test('formatters.js re-exports parseMonthlyFee and parsePaymentAmount', () => {
    assert.strictEqual(reExportedParseMonthlyFee, parseMonthlyFee);
    assert.strictEqual(reExportedParsePaymentAmount, parsePaymentAmount);
  });

  await t.test('accepts 0 for scholarship/free students', () => {
    const r = parseMonthlyFee('0');
    assert.equal(r.valid, true);
    assert.strictEqual(r.value, 0);
    assert.equal(r.formatted, '0 so\'m');

    const rNum = parseMonthlyFee(0);
    assert.equal(rNum.valid, true);
    assert.strictEqual(rNum.value, 0);
  });

  await t.test('parses 450000, 450,000, and 450 000 to exact safe integer 450000', () => {
    const plain = parseMonthlyFee('450000');
    const comma = parseMonthlyFee('450,000');
    const space = parseMonthlyFee('450 000');
    const nbsp = parseMonthlyFee('450\u00A0000');
    const narrowNbsp = parseMonthlyFee('450\u202F000');

    assert.equal(plain.valid, true);
    assert.equal(comma.valid, true);
    assert.equal(space.valid, true);
    assert.equal(nbsp.valid, true);
    assert.equal(narrowNbsp.valid, true);

    assert.strictEqual(plain.value, 450000);
    assert.strictEqual(comma.value, 450000);
    assert.strictEqual(space.value, 450000);
    assert.strictEqual(nbsp.value, 450000);
    assert.strictEqual(narrowNbsp.value, 450000);
  });

  await t.test('parses non-1000-multiple amounts such as 120001, 120,001, 450,001, and 1', () => {
    assert.deepEqual(
      { valid: parseMonthlyFee('120001').valid, value: parseMonthlyFee('120001').value },
      { valid: true, value: 120001 }
    );
    assert.deepEqual(
      { valid: parseMonthlyFee('120,001').valid, value: parseMonthlyFee('120,001').value },
      { valid: true, value: 120001 }
    );
    assert.deepEqual(
      { valid: parseMonthlyFee('450,001').valid, value: parseMonthlyFee('450,001').value },
      { valid: true, value: 450001 }
    );
    assert.deepEqual(
      { valid: parseMonthlyFee('1').valid, value: parseMonthlyFee('1').value },
      { valid: true, value: 1 }
    );
  });

  await t.test('rejects negative values, decimals, malformed separators, leading zeros, and unsafe integers', () => {
    assert.equal(parseMonthlyFee('-1').valid, false);
    assert.equal(parseMonthlyFee('-450000').valid, false);
    assert.equal(parseMonthlyFee(-0).valid, false);
    assert.equal(parseMonthlyFee('450.50').valid, false);
    assert.equal(parseMonthlyFee('450000.00').valid, false);
    assert.equal(parseMonthlyFee('450,50').valid, false);
    assert.equal(parseMonthlyFee('450,00').valid, false);
    assert.equal(parseMonthlyFee('450,5').valid, false);
    assert.equal(parseMonthlyFee('450 00').valid, false);
    assert.equal(parseMonthlyFee('00').valid, false);
    assert.equal(parseMonthlyFee('0450000').valid, false);
    assert.equal(parseMonthlyFee('').valid, false);
    assert.equal(parseMonthlyFee('   ').valid, false);
    assert.equal(parseMonthlyFee(null).valid, false);
    assert.equal(parseMonthlyFee(undefined).valid, false);
    assert.equal(parseMonthlyFee('abc').valid, false);
    assert.equal(parseMonthlyFee('9007199254740992').valid, false);
  });
});

// ==============================================================================
// 5. UI Monetary Inputs & End-to-End Modal/Form Regression Tests
// ==============================================================================
test('Monetary UI Inputs Regression (Add/Edit Student Modals & Payment Form)', async (t) => {
  const ctx = createTestContext();
  const originalFetch = globalThis.fetch;

  // Route relative '/api/...' requests from frontend api.js to ephemeral test server
  globalThis.fetch = (url, init) => {
    if (typeof url === 'string' && url.startsWith('/')) {
      return originalFetch(`${ctx.baseUrl}${url}`, init);
    }
    return originalFetch(url, init);
  };

  function dismissActiveToasts() {
    const closeBtns = globalThis.document.body.querySelectorAll('.toast-close');
    for (const btn of closeBtns) {
      btn.dispatchEvent({ type: 'click' });
    }
  }

  t.after(() => {
    dismissActiveToasts();
    globalThis.fetch = originalFetch;
    ctx.close();
  });

  await t.test('Add Student modal uses text+numeric input without step="1000" and submits 450,000, 450000, 120001, and 0', async () => {
    const cases = [
      { fullName: 'Comma Fee Student', rawFee: '450,000', expectedFee: 450000 },
      { fullName: 'Plain Fee Student', rawFee: '450000', expectedFee: 450000 },
      { fullName: 'Non-Step Fee Student', rawFee: '120001', expectedFee: 120001 },
      { fullName: 'Grant Zero Student', rawFee: '0', expectedFee: 0 }
    ];

    for (const item of cases) {
      let successCalled = false;
      showAddStudentModal([], () => {
        successCalled = true;
      });

      const overlay = globalThis.document.getElementById('modal-overlay');
      assert.ok(overlay, 'Modal overlay should be mounted');

      const form = overlay.querySelector('form');
      assert.ok(form, 'Add student form should exist');
      assert.equal(form.hasAttribute('novalidate'), true, 'Form must set novalidate to prevent native stepMismatch tooltip');

      const feeInput = overlay.querySelector('#add-student-fee');
      assert.ok(feeInput, 'Monthly fee input must exist');
      assert.equal(feeInput.getAttribute('type'), 'text');
      assert.equal(feeInput.getAttribute('inputmode'), 'numeric');
      assert.equal(feeInput.getAttribute('step'), null, 'Monthly fee input must NOT impose a step constraint');
      assert.equal(feeInput.getAttribute('min'), null, 'Monthly fee input must NOT rely on HTML number min attribute');

      const nameInput = overlay.querySelector('#add-student-name');
      nameInput.value = item.fullName;

      feeInput.value = item.rawFee;
      feeInput.dispatchEvent({ type: 'input', target: feeInput });

      const feeHelp = overlay.querySelectorAll('.form-help')[1];
      assert.ok(feeHelp.textContent.includes('Oylik to\'lov:'));

      await form.dispatchEventAsync({ type: 'submit', preventDefault: () => {} });
      dismissActiveToasts();

      assert.equal(successCalled, true, `Expected modal submission to succeed for "${item.rawFee}"`);

      const res = await fetch(`${ctx.baseUrl}/api/students`);
      const students = await res.json();
      const created = students.find((s) => s.full_name === item.fullName);
      assert.ok(created, `Student "${item.fullName}" should be saved in DB`);
      assert.strictEqual(created.monthly_fee, item.expectedFee);
    }
  });

  await t.test('Add Student modal blocks negative or decimal fee inputs with Uzbek validation message', async () => {
    showAddStudentModal([], () => {
      assert.fail('Should not succeed on invalid monthly fee');
    });

    const overlay = globalThis.document.getElementById('modal-overlay');
    const form = overlay.querySelector('form');
    const nameInput = overlay.querySelector('#add-student-name');
    const feeInput = overlay.querySelector('#add-student-fee');
    const errorBox = overlay.querySelector('.form-error');

    nameInput.value = 'Invalid Fee Student';
    feeInput.value = '-5000';
    await form.dispatchEventAsync({ type: 'submit', preventDefault: () => {} });
    assert.equal(errorBox.style.display, 'block');
    assert.ok(errorBox.textContent.includes('noldan kichik bo\'lmagan'));

    feeInput.value = '450,50';
    await form.dispatchEventAsync({ type: 'submit', preventDefault: () => {} });
    assert.equal(errorBox.style.display, 'block');
    assert.ok(errorBox.textContent.includes('Minglik ajratgichlardan'));
  });

  await t.test('Edit Student modal pre-populates plain integer digits without step="1000" and updates to 450,000, 120001, and 0', async () => {
    const existing = createStudent(ctx.db, {
      full_name: 'Editable Student',
      phone: '+998 90 555 44 33',
      monthly_fee: 450000
    });

    const editCases = [
      { rawFee: '450,000', expectedFee: 450000 },
      { rawFee: '120001', expectedFee: 120001 },
      { rawFee: '0', expectedFee: 0 }
    ];

    for (const item of editCases) {
      const currentRecord = getStudentById(ctx.db, existing.id);
      let updatedCalled = false;

      showEditStudentModal(currentRecord, [], () => {
        updatedCalled = true;
      });

      const overlay = globalThis.document.getElementById('modal-overlay');
      const form = overlay.querySelector('form');
      assert.equal(form.hasAttribute('novalidate'), true);

      const feeInput = overlay.querySelector(`#edit-student-fee-${existing.id}`);
      assert.ok(feeInput);
      assert.equal(feeInput.getAttribute('type'), 'text');
      assert.equal(feeInput.getAttribute('inputmode'), 'numeric');
      assert.equal(feeInput.getAttribute('step'), null);
      assert.equal(feeInput.getAttribute('min'), null);
      assert.equal(feeInput.value, String(currentRecord.monthly_fee));

      feeInput.value = item.rawFee;
      feeInput.dispatchEvent({ type: 'input', target: feeInput });

      await form.dispatchEventAsync({ type: 'submit', preventDefault: () => {} });
      dismissActiveToasts();

      assert.equal(updatedCalled, true, `Expected edit submission to succeed for "${item.rawFee}"`);
      const refreshed = getStudentById(ctx.db, existing.id);
      assert.strictEqual(refreshed.monthly_fee, item.expectedFee);
    }
  });

  await t.test('Record Payment view uses text+numeric input without step="1000", accepts 450,000 and 120001, and rejects 0', async () => {
    const payer = createStudent(ctx.db, {
      full_name: 'Payment Form Student',
      monthly_fee: 450000
    });

    const container = new MockElement('div');
    await renderPayments(container, new URLSearchParams(`student_id=${payer.id}`));

    const form = container.querySelector('form');
    assert.ok(form);
    assert.equal(form.hasAttribute('novalidate'), true);

    const amountInput = container.querySelector('#payment-amount-input');
    assert.ok(amountInput);
    assert.equal(amountInput.getAttribute('type'), 'text');
    assert.equal(amountInput.getAttribute('inputmode'), 'numeric');
    assert.equal(amountInput.getAttribute('step'), null);
    assert.equal(amountInput.getAttribute('min'), null);

    const dateInput = container.querySelector('#payment-date-input');
    dateInput.value = '2026-10-26';

    // 0 must be rejected for payments (positive integer required)
    const errorBox = container.querySelector('#payment-error-box');
    amountInput.value = '0';
    await form.dispatchEventAsync({ type: 'submit', preventDefault: () => {} });
    assert.equal(errorBox.style.display, 'block');
    assert.ok(errorBox.textContent.includes('0 dan katta'));

    // 450,000 must succeed and persist 450000
    amountInput.value = '450,000';
    await form.dispatchEventAsync({ type: 'submit', preventDefault: () => {} });
    dismissActiveToasts();
    assert.equal(errorBox.style.display, 'none');

    // 120001 must succeed and persist 120001
    amountInput.value = '120001';
    await form.dispatchEventAsync({ type: 'submit', preventDefault: () => {} });
    dismissActiveToasts();
    assert.equal(errorBox.style.display, 'none');

    const paymentsRes = await fetch(`${ctx.baseUrl}/api/students/${payer.id}/payments`);
    const payments = await paymentsRes.json();
    assert.deepEqual(
      payments.map((p) => p.amount),
      [450000, 120001]
    );
  });
});
