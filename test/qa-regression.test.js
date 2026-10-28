import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createApp } from '../src/app.js';
import { startServer } from '../src/server.js';
import { createDatabase } from '../src/db/connection.js';
import { initDatabase } from '../src/db/init.js';
import { createGroup, listGroups, updateGroup, deleteGroup } from '../src/services/groups.js';
import { createStudent, listStudents, updateStudent, deleteStudent } from '../src/services/students.js';
import { createPayment, getPaymentsByStudent } from '../src/services/payments.js';
import { getMonthlyDebtors } from '../src/services/debtors.js';
import { getMonthDateRange } from '../src/utils/date.js';

import { el, clearElement } from '../public/js/dom.js';
import {
  formatUzbekSom,
  isValidCalendarDateString,
  parseMonthlyFee,
  parsePaymentAmount
} from '../public/js/formatters.js';
import {
  ApiError,
  fetchStudent,
  fetchGroup,
  createStudent as apiCreateStudent,
  createGroup as apiCreateGroup,
  deleteGroup as apiDeleteGroup,
  deleteStudent as apiDeleteStudent,
  recordPayment as apiRecordPayment,
  fetchMonthlyDebtors as apiFetchMonthlyDebtors
} from '../public/js/api.js';
import { openModal, closeModal } from '../public/js/modal.js';
import { createStudentCombobox } from '../public/js/studentCombobox.js';
import { createGroupCombobox } from '../public/js/groupCombobox.js';
import { Router } from '../public/js/router.js';
import { renderDashboard } from '../public/js/views/dashboard.js';
import { renderStudents, showAddStudentModal, showEditStudentModal } from '../public/js/views/students.js';
import { renderStudentDetail } from '../public/js/views/studentDetail.js';
import { renderGroups, showAddGroupModal, showEditGroupModal } from '../public/js/views/groups.js';
import { renderGroupDetail } from '../public/js/views/groupDetail.js';
import { renderPayments } from '../public/js/views/payments.js';
import { renderDebtors } from '../public/js/views/debtors.js';
import { createPageShell, createSectionToolbar, renderStateView } from '../public/js/pageLayout.js';

// ============================================================================
// Lightweight Mock DOM for deterministic frontend unit/integration regressions
// ============================================================================
class MockNode {}

class MockTextNode extends MockNode {
  constructor(text) {
    super();
    this.textContent = String(text);
    this.parentNode = null;
  }

  get isConnected() {
    return this.parentNode ? this.parentNode.isConnected : false;
  }
}

class MockElement extends MockNode {
  constructor(tag, ownerDoc = null) {
    super();
    this.tagName = tag.toUpperCase();
    this.ownerDocument = ownerDoc;
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
    this.tabIndex = 0;
    this.onclick = null;
  }

  get isConnected() {
    let curr = this;
    while (curr) {
      if (this.ownerDocument && (curr === this.ownerDocument.body || curr === this.ownerDocument.documentElement)) {
        return true;
      }
      curr = curr.parentNode;
    }
    return false;
  }

  get classList() {
    const self = this;
    return {
      add(...tokens) {
        const set = new Set(self.className.split(/\s+/).filter(Boolean));
        for (const t of tokens) set.add(t);
        self.className = [...set].join(' ');
      },
      remove(...tokens) {
        const set = new Set(self.className.split(/\s+/).filter(Boolean));
        for (const t of tokens) set.delete(t);
        self.className = [...set].join(' ');
      },
      toggle(token) {
        if (this.contains(token)) {
          this.remove(token);
          return false;
        }
        this.add(token);
        return true;
      },
      contains(token) {
        return self.className.split(/\s+/).filter(Boolean).includes(token);
      }
    };
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
  }

  getAttribute(k) {
    if (k === 'id' && this.id) return this.id;
    if (k === 'class' && this.className) return this.className;
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
    const ev = { currentTarget: this, target: event.target || this, ...event };
    if (ev.type === 'click' && typeof this.onclick === 'function') {
      this.onclick(ev);
    }
    const list = [...(this.listeners.get(ev.type) || [])];
    for (const h of list) h.call(this, ev);
  }

  async dispatchEventAsync(event) {
    const ev = { currentTarget: this, target: event.target || this, ...event };
    if (ev.type === 'click' && typeof this.onclick === 'function') {
      await this.onclick(ev);
    }
    const list = [...(this.listeners.get(ev.type) || [])];
    for (const h of list) {
      await h.call(this, ev);
    }
  }

  focus() {
    if (this.ownerDocument) {
      this.ownerDocument.activeElement = this;
    }
  }

  scrollIntoView() {}

  contains(other) {
    let curr = other;
    while (curr) {
      if (curr === this) return true;
      curr = curr.parentNode;
    }
    return false;
  }

  closest(selector) {
    let curr = this;
    while (curr && curr instanceof MockElement) {
      if (matchesSimpleSelector(curr, selector)) return curr;
      curr = curr.parentNode;
    }
    return null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const subSelectors = selector.split(',').map((s) => s.trim()).filter(Boolean);
    const results = [];

    function search(node) {
      for (const c of node.children) {
        if (c instanceof MockElement) {
          if (subSelectors.some((sel) => matchesSimpleSelector(c, sel))) {
            results.push(c);
          }
          search(c);
        }
      }
    }

    search(this);
    return results;
  }
}

function matchesSimpleSelector(elNode, sel) {
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
  if (tag && elNode.tagName !== tag) return false;
  if (notClass && elNode.classList.contains(notClass)) return false;
  if (!working) return true;

  if (working.startsWith('.')) {
    return elNode.classList.contains(working.slice(1));
  }
  if (working.startsWith('#')) {
    return elNode.id === working.slice(1);
  }
  if (working.startsWith('[') && working.endsWith(']')) {
    const inner = working.slice(1, -1);
    if (inner.includes('=')) {
      const [k, v] = inner.split('=');
      const cleanVal = v.replace(/['"]/g, '');
      return elNode.getAttribute(k) === cleanVal;
    }
    return elNode.hasAttribute(inner);
  }
  return false;
}

function installMockDom(initialUrl = 'http://localhost/#/') {
  const docListeners = new Map();
  const winListeners = new Map();

  const mockDocument = {
    activeElement: null,
    documentElement: null,
    body: null,
    createElement(tag) {
      return new MockElement(tag, mockDocument);
    },
    createTextNode(text) {
      return new MockTextNode(text);
    },
    getElementById(id) {
      if (mockDocument.body.id === id) return mockDocument.body;
      return mockDocument.body.querySelector(`#${id}`);
    },
    querySelector(sel) {
      return mockDocument.body.querySelector(sel);
    },
    querySelectorAll(sel) {
      return mockDocument.body.querySelectorAll(sel);
    },
    addEventListener(event, handler) {
      if (!docListeners.has(event)) docListeners.set(event, []);
      docListeners.get(event).push(handler);
    },
    removeEventListener(event, handler) {
      const list = docListeners.get(event) || [];
      const idx = list.indexOf(handler);
      if (idx !== -1) list.splice(idx, 1);
    },
    dispatchEvent(event) {
      const list = [...(docListeners.get(event.type) || [])];
      for (const h of list) h(event);
    },
    getListenerCount(event) {
      return (docListeners.get(event) || []).length;
    }
  };

  mockDocument.documentElement = new MockElement('html', mockDocument);
  mockDocument.body = new MockElement('body', mockDocument);
  mockDocument.documentElement.appendChild(mockDocument.body);

  const parsed = new URL(initialUrl);
  const locationState = {
    pathname: parsed.pathname,
    search: parsed.search,
    _hash: parsed.hash
  };

  const mockWindow = {
    location: {
      get pathname() {
        return locationState.pathname;
      },
      get search() {
        return locationState.search;
      },
      get hash() {
        return locationState._hash;
      },
      set hash(val) {
        const nextHash = val.startsWith('#') ? val : `#${val}`;
        locationState._hash = nextHash;
        const handlers = [...(winListeners.get('hashchange') || [])];
        for (const h of handlers) h({ type: 'hashchange' });
      }
    },
    history: {
      replaceState(_state, _title, urlStr) {
        const nextUrl = new URL(urlStr, 'http://localhost');
        locationState.pathname = nextUrl.pathname;
        locationState.search = nextUrl.search;
        locationState._hash = nextUrl.hash;
      }
    },
    scrollTo() {},
    addEventListener(event, handler) {
      if (!winListeners.has(event)) winListeners.set(event, []);
      winListeners.get(event).push(handler);
    },
    removeEventListener(event, handler) {
      const list = winListeners.get(event) || [];
      const idx = list.indexOf(handler);
      if (idx !== -1) list.splice(idx, 1);
    }
  };

  globalThis.Node = MockNode;
  globalThis.HTMLElement = MockElement;
  globalThis.document = mockDocument;
  globalThis.window = mockWindow;

  return { mockDocument, mockWindow };
}

async function createTestServer(dbPath = ':memory:') {
  const db = createDatabase(dbPath);
  initDatabase(db);
  const app = createApp(db);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    db,
    server,
    baseUrl,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      db.close();
    }
  };
}

// ============================================================================
// 1. Backend Defect Regressions (DEFECT-01, DEFECT-02, DEFECT-07, DEFECT-08, DEFECT-10)
// ============================================================================
test('Backend QA Regressions', async (t) => {
  await t.test('DEFECT-01: month=9999-12 boundary includes payments in December 9999 on both debtor endpoints', async () => {
    const range = getMonthDateRange('9999-12');
    assert.equal(range.startOfMonth, '9999-12-01');
    assert.equal(range.endOfMonth, '9999-12-31');

    const ctx = await createTestServer();
    try {
      const paidStudent = createStudent(ctx.db, { full_name: 'Paid 9999', monthly_fee: 500000 });
      const partialStudent = createStudent(ctx.db, { full_name: 'Partial 9999', monthly_fee: 500000 });
      const freeStudent = createStudent(ctx.db, { full_name: 'Scholarship 9999', monthly_fee: 0 });

      createPayment(ctx.db, { student_id: paidStudent.id, amount: 500000, payment_date: '9999-12-31' });
      createPayment(ctx.db, { student_id: partialStudent.id, amount: 200000, payment_date: '9999-12-01' });

      const [resDirect, resApi] = await Promise.all([
        fetch(`${ctx.baseUrl}/debtors?month=9999-12`),
        fetch(`${ctx.baseUrl}/api/reports/debtors?month=9999-12`)
      ]);

      assert.equal(resDirect.status, 200);
      assert.equal(resApi.status, 200);

      const directBody = await resDirect.json();
      const apiBody = await resApi.json();
      assert.deepEqual(directBody, apiBody, 'Both debtor endpoints must return identical results');
      assert.equal(directBody.length, 1);
      assert.equal(directBody[0].student_id, partialStudent.id);
      assert.equal(directBody[0].total_paid, 200000);
      assert.equal(directBody[0].debt, 300000);
      assert.ok(!directBody.some((d) => d.student_id === freeStudent.id));
    } finally {
      await ctx.close();
    }
  });

  await t.test('DEFECT-02: missing static assets return 404 JSON while nested SPA routes serve root-relative index.html', async () => {
    const ctx = await createTestServer();
    try {
      for (const missingAsset of ['/js/nonexistent.js', '/css/missing.css', '/assets/logo.png']) {
        const res = await fetch(`${ctx.baseUrl}${missingAsset}`);
        assert.equal(res.status, 404, `Expected 404 for missing asset ${missingAsset}`);
        assert.match(res.headers.get('content-type') || '', /application\/json/);
      }

      for (const spaRoute of ['/', '/students', '/students/42', '/groups/7', '/payments']) {
        const res = await fetch(`${ctx.baseUrl}${spaRoute}`);
        assert.equal(res.status, 200, `Expected 200 HTML for SPA route ${spaRoute}`);
        assert.match(res.headers.get('content-type') || '', /text\/html/);
        const html = await res.text();
        assert.ok(html.includes('href="/css/components.css"'), 'Stylesheets must use root-relative paths');
        assert.ok(html.includes('src="/js/app.js"'), 'Entry script must use root-relative path');
        assert.ok(html.includes('rel="icon"'), 'Inline favicon link should be present');
      }
    } finally {
      await ctx.close();
    }
  });

  await t.test('DEFECT-07 (Backend): SQLite signed 64-bit SUM overflow in debtor report returns 400 JSON instead of 500', async () => {
    const ctx = await createTestServer();
    try {
      const s = createStudent(ctx.db, {
        full_name: 'High Volume Account',
        monthly_fee: Number.MAX_SAFE_INTEGER
      });

      // 1,025 payments of MAX_SAFE_INTEGER exceed SQLite INT64_MAX (9,223,372,036,854,775,807)
      const insertStmt = ctx.db.prepare(
        'INSERT INTO payments (student_id, amount, payment_date, created_at) VALUES (?, ?, ?, ?)'
      );
      const seedOverflow = ctx.db.transaction(() => {
        for (let i = 0; i < 1025; i++) {
          insertStmt.run(s.id, Number.MAX_SAFE_INTEGER, '2026-10-15', '2026-10-15T00:00:00.000Z');
        }
      });
      seedOverflow();

      const res = await fetch(`${ctx.baseUrl}/api/reports/debtors?month=2026-10`);
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, 'Bad Request');
    } finally {
      await ctx.close();
    }
  });

  await t.test('DEFECT-08 (Backend): enforces max length bounds on student full_name (200) and group name (150)', async () => {
    const ctx = await createTestServer();
    try {
      const okStudentRes = await fetch(`${ctx.baseUrl}/api/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: 'A'.repeat(200), monthly_fee: 100000 })
      });
      assert.equal(okStudentRes.status, 201);

      const tooLongStudentRes = await fetch(`${ctx.baseUrl}/api/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: 'A'.repeat(201), monthly_fee: 100000 })
      });
      assert.equal(tooLongStudentRes.status, 400);

      const okGroupRes = await fetch(`${ctx.baseUrl}/api/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'G'.repeat(150) })
      });
      assert.equal(okGroupRes.status, 201);

      const tooLongGroupRes = await fetch(`${ctx.baseUrl}/api/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'G'.repeat(151) })
      });
      assert.equal(tooLongGroupRes.status, 400);
    } finally {
      await ctx.close();
    }
  });

  await t.test('DEFECT-10: startServer(0, ":memory:") logs actual assigned port rather than port 0', async () => {
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    let started;
    try {
      started = startServer(0, ':memory:');
      await new Promise((resolve) => {
        started.server.once('listening', resolve);
      });
      const actualPort = started.server.address().port;
      assert.ok(actualPort > 0);
      assert.ok(
        logs.some((line) => line.includes(`port ${actualPort}`)),
        `Expected server startup log to mention port ${actualPort}, got: ${logs.join(' | ')}`
      );
    } finally {
      console.log = origLog;
      if (started) {
        await new Promise((resolve) => started.server.close(resolve));
        started.db.close();
      }
    }
  });
});

// ============================================================================
// 2. Negative, Boundary, Financial Precision & Security Regressions
// ============================================================================
test('Negative, Boundary, Monetary Edge & Security Regressions', async (t) => {
  await t.test('Monetary edge values (0, 1, 999, 1000, 120001, 450000, 450,000, 450 000) parse and persist accurately', async () => {
    const ctx = await createTestServer();
    try {
      const feeInputs = [
        ['0', 0],
        ['1', 1],
        ['999', 999],
        ['1000', 1000],
        ['120001', 120001],
        ['450000', 450000],
        ['450,000', 450000],
        ['450 000', 450000]
      ];

      for (const [raw, expected] of feeInputs) {
        const parsed = parseMonthlyFee(raw);
        assert.equal(parsed.valid, true, `Fee "${raw}" should be valid`);
        assert.strictEqual(parsed.value, expected);

        const res = await fetch(`${ctx.baseUrl}/api/students`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ full_name: `Fee ${raw}`, monthly_fee: parsed.value })
        });
        assert.equal(res.status, 201);
        const created = await res.json();
        assert.strictEqual(created.monthly_fee, expected);
      }

      const payer = createStudent(ctx.db, { full_name: 'Edge Payer', monthly_fee: 1000000 });
      const paymentInputs = [
        ['1', 1],
        ['999', 999],
        ['1000', 1000],
        ['120001', 120001],
        ['450000', 450000],
        ['450,000', 450000],
        ['450 000', 450000]
      ];

      let expectedSum = 0;
      for (const [raw, expected] of paymentInputs) {
        const parsed = parsePaymentAmount(raw);
        assert.equal(parsed.valid, true, `Payment "${raw}" should be valid`);
        assert.strictEqual(parsed.value, expected);
        expectedSum += expected;

        const res = await fetch(`${ctx.baseUrl}/api/payments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            student_id: payer.id,
            amount: parsed.value,
            payment_date: '2026-10-15'
          })
        });
        assert.equal(res.status, 201);
      }

      const historyRes = await fetch(`${ctx.baseUrl}/api/students/${payer.id}/payments`);
      const history = await historyRes.json();
      const actualSum = history.reduce((sum, p) => sum + p.amount, 0);
      assert.strictEqual(actualSum, expectedSum);
    } finally {
      await ctx.close();
    }
  });

  await t.test('SQL injection payloads, malformed JSON, unexpected properties, unsupported methods, and repeated query params are safely handled', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-pay-sec-'));
    const dbPath = path.join(tmpDir, 'sec.db');
    const ctx = await createTestServer(dbPath);

    try {
      const sqliPayloads = [
        "' OR 1=1 --",
        "'; DROP TABLE students; --",
        '" UNION SELECT sql, 1, 2, 3 FROM sqlite_master --'
      ];

      for (const payload of sqliPayloads) {
        const grpRes = await fetch(`${ctx.baseUrl}/api/groups`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: payload })
        });
        assert.equal(grpRes.status, 201);
        const grp = await grpRes.json();
        assert.equal(grp.name, payload.trim());

        const stuRes = await fetch(`${ctx.baseUrl}/api/students`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ full_name: payload, phone: "' OR '1'='1", monthly_fee: 250000, group_id: grp.id })
        });
        assert.equal(stuRes.status, 201);

        const debRes = await fetch(`${ctx.baseUrl}/debtors?month=${encodeURIComponent(payload)}`);
        assert.equal(debRes.status, 400);
      }

      // Malformed JSON -> 400
      const badJson = await fetch(`${ctx.baseUrl}/api/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"full_name": "Broken"'
      });
      assert.equal(badJson.status, 400);

      // Oversized payload > 100kb -> 413
      const hugePayload = await fetch(`${ctx.baseUrl}/api/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: 'X', monthly_fee: 100, extra: 'Z'.repeat(120_000) })
      });
      assert.equal(hugePayload.status, 413);

      // Unknown property rejected by strict schema -> 400
      const extraProp = await fetch(`${ctx.baseUrl}/api/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Strict Group', isAdmin: true })
      });
      assert.equal(extraProp.status, 400);

      // Array/object where scalar expected -> 400
      const wrongTypes = await fetch(`${ctx.baseUrl}/api/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: [1], amount: { val: 100 }, payment_date: ['2026-10-01'] })
      });
      assert.equal(wrongTypes.status, 400);

      // Duplicate query param array -> 400
      const dupMonth = await fetch(`${ctx.baseUrl}/api/reports/debtors?month=2026-10&month=2026-11`);
      assert.equal(dupMonth.status, 400);

      // Unimplemented payment edit/delete & unsupported methods -> 404 JSON
      for (const [method, endpoint] of [
        ['DELETE', '/api/payments/1'],
        ['PATCH', '/api/payments/1'],
        ['PUT', '/api/students/1']
      ]) {
        const res = await fetch(`${ctx.baseUrl}${endpoint}`, { method });
        assert.equal(res.status, 404);
        assert.match(res.headers.get('content-type') || '', /application\/json/);
      }

      // Verify SQLite integrity & foreign keys intact
      assert.equal(ctx.db.pragma('integrity_check', { simple: true }), 'ok');
      assert.equal(ctx.db.pragma('foreign_key_check').length, 0);
    } finally {
      await ctx.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// 3. Frontend Defect Regressions (DEFECT-03, 04, 05, 06, 07, 08, 09 & XSS)
// ============================================================================
test('Frontend DOM, Accessibility, Race Condition & Scale Regressions', async (t) => {
  await t.test('DEFECT-05 & XSS: dom.js maps htmlFor -> for and safely renders HTML/script strings as text nodes', () => {
    installMockDom();
    const label = el('label', { htmlFor: 'payment-amount-input', className: 'form-label' }, 'Summa');
    assert.equal(label.getAttribute('for'), 'payment-amount-input');
    assert.equal(label.getAttribute('htmlFor'), null);

    const xssPayload = '<img src=x onerror=alert(1)><script>window.pwned=1</script>';
    const cell = el('td', {}, xssPayload);
    assert.equal(cell.querySelectorAll('img, script').length, 0);
    assert.equal(cell.textContent, xssPayload);
  });

  await t.test('DEFECT-06: api.js normalizes 400, 404, 409, 413, and 500 responses into Uzbek messages', async () => {
    const origFetch = globalThis.fetch;
    try {
      const cases = [
        {
          status: 404,
          body: { error: 'Not Found', message: 'Student with ID 99999 not found' },
          fn: () => fetchStudent(99999),
          expectedSubstring: 'o\'quvchi topilmadi'
        },
        {
          status: 404,
          body: { error: 'Not Found', message: 'Group with ID 888 not found' },
          fn: () => fetchGroup(888),
          expectedSubstring: 'guruh topilmadi'
        },
        {
          status: 400,
          body: { error: 'Bad Request', message: 'Payment date must be a valid calendar date' },
          fn: () => apiRecordPayment({ student_id: 1, amount: 1000, payment_date: '2026-02-30' }),
          expectedSubstring: 'taqvim sanasi'
        },
        {
          status: 400,
          body: { error: 'Bad Request', message: 'Month must be in YYYY-MM format' },
          fn: () => apiFetchMonthlyDebtors('invalid'),
          expectedSubstring: 'YYYY-MM'
        },
        {
          status: 409,
          body: { error: 'Conflict', message: 'Cannot delete group with assigned students' },
          fn: () => apiDeleteGroup(1),
          expectedSubstring: 'o\'quvchilar mavjud'
        },
        {
          status: 409,
          body: { error: 'Conflict', message: 'Group name already exists' },
          fn: () => apiCreateGroup({ name: 'Dup' }),
          expectedSubstring: 'allaqachon mavjud'
        },
        {
          status: 409,
          body: { error: 'Conflict', message: 'Cannot delete student with payment history' },
          fn: () => apiDeleteStudent(1),
          expectedSubstring: 'to\'lovlar tarixi'
        },
        {
          status: 500,
          body: { error: 'Internal Server Error', message: 'An unexpected error occurred' },
          fn: () => apiCreateStudent({ full_name: 'Test', monthly_fee: 100 }),
          expectedSubstring: 'Serverda texnik xatolik'
        }
      ];

      for (const c of cases) {
        globalThis.fetch = async () => ({
          ok: false,
          status: c.status,
          headers: { get: () => 'application/json' },
          json: async () => c.body
        });

        await assert.rejects(
          () => c.fn(),
          (err) => {
            assert.ok(err instanceof ApiError);
            assert.equal(err.status, c.status);
            assert.ok(
              err.message.includes(c.expectedSubstring),
              `Expected Uzbek message containing "${c.expectedSubstring}", got "${err.message}"`
            );
            assert.ok(!err.message.includes('An unexpected error occurred'));
            assert.ok(!err.message.includes('not found'));
            return true;
          }
        );
      }
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  await t.test('DEFECT-06: isValidCalendarDateString and Record Payment form reject impossible calendar dates client-side', async () => {
    assert.equal(isValidCalendarDateString('2024-02-29'), true);
    assert.equal(isValidCalendarDateString('2023-02-29'), false);
    assert.equal(isValidCalendarDateString('2026-02-30'), false);
    assert.equal(isValidCalendarDateString('2026-04-31'), false);
    assert.equal(isValidCalendarDateString('2026-13-01'), false);

    installMockDom();
    let postCalled = false;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      if (opts && opts.method === 'POST') postCalled = true;
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => [{ id: 1, full_name: 'Aziza', monthly_fee: 450000 }]
      };
    };

    try {
      const container = el('div');
      globalThis.document.body.appendChild(container);
      const cleanup = await renderPayments(container, new URLSearchParams('student_id=1'));

      const amountInput = container.querySelector('#payment-amount-input');
      const dateInput = container.querySelector('#payment-date-input');
      const form = container.querySelector('form');
      const errorBox = container.querySelector('#payment-error-box');

      amountInput.value = '450000';
      dateInput.value = '2026-02-30';
      await form.dispatchEventAsync({ type: 'submit', preventDefault() {} });

      assert.equal(postCalled, false, 'Invalid calendar date must be blocked before POST /api/payments');
      assert.equal(errorBox.style.display, 'block');
      assert.ok(errorBox.textContent.includes('taqvim sanasini'));
      if (typeof cleanup === 'function') cleanup();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  await t.test('DEFECT-07 (Frontend): formatUzbekSom(BigInt) and views accurately sum multi-row totals above Number.MAX_SAFE_INTEGER', async () => {
    const twoMax = BigInt(Number.MAX_SAFE_INTEGER) * 2n;
    const formatted = formatUzbekSom(twoMax);
    assert.notEqual(formatted, '0 so\'m');
    assert.ok(formatted.endsWith(' so\'m'));
    assert.ok(formatted.includes('18'));

    installMockDom();
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const u = String(url);
      let payload = [];
      if (u.includes('/api/reports/debtors')) {
        payload = [
          { student_id: 1, full_name: 'S1', monthly_fee: 6000000000000000, total_paid: 0, debt: 6000000000000000 },
          { student_id: 2, full_name: 'S2', monthly_fee: 6000000000000000, total_paid: 0, debt: 6000000000000000 }
        ];
      } else if (u.endsWith('/payments')) {
        payload = [
          { id: 1, student_id: 1, amount: 6000000000000000, payment_date: '2026-10-01', created_at: '2026-10-01' },
          { id: 2, student_id: 1, amount: 6000000000000000, payment_date: '2026-10-02', created_at: '2026-10-02' }
        ];
      } else if (u.includes('/api/students/1')) {
        payload = { id: 1, full_name: 'S1', monthly_fee: 6000000000000000, group_id: 1, group_name: 'G1', created_at: '2026-10-01' };
      } else if (u.includes('/api/groups/1/students') || u.includes('/api/students')) {
        payload = [
          { id: 1, full_name: 'S1', monthly_fee: 6000000000000000, group_id: 1, group_name: 'G1', created_at: '2026-10-01' },
          { id: 2, full_name: 'S2', monthly_fee: 6000000000000000, group_id: 1, group_name: 'G1', created_at: '2026-10-01' }
        ];
      } else if (u.includes('/api/groups/1')) {
        payload = { id: 1, name: 'G1', student_count: 2, created_at: '2026-10-01' };
      } else if (u.includes('/api/groups')) {
        payload = [{ id: 1, name: 'G1', student_count: 2, created_at: '2026-10-01' }];
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => payload
      };
    };

    try {
      const expectedTwelveQuad = formatUzbekSom(12000000000000000n);

      const dashContainer = el('div');
      await renderDashboard(dashContainer);
      assert.ok(dashContainer.textContent.includes(expectedTwelveQuad), 'Dashboard must format 1.2e16 total debt accurately');

      const debtorsContainer = el('div');
      await renderDebtors(debtorsContainer, new URLSearchParams('month=2026-10'));
      assert.ok(debtorsContainer.textContent.includes(expectedTwelveQuad), 'Debtors report must format 1.2e16 total debt accurately');

      const detailContainer = el('div');
      await renderStudentDetail(detailContainer, '1');
      assert.ok(detailContainer.textContent.includes(expectedTwelveQuad), 'Student detail must format 1.2e16 cumulative paid accurately');

      const groupContainer = el('div');
      await renderGroupDetail(groupContainer, '1');
      assert.ok(groupContainer.textContent.includes(expectedTwelveQuad), 'Group detail must format 1.2e16 group tuition sum accurately');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  await t.test('DEFECT-03 & DEFECT-04: Router isolates rapid async navigations, closes modals, normalizes direct paths, and cleans up combobox listeners', async () => {
    const { mockDocument, mockWindow } = installMockDom('http://localhost/groups');
    const main = el('main', { id: 'main-content' });
    const overlay = el('div', { id: 'modal-overlay', className: 'modal-overlay', 'aria-hidden': 'true' });
    mockDocument.body.appendChild(main);
    mockDocument.body.appendChild(overlay);

    let resolveSlowStudents;
    const slowStudentsPromise = new Promise((res) => {
      resolveSlowStudents = res;
    });

    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/api/students')) {
        const data = await slowStudentsPromise;
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => data
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => [{ id: 1, name: 'IELTS Group', student_count: 0, created_at: '2026-10-01' }]
      };
    };

    try {
      const router = new Router(main);
      router.init();
      // Direct path /groups must be normalized to #/groups
      assert.equal(mockWindow.location.hash, '#/groups');
      await new Promise((r) => setTimeout(r, 10));
      assert.ok(main.textContent.includes('IELTS Group'));

      // Open a modal, then navigate to #/students (slow) and immediately to #/groups (fast)
      openModal({ title: 'Stuck Modal Check', body: el('p', {}, 'Body') });
      assert.equal(overlay.classList.contains('active'), true);
      assert.equal(overlay.getAttribute('aria-hidden'), 'false');

      mockWindow.location.hash = '#/students';
      assert.equal(overlay.classList.contains('active'), false, 'Navigation must automatically close open modal');
      assert.equal(overlay.getAttribute('aria-hidden'), 'true');

      // Immediately switch to #/groups before /api/students resolves
      mockWindow.location.hash = '#/groups';
      await new Promise((r) => setTimeout(r, 10));
      assert.ok(main.textContent.includes('Guruhlar'));

      // Now resolve the stale /api/students request — it MUST NOT overwrite #/groups!
      resolveSlowStudents([{ id: 99, full_name: 'Stale Student Should Not Appear', monthly_fee: 100000 }]);
      await new Promise((r) => setTimeout(r, 10));
      assert.ok(main.textContent.includes('Guruhlar'));
      assert.ok(!main.textContent.includes('Stale Student Should Not Appear'));

      // Visit #/payments and navigate away -> verify 0 leaked document click listeners
      resolveSlowStudents = null;
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => [{ id: 1, full_name: 'Active Student', monthly_fee: 300000 }]
      });

      const baselineListeners = mockDocument.getListenerCount('click');
      mockWindow.location.hash = '#/payments';
      await new Promise((r) => setTimeout(r, 15));
      assert.equal(mockDocument.getListenerCount('click'), baselineListeners + 1);

      mockWindow.location.hash = '#/groups';
      await new Promise((r) => setTimeout(r, 15));
      assert.equal(mockDocument.getListenerCount('click'), baselineListeners, 'Leaving #/payments must clean up studentCombobox listener');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  await t.test('DEFECT-03 (Debtors): rapid month changes ignore out-of-order stale month responses', async () => {
    installMockDom();
    let resolveJan;
    const janPromise = new Promise((res) => {
      resolveJan = res;
    });

    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('month=2026-01')) {
        const data = await janPromise;
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => data
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => (u.includes('month=2026-10')
          ? [{ student_id: 2, full_name: 'October Debtor', monthly_fee: 400000, total_paid: 0, debt: 400000 }]
          : [])
      };
    };

    try {
      const container = el('div');
      await renderDebtors(container, new URLSearchParams('month=2026-09'));

      const monthInput = container.querySelector('#debtor-month-input');
      assert.ok(monthInput);

      // Trigger slow 2026-01 request, then immediately switch to fast 2026-10
      monthInput.value = '2026-01';
      monthInput.dispatchEvent({ type: 'change', target: monthInput });

      monthInput.value = '2026-10';
      monthInput.dispatchEvent({ type: 'change', target: monthInput });
      await new Promise((r) => setTimeout(r, 15));

      assert.ok(container.textContent.includes('October Debtor'));
      assert.ok(container.textContent.includes('2026-yil Oktabr'));

      // Resolve slow January response afterwards — must be discarded
      resolveJan([{ student_id: 1, full_name: 'Stale January Debtor', monthly_fee: 500000, total_paid: 0, debt: 500000 }]);
      await new Promise((r) => setTimeout(r, 15));

      assert.ok(container.textContent.includes('October Debtor'));
      assert.ok(!container.textContent.includes('Stale January Debtor'));
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  await t.test('DEFECT-05 & DEFECT-08 (Frontend): modal focus skips hidden inputs, labels match ids, max lengths enforced, and unassign button blocks double-clicks', async () => {
    const { mockDocument } = installMockDom();
    const overlay = el('div', { id: 'modal-overlay', className: 'modal-overlay', 'aria-hidden': 'true' });
    mockDocument.body.appendChild(overlay);

    // Modal focus skips hidden input
    const hidden = el('input', { type: 'hidden', id: 'h-input' });
    const visible = el('input', { type: 'text', id: 'v-input' });
    openModal({ title: 'Focus Test', body: el('div', {}, hidden, visible) });
    await new Promise((r) => setTimeout(r, 65));
    assert.equal(mockDocument.activeElement, visible);
    closeModal();

    // Group modal label association & >150-char validation
    showAddGroupModal(() => {});
    const grpLabel = overlay.querySelector('label');
    const grpInput = overlay.querySelector('#add-group-name');
    assert.equal(grpLabel.getAttribute('for'), 'add-group-name');
    assert.equal(grpInput.getAttribute('maxlength'), '150');
    grpInput.value = 'G'.repeat(151);
    await overlay.querySelector('form').dispatchEventAsync({ type: 'submit', preventDefault() {} });
    assert.ok(overlay.querySelector('.form-error').textContent.includes('150 ta belgidan'));
    closeModal();

    showEditGroupModal({ id: 5, name: 'Old' }, () => {});
    assert.equal(overlay.querySelector('label').getAttribute('for'), 'edit-group-name-5');
    closeModal();

    // Student modal >200-char validation & Guruh label association
    showAddStudentModal([{ id: 1, name: 'G1', student_count: 0 }], () => {});
    const stuNameInput = overlay.querySelector('#add-student-name');
    assert.equal(stuNameInput.getAttribute('maxlength'), '200');
    const labels = overlay.querySelectorAll('label');
    assert.equal(labels[3].getAttribute('for'), 'add-student-group-combobox-input');
    stuNameInput.value = 'S'.repeat(201);
    overlay.querySelector('#add-student-fee').value = '100000';
    await overlay.querySelector('form').dispatchEventAsync({ type: 'submit', preventDefault() {} });
    assert.ok(overlay.querySelector('.form-error').textContent.includes('200 ta belgidan'));
    closeModal();

    showEditStudentModal(
      { id: 9, full_name: 'Ali', phone: null, monthly_fee: 100000, group_id: 1 },
      [{ id: 1, name: 'G1', student_count: 1 }],
      () => {}
    );
    assert.equal(overlay.querySelectorAll('label')[3].getAttribute('for'), 'edit-student-group-combobox-9-input');
    closeModal();

    // GroupDetail unassign confirm button disables immediately on click
    let patchCalls = 0;
    let resolvePatch;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      if (opts && opts.method === 'PATCH') {
        patchCalls += 1;
        await new Promise((r) => {
          resolvePatch = r;
        });
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({ id: 1, full_name: 'Member', group_id: null })
        };
      }
      const u = String(url);
      if (u.endsWith('/students')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => [{ id: 1, full_name: 'Member', phone: null, monthly_fee: 300000, group_id: 1, created_at: '2026-10-01' }]
        };
      }
      if (u.endsWith('/api/groups')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => [{ id: 1, name: 'Alpha', student_count: 1, created_at: '2026-10-01' }]
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ id: 1, name: 'Alpha', student_count: 1, created_at: '2026-10-01' })
      };
    };

    try {
      const gdContainer = el('div');
      await renderGroupDetail(gdContainer, '1');
      const unassignTrigger = gdContainer.querySelectorAll('button').find((b) => b.textContent === 'Guruhdan chiqarish');
      unassignTrigger.dispatchEvent({ type: 'click' });

      const confirmBtn = overlay.querySelectorAll('button').find((b) => b.textContent === 'Guruhdan chiqarish');
      assert.equal(confirmBtn.disabled, false);

      const firstClick = confirmBtn.dispatchEventAsync({ type: 'click' });
      assert.equal(confirmBtn.disabled, true, 'Confirm unassign button must disable while PATCH is in flight');
      assert.equal(patchCalls, 1);

      resolvePatch();
      await firstClick;
    } finally {
      globalThis.fetch = origFetch;
      clearElement(mockDocument.body);
    }
  });

  await t.test('DEFECT-09: comboboxes cap rendered options at 100 and Students/Debtors tables paginate above 100 rows', async () => {
    const { mockDocument } = installMockDom();

    // 1. Student & Group comboboxes cap DOM nodes at 100 for 250 items
    const manyStudents = Array.from({ length: 250 }, (_, i) => ({
      id: i + 1,
      full_name: `Student ${i + 1}`,
      monthly_fee: 300000
    }));
    const sCombo = createStudentCombobox({ students: manyStudents });
    const sInput = sCombo.element.querySelector('#student-combobox-input');
    sInput.dispatchEvent({ type: 'focus' });
    assert.equal(sCombo.element.querySelectorAll('.combobox-option').length, 100);
    assert.ok(sCombo.element.querySelector('.combobox-more-hint'));
    sCombo.destroy();

    const manyGroups = Array.from({ length: 250 }, (_, i) => ({
      id: i + 1,
      name: `Group ${i + 1}`,
      student_count: 5
    }));
    const gCombo = createGroupCombobox({ groups: manyGroups });
    const gInput = gCombo.element.querySelector('#group-combobox-input');
    gInput.dispatchEvent({ type: 'focus' });
    assert.equal(gCombo.element.querySelectorAll('.combobox-option').length, 100);
    assert.ok(gCombo.element.querySelector('.combobox-more-hint'));
    // Detached combobox auto-removes listener on document click
    mockDocument.dispatchEvent({ type: 'click', target: mockDocument.body });

    // 2. Students & Debtors pagination at 100 rows/page
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/api/reports/debtors')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => Array.from({ length: 230 }, (_, i) => ({
            student_id: i + 1,
            full_name: `Debtor ${i + 1}`,
            monthly_fee: 400000,
            total_paid: 0,
            debt: 400000
          }))
        };
      }
      if (u.includes('/api/students')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => manyStudents
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => []
      };
    };

    try {
      const stuContainer = el('div');
      await renderStudents(stuContainer);
      assert.equal(stuContainer.querySelector('tbody').querySelectorAll('tr').length, 100);
      assert.ok(stuContainer.querySelector('.pagination-info').textContent.includes('Sahifa 1 / 3'));

      const nextBtns = stuContainer.querySelectorAll('button').filter((b) => b.textContent.includes('Keyingi'));
      nextBtns[0].dispatchEvent({ type: 'click' });
      assert.ok(stuContainer.querySelector('.pagination-info').textContent.includes('Sahifa 2 / 3'));

      const debContainer = el('div');
      await renderDebtors(debContainer, new URLSearchParams('month=2026-10'));
      assert.equal(debContainer.querySelector('tbody').querySelectorAll('tr').length, 100);
      assert.ok(debContainer.querySelector('.pagination-info').textContent.includes('Sahifa 1 / 3'));
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  await t.test('Pagination preserves active search filter & clamps empty final pages on CRUD, and capped comboboxes support keyboard/search selection', async () => {
    const { mockDocument, overlay } = installMockDom();

    // 1. Capped combobox keyboard navigation: ArrowUp from -1, Escape -> ArrowDown -> Enter, and search >100th item
    const groups250 = Array.from({ length: 250 }, (_, i) => ({
      id: i + 1,
      name: `Group ${String(i + 1).padStart(3, '0')}`,
      student_count: i % 5
    }));
    const gCombo = createGroupCombobox({ groups: groups250 });
    const gInput = gCombo.element.querySelector('#group-combobox-input');
    gInput.dispatchEvent({ type: 'focus' });
    // ArrowUp from initial -1 highlights index 99 (the 100th visible option: Group 099, since index 0 is Guruhsiz)
    gInput.dispatchEvent({ type: 'keydown', key: 'ArrowUp', preventDefault() {} });
    const gOptions = gCombo.element.querySelectorAll('.combobox-option');
    assert.equal(gOptions.length, 100);
    assert.equal(gOptions[99].classList.contains('highlighted'), true);

    // Escape closes, ArrowDown reopens AND immediately highlights index 0 ("Guruhsiz"), Enter selects it
    gInput.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
    gInput.dispatchEvent({ type: 'keydown', key: 'ArrowDown', preventDefault() {} });
    gInput.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault() {} });
    assert.equal(gCombo.getSelectedGroupId(), null);

    // Search for Group 245 (beyond the initial 100 cap) and select via Enter
    gCombo.clearSelection();
    gInput.value = 'Group 245';
    gInput.dispatchEvent({ type: 'input', target: gInput });
    gInput.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault() {} });
    assert.equal(gCombo.getSelectedGroupId(), 245);
    gCombo.destroy();

    // Also verify StudentCombobox Escape -> ArrowDown -> Enter & >100th item search
    const students250 = Array.from({ length: 250 }, (_, i) => ({
      id: i + 1,
      full_name: `Student ${String(i + 1).padStart(3, '0')}`,
      monthly_fee: 450000
    }));
    const sCombo = createStudentCombobox({ students: students250 });
    const sInput = sCombo.element.querySelector('#student-combobox-input');
    sInput.dispatchEvent({ type: 'keydown', key: 'ArrowDown', preventDefault() {} });
    sInput.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault() {} });
    assert.equal(sCombo.getSelectedStudentId(), 1);
    sCombo.clearSelection();
    sInput.value = 'Student 248';
    sInput.dispatchEvent({ type: 'input', target: sInput });
    sInput.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault() {} });
    assert.equal(sCombo.getSelectedStudentId(), 248);
    sCombo.destroy();

    // 2. Students table: 201 rows (3 pages) -> delete 201st student on Page 3 -> clamps cleanly to Page 2 (no empty final page)
    let liveStudents = Array.from({ length: 201 }, (_, i) => ({
      id: i + 1,
      full_name: i === 5 ? 'Target Olimov' : `Learner ${String(i + 1).padStart(3, '0')}`,
      phone: null,
      monthly_fee: 300000,
      group_id: null,
      group_name: null,
      created_at: '2026-10-01'
    }));

    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
      const u = String(url);
      const method = (options.method || 'GET').toUpperCase();
      if (u.endsWith('/api/students') && method === 'GET') {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => liveStudents.map((s) => ({ ...s }))
        };
      }
      if (u.includes('/api/students/') && method === 'DELETE') {
        const delId = Number(u.split('/').pop());
        liveStudents = liveStudents.filter((s) => s.id !== delId);
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({ message: 'Deleted' })
        };
      }
      if (u.includes('/api/students/') && method === 'PATCH') {
        const editId = Number(u.split('/').pop());
        const body = JSON.parse(options.body);
        liveStudents = liveStudents.map((s) => (s.id === editId ? { ...s, ...body } : s));
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => liveStudents.find((s) => s.id === editId)
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => []
      };
    };

    try {
      const stuContainer = el('div');
      await renderStudents(stuContainer);
      assert.ok(stuContainer.querySelector('.pagination-info').textContent.includes('Sahifa 1 / 3'));

      // Navigate to Page 3 (has 1 row: Learner 201)
      let nextBtn = stuContainer.querySelectorAll('button').find((b) => b.textContent.includes('Keyingi'));
      nextBtn.dispatchEvent({ type: 'click' });
      nextBtn = stuContainer.querySelectorAll('button').find((b) => b.textContent.includes('Keyingi'));
      nextBtn.dispatchEvent({ type: 'click' });
      assert.ok(stuContainer.querySelector('.pagination-info').textContent.includes('Sahifa 3 / 3'));
      assert.equal(stuContainer.querySelector('tbody').querySelectorAll('tr').length, 1);

      // Delete Learner 201 on Page 3 -> refreshes and clamps to Page 2 / 2 with 100 rows (never empty Page 3)
      const delTrigger = stuContainer.querySelector('tbody').querySelectorAll('button').find((b) => b.textContent === 'O\'chirish');
      delTrigger.dispatchEvent({ type: 'click' });
      const overlay = mockDocument.getElementById('modal-overlay');
      const confirmDelBtn = overlay.querySelectorAll('button').find((b) => b.textContent === 'O\'chirish');
      await confirmDelBtn.dispatchEventAsync({ type: 'click' });
      await new Promise((r) => setTimeout(r, 20));

      assert.ok(stuContainer.querySelector('.pagination-info').textContent.includes('Sahifa 2 / 2'));
      assert.equal(stuContainer.querySelector('tbody').querySelectorAll('tr').length, 100);

      // Filter by "Target", edit student fee -> filter "Target" is preserved and updated fee renders without stale results
      const searchInp = stuContainer.querySelector('.search-input');
      searchInp.value = 'Target';
      searchInp.dispatchEvent({ type: 'input', target: searchInp });
      assert.equal(stuContainer.querySelector('tbody').querySelectorAll('tr').length, 1);

      const editBtn = stuContainer.querySelector('tbody').querySelectorAll('button').find((b) => b.textContent === 'Tahrirlash');
      editBtn.dispatchEvent({ type: 'click' });
      const feeInp = overlay.querySelector('#edit-student-fee-6');
      feeInp.value = '550000';
      const editForm = overlay.querySelector('form');
      await editForm.dispatchEventAsync({ type: 'submit', preventDefault() {} });
      await new Promise((r) => setTimeout(r, 20));

      assert.equal(stuContainer.querySelector('.search-input').value, 'Target');
      assert.equal(stuContainer.querySelector('tbody').querySelectorAll('tr').length, 1);
      assert.ok(stuContainer.querySelector('tbody').textContent.includes('550'));
    } finally {
      globalThis.fetch = origFetch;
      clearElement(mockDocument.body);
    }
  });
});

test('Final Verification: Debtor Endpoint Parity & Multi-Connection Statement Cache Isolation', async (t) => {
  await t.test('GET /debtors and GET /api/reports/debtors return identical results matching independent math for zero-fee, unpaid, partial, exact, and overpaid students', async () => {
    const ctx = await createTestServer(':memory:');
    try {
      const zeroFeeUnpaid = createStudent(ctx.db, { full_name: 'Zero Fee Unpaid', monthly_fee: 0 });
      const zeroFeePaid = createStudent(ctx.db, { full_name: 'Zero Fee Paid', monthly_fee: 0 });
      const unpaid = createStudent(ctx.db, { full_name: 'Unpaid Student', monthly_fee: 450000 });
      const partial = createStudent(ctx.db, { full_name: 'Partial Student', monthly_fee: 450000 });
      const exactPaid = createStudent(ctx.db, { full_name: 'Exact Student', monthly_fee: 450000 });
      const overpaid = createStudent(ctx.db, { full_name: 'Overpaid Student', monthly_fee: 450000 });

      // Record October 2026 payments + boundary payments in September and November
      createPayment(ctx.db, { student_id: zeroFeePaid.id, amount: 50000, payment_date: '2026-10-10' });
      createPayment(ctx.db, { student_id: unpaid.id, amount: 450000, payment_date: '2026-09-30' }); // prior month
      createPayment(ctx.db, { student_id: unpaid.id, amount: 450000, payment_date: '2026-11-01' }); // next month
      createPayment(ctx.db, { student_id: partial.id, amount: 120001, payment_date: '2026-10-01' });
      createPayment(ctx.db, { student_id: partial.id, amount: 79999, payment_date: '2026-10-31' }); // sum = 200,000 -> debt = 250,000
      createPayment(ctx.db, { student_id: exactPaid.id, amount: 450000, payment_date: '2026-10-15' });
      createPayment(ctx.db, { student_id: overpaid.id, amount: 600000, payment_date: '2026-10-20' }); // overpaid in Oct, unpaid in Dec

      for (const month of ['2026-09', '2026-10', '2026-11', '2026-12']) {
        const [r1, r2] = await Promise.all([
          fetch(`${ctx.baseUrl}/debtors?month=${month}`),
          fetch(`${ctx.baseUrl}/api/reports/debtors?month=${month}`)
        ]);
        assert.equal(r1.status, 200);
        assert.equal(r2.status, 200);
        const d1 = await r1.json();
        const d2 = await r2.json();
        assert.deepStrictEqual(d1, d2, `Endpoints must match identically for ${month}`);

        if (month === '2026-10') {
          // Only unpaid (debt 450,000) and partial (paid 200,000, debt 250,000) should appear; zeroFeeUnpaid/zeroFeePaid/exactPaid/overpaid excluded
          assert.deepStrictEqual(
            d1.map((r) => ({ student_id: r.student_id, monthly_fee: r.monthly_fee, total_paid: r.total_paid, debt: r.debt })),
            [
              { student_id: unpaid.id, monthly_fee: 450000, total_paid: 0, debt: 450000 },
              { student_id: partial.id, monthly_fee: 450000, total_paid: 200000, debt: 250000 }
            ]
          );
        }

        if (month === '2026-12') {
          // Overpayment in Oct must NOT carry over to Dec; zero-fee students still excluded
          assert.equal(d1.length, 4);
          assert.equal(d1.some((r) => r.student_id === zeroFeeUnpaid.id || r.student_id === zeroFeePaid.id), false);
          assert.equal(d1.find((r) => r.student_id === overpaid.id).debt, 450000);
        }
      }
    } finally {
      await ctx.close();
    }
  });

  await t.test('WeakMap statement caching and SQLite transactions are strictly scoped per database connection without stale reads', () => {
    const dbA = initDatabase(createDatabase(':memory:'));
    const dbB = initDatabase(createDatabase(':memory:'));

    try {
      const gA = createGroup(dbA, { name: 'Alpha Only' });
      const gB = createGroup(dbB, { name: 'Beta Only' });

      const sA = createStudent(dbA, { full_name: 'Alice A', monthly_fee: 400000, group_id: gA.id });
      const sB = createStudent(dbB, { full_name: 'Bob B', monthly_fee: 700000, group_id: gB.id });

      createPayment(dbA, { student_id: sA.id, amount: 150000, payment_date: '2026-10-10' });
      createPayment(dbB, { student_id: sB.id, amount: 700000, payment_date: '2026-10-10' });

      // Interleaved reads & transactional updates must never cross-contaminate or return stale rows
      assert.equal(listGroups(dbA)[0].name, 'Alpha Only');
      assert.equal(listGroups(dbB)[0].name, 'Beta Only');

      updateGroup(dbA, gA.id, { name: 'Alpha Renamed' });
      updateStudent(dbA, sA.id, { monthly_fee: 500000, group_id: null });

      assert.equal(listStudents(dbA)[0].monthly_fee, 500000);
      assert.equal(listStudents(dbA)[0].group_id, null);
      assert.equal(listStudents(dbB)[0].monthly_fee, 700000);
      assert.equal(listStudents(dbB)[0].group_name, 'Beta Only');

      const debtorsA = getMonthlyDebtors(dbA, '2026-10');
      const debtorsB = getMonthlyDebtors(dbB, '2026-10');
      assert.equal(debtorsA.length, 1);
      assert.equal(debtorsA[0].debt, 350000); // 500,000 updated fee - 150,000 paid = 350,000 (not stale 250,000)
      assert.equal(debtorsB.length, 0);

      // Empty group gA can now be transactionally deleted in dbA while gB with Bob B cannot be deleted in dbB
      assert.equal(deleteGroup(dbA, gA.id).deleted, true);
      assert.equal(deleteGroup(dbB, gB.id).hasStudents, true);
      assert.equal(getPaymentsByStudent(dbA, sA.id).length, 1);
      assert.throws(() => deleteStudent(dbA, sA.id), /CONSTRAINT/i);
    } finally {
      dbA.close();
      dbB.close();
    }
  });
});

// ============================================================================
// 4. Layout Architecture, Persistent Page Shells & Scrolling UX Regressions
// ============================================================================
test('Layout Architecture, Persistent Page Shells & Scrolling UX Regressions', async (t) => {
  await t.test('createPageShell (default scroll variant) builds persistent top and scrollable body with is-scrolled class toggling', () => {
    installMockDom();
    const header = el('div', { className: 'page-header' }, el('h1', { className: 'page-title' }, 'Test Title'));
    const toolbar = el('div', { className: 'section-toolbar' }, el('input', { type: 'search' }));
    const body = el('div', { className: 'card' }, 'Content');

    const shell = createPageShell({ header, toolbar, body });
    assert.ok(shell.element.classList.contains('page-shell'));
    assert.ok(!shell.element.classList.contains('is-scrolled'));
    assert.ok(shell.topEl.classList.contains('page-shell-top'));
    assert.ok(shell.bodyEl.classList.contains('page-shell-body'));

    // Top shell contains header and toolbar inside .page-shell-container
    assert.equal(shell.topEl.querySelector('.page-header'), header);
    assert.equal(shell.topEl.querySelector('.section-toolbar'), toolbar);

    // Body shell contains body content inside .page-shell-container
    assert.equal(shell.bodyEl.querySelector('.card'), body);

    // Scrolling bodyEl triggers is-scrolled class
    shell.bodyEl.scrollTop = 10;
    shell.bodyEl.dispatchEvent({ type: 'scroll', currentTarget: shell.bodyEl });
    assert.ok(shell.element.classList.contains('is-scrolled'));

    // Scrolling back to top removes is-scrolled
    shell.bodyEl.scrollTop = 0;
    shell.bodyEl.dispatchEvent({ type: 'scroll', currentTarget: shell.bodyEl });
    assert.ok(!shell.element.classList.contains('is-scrolled'));

    // resetScroll() resets scrollTop and clears is-scrolled
    shell.bodyEl.scrollTop = 250;
    shell.bodyEl.dispatchEvent({ type: 'scroll', currentTarget: shell.bodyEl });
    assert.ok(shell.element.classList.contains('is-scrolled'));
    shell.resetScroll();
    assert.equal(shell.bodyEl.scrollTop, 0);
    assert.ok(!shell.element.classList.contains('is-scrolled'));
  });

  await t.test('createPageShell (table variant) supports dedicated scroll target binding and reset', () => {
    installMockDom();
    const header = el('div', { className: 'page-header' });
    const tablePanel = el('div', { className: 'table-panel' });

    const shell = createPageShell({ header, body: tablePanel, variant: 'table' });
    assert.ok(shell.element.classList.contains('page-shell--table'));
    assert.ok(shell.bodyEl.classList.contains('page-shell-body--table'));

    const tableScroll = el('div', { className: 'table-scroll' });
    shell.bindScrollTarget(tableScroll);

    tableScroll.scrollTop = 50;
    tableScroll.dispatchEvent({ type: 'scroll', currentTarget: tableScroll });
    assert.ok(shell.element.classList.contains('is-scrolled'));

    shell.resetScroll();
    assert.equal(tableScroll.scrollTop, 0);
    assert.ok(!shell.element.classList.contains('is-scrolled'));

    // Unbinding scroll target safely cleans up listeners
    shell.bindScrollTarget(null);
    assert.ok(!shell.element.classList.contains('is-scrolled'));
  });

  await t.test('createSectionToolbar renders grouped primary controls and metadata', () => {
    installMockDom();
    const search = el('input', { type: 'search' });
    const countBadge = el('span', { id: 'count' }, '10 nafar');

    const toolbar = createSectionToolbar(search, countBadge);
    assert.ok(toolbar.classList.contains('section-toolbar'));
    assert.ok(toolbar.querySelector('.section-toolbar-group'));
    assert.ok(toolbar.querySelector('.section-toolbar-meta'));
    assert.equal(toolbar.querySelector('.section-toolbar-meta').textContent, '10 nafar');
  });

  await t.test('renderStateView wraps state nodes in centered page-state-container', () => {
    installMockDom();
    const container = el('div');
    const loading = el('div', { className: 'loading-indicator' }, 'Yuklanmoqda...');

    renderStateView(container, loading);
    assert.ok(container.querySelector('.page-state-container'));
    assert.ok(container.querySelector('.loading-indicator'));
  });

  await t.test('All views render with persistent page-shell and section identity', async () => {
    const mockDom = installMockDom();
    const origFetch = globalThis.fetch;
    const jsonRes = (val) => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => val
    });

    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/api/students/1/payments')) return jsonRes([]);
      if (u.includes('/api/students/1')) return jsonRes({ id: 1, full_name: 'Test Student', monthly_fee: 100000 });
      if (u.includes('/api/groups/1/students')) return jsonRes([]);
      if (u.includes('/api/groups/1')) return jsonRes({ id: 1, name: 'Test Group', created_at: '2026-01-01' });
      if (u.includes('/api/reports/debtors') || u.includes('/debtors')) return jsonRes([]);
      if (u.includes('/api/students')) return jsonRes([]);
      if (u.includes('/api/groups')) return jsonRes([]);
      return jsonRes([]);
    };

    try {
      const views = [
        { name: 'Dashboard', render: (c) => renderDashboard(c), expectedTitle: 'Bosh sahifa' },
        { name: 'Students', render: (c) => renderStudents(c), expectedTitle: 'O\'quvchilar' },
        { name: 'Groups', render: (c) => renderGroups(c), expectedTitle: 'Guruhlar' },
        { name: 'Group Detail', render: (c) => renderGroupDetail(c, 1), expectedTitle: 'Test Group' },
        { name: 'Student Detail', render: (c) => renderStudentDetail(c, 1), expectedTitle: 'Test Student' },
        { name: 'Payments', render: (c) => renderPayments(c), expectedTitle: 'To\'lov qabul qilish' },
        { name: 'Debtors', render: (c) => renderDebtors(c), expectedTitle: 'Qarzdorlar hisoboti' }
      ];

      for (const v of views) {
        const container = el('div');
        await v.render(container);
        const shell = container.querySelector('.page-shell');
        assert.ok(shell, `${v.name} must render a .page-shell`);
        const top = shell.querySelector('.page-shell-top');
        assert.ok(top, `${v.name} must have a persistent .page-shell-top`);
        const title = top.querySelector('.page-title');
        assert.ok(title, `${v.name} must have .page-title in persistent header`);
        assert.equal(title.textContent, v.expectedTitle, `${v.name} title mismatch`);
        assert.ok(shell.querySelector('.page-shell-body'), `${v.name} must have .page-shell-body`);
      }
    } finally {
      globalThis.fetch = origFetch;
      clearElement(mockDom.body);
    }
  });
});

