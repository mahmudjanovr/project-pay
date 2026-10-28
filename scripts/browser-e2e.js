#!/usr/bin/env node
/**
 * Real-Browser End-to-End Test Suite for Ecomdev.
 * Drives headless Mozilla Firefox over W3C WebDriver BiDi using native Node.js WebSocket.
 *
 * Safety guarantees:
 * - Uses isolated temporary SQLite databases in os.tmpdir().
 * - Never touches or opens project_pay.db.
 * - Cleans up all temporary profiles and databases on exit.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

import { startServer } from '../src/server.js';

export function getFirefoxBinary() {
  if (process.env.FIREFOX_BIN && fs.existsSync(process.env.FIREFOX_BIN)) {
    return process.env.FIREFOX_BIN;
  }
  const candidates = [
    'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
    'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Mozilla Firefox', 'firefox.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Firefox Developer Edition', 'firefox.exe'),
    '/usr/bin/firefox',
    '/usr/local/bin/firefox'
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'firefox';
}

export class FirefoxBiDi {
  constructor() {
    this.proc = null;
    this.profileDir = null;
    this.ws = null;
    this.msgId = 0;
    this.pending = new Map();
    this.consoleErrors = [];
    this.networkFailures = [];
    this.contextId = null;
  }

  async launch() {
    this.profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-pay-ff-'));
    fs.writeFileSync(
      path.join(this.profileDir, 'user.js'),
      [
        'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
        'user_pref("toolkit.telemetry.enabled", false);',
        'user_pref("browser.shell.checkDefaultBrowser", false);',
        'user_pref("browser.startup.homepage_override.mstone", "ignore");'
      ].join('\n')
    );

    const ffBinary = getFirefoxBinary();
    this.proc = spawn(
      ffBinary,
      ['--headless', '--profile', this.profileDir, '--remote-debugging-port', '0'],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );

    const wsBaseUrl = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(
        () => reject(new Error(`Firefox BiDi startup timeout:\n${output}`)),
        15000
      );
      const onData = (chunk) => {
        output += chunk.toString();
        const match = output.match(/WebDriver BiDi listening on (ws:\/\/[^\s]+)/);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      };
      this.proc.stdout.on('data', onData);
      this.proc.stderr.on('data', onData);
      this.proc.on('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`Firefox exited early (${code}): ${output}`));
      });
    });

    this.ws = new WebSocket(`${wsBaseUrl}/session`);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });

    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data));
      if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.type === 'error') {
          reject(new Error(`BiDi error [${msg.error}]: ${msg.message}`));
        } else {
          resolve(msg.result);
        }
      } else if (msg.type === 'event') {
        if (msg.method === 'log.entryAdded' && msg.params.level === 'error') {
          this.consoleErrors.push(msg.params);
        } else if (msg.method === 'network.responseCompleted') {
          const { request, response } = msg.params;
          if (
            response.status >= 400 &&
            !request.url.includes('/api/') &&
            !request.url.includes('/debtors')
          ) {
            this.networkFailures.push({ url: request.url, status: response.status });
          }
        } else if (msg.method === 'network.fetchError') {
          this.networkFailures.push({
            url: msg.params.request.url,
            error: msg.params.errorText
          });
        }
      }
    });

    await this.send('session.new', { capabilities: {} });
    const created = await this.send('browsingContext.create', { type: 'tab' });
    this.contextId = created.context;
    await this.send('session.subscribe', {
      events: ['log.entryAdded', 'network.responseCompleted', 'network.fetchError'],
      contexts: [this.contextId]
    });
  }

  send(method, params = {}) {
    const id = ++this.msgId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async setViewport(width, height) {
    await this.send('browsingContext.setViewport', {
      context: this.contextId,
      viewport: { width, height }
    });
  }

  async navigate(url) {
    await this.send('browsingContext.navigate', {
      context: this.contextId,
      url,
      wait: 'complete'
    });
  }

  async reload() {
    await this.send('browsingContext.reload', {
      context: this.contextId,
      wait: 'complete'
    });
  }

  deserialize(remoteVal) {
    if (!remoteVal) return undefined;
    switch (remoteVal.type) {
      case 'undefined':
        return undefined;
      case 'null':
        return null;
      case 'string':
      case 'number':
      case 'boolean':
        return remoteVal.value;
      case 'array':
        return (remoteVal.value || []).map((v) => this.deserialize(v));
      case 'object': {
        const obj = {};
        for (const [k, v] of remoteVal.value || []) {
          const key = typeof k === 'string' ? k : this.deserialize(k);
          obj[key] = this.deserialize(v);
        }
        return obj;
      }
      default:
        return remoteVal.value;
    }
  }

  async eval(expression) {
    const res = await this.send('script.evaluate', {
      expression,
      target: { context: this.contextId },
      awaitPromise: true,
      resultOwnership: 'none'
    });
    if (res.type === 'exception') {
      throw new Error(
        `Browser eval exception: ${res.exceptionDetails?.text || JSON.stringify(res)}`
      );
    }
    return this.deserialize(res.result);
  }

  async waitFor(predicateExpr, timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const val = await this.eval(predicateExpr);
      if (val) return val;
      await new Promise((r) => setTimeout(r, 40));
    }
    throw new Error(`waitFor timed out: ${predicateExpr}`);
  }

  async waitForModalOpen() {
    try {
      await this.waitFor(
        `(() => {
          const ov = document.getElementById('modal-overlay');
          return Boolean(ov && ov.classList.contains('active') && getComputedStyle(ov).opacity === '1');
        })()`,
        5000
      );
    } catch (err) {
      const diag = await this.eval(`(() => {
        const ov = document.getElementById('modal-overlay');
        return {
          ovExists: Boolean(ov),
          classList: ov ? Array.from(ov.classList) : [],
          opacity: ov ? getComputedStyle(ov).opacity : null,
          visibility: ov ? getComputedStyle(ov).visibility : null,
          title: ov?.querySelector('.modal-title')?.textContent || null,
          pageTitle: document.querySelector('.page-title')?.textContent || null,
          btnPrimary: document.querySelector('.page-actions .btn-primary')?.outerHTML || null,
          url: window.location.href
        };
      })()`);
      throw new Error(`${err.message} | openDiag=${JSON.stringify(diag)} | consoleErrors=${JSON.stringify(this.consoleErrors)}`);
    }
  }

  async waitForModalClosed() {
    try {
      await this.waitFor(
        `(() => {
          const ov = document.getElementById('modal-overlay');
          return !ov || (!ov.classList.contains('active') && getComputedStyle(ov).visibility === 'hidden');
        })()`,
        5000
      );
    } catch (err) {
      const diag = await this.eval(`(() => {
        const ov = document.getElementById('modal-overlay');
        return {
          active: ov?.classList.contains('active'),
          visibility: ov ? getComputedStyle(ov).visibility : null,
          errorText: ov?.querySelector('.form-error')?.textContent || null,
          title: ov?.querySelector('.modal-title')?.textContent || null
        };
      })()`);
      throw new Error(`${err.message} | modalDiag=${JSON.stringify(diag)}`);
    }
  }

  async clickSelector(selector) {
    const rect = await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), width: r.width, height: r.height };
    })()`);
    if (!rect || rect.width === 0 || rect.height === 0) {
      throw new Error(`Element not clickable: ${selector} (${JSON.stringify(rect)})`);
    }
    await this.send('input.performActions', {
      context: this.contextId,
      actions: [
        {
          type: 'pointer',
          id: 'mouse',
          parameters: { pointerType: 'mouse' },
          actions: [
            { type: 'pointerMove', duration: 0, x: rect.x, y: rect.y },
            { type: 'pointerDown', button: 0 },
            { type: 'pointerUp', button: 0 }
          ]
        }
      ]
    });
  }

  async pressKey(key) {
    const keyMap = {
      Enter: '\uE007',
      Escape: '\uE00C',
      Tab: '\uE004',
      ArrowDown: '\uE015',
      ArrowUp: '\uE013',
      Backspace: '\uE003'
    };
    const code = keyMap[key] || key;
    await this.send('input.performActions', {
      context: this.contextId,
      actions: [
        {
          type: 'key',
          id: 'keyboard',
          actions: [
            { type: 'keyDown', value: code },
            { type: 'keyUp', value: code }
          ]
        }
      ]
    });
  }

  async fillInput(selector, value) {
    await this.eval(`(() => {
      const inp = document.querySelector(${JSON.stringify(selector)});
      if (!inp) throw new Error('Input not found: ' + ${JSON.stringify(selector)});
      inp.focus();
      inp.value = ${JSON.stringify(value)};
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
  }

  async close() {
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
      }
    } catch {}
    if (this.proc && !this.proc.killed) {
      this.proc.kill('SIGTERM');
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          try {
            this.proc.kill('SIGKILL');
          } catch {}
          resolve();
        }, 3000);
        this.proc.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    if (this.profileDir) {
      fs.rmSync(this.profileDir, { recursive: true, force: true });
    }
  }
}

async function startIsolatedServer(dbPath) {
  const origLog = console.log;
  console.log = () => {};
  try {
    const started = startServer(0, dbPath);
    await new Promise((resolve) => {
      started.server.once('listening', resolve);
    });
    return {
      ...started,
      baseUrl: `http://127.0.0.1:${started.server.address().port}`
    };
  } finally {
    console.log = origLog;
  }
}

async function runE2E() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-pay-e2e-'));
  const emptyDbPath = path.join(tmpDir, 'empty_e2e.db');
  const mainDbPath = path.join(tmpDir, 'main_e2e.db');

  let emptyCtx = null;
  let mainCtx = null;
  const ff = new FirefoxBiDi();
  const completedWorkflows = [];

  try {
    await ff.launch();
    await ff.setViewport(1280, 800);

    // ========================================================================
    // Workflow 7: Empty-state workflows against an isolated empty SQLite DB
    // ========================================================================
    emptyCtx = await startIsolatedServer(emptyDbPath);
    await ff.navigate(`${emptyCtx.baseUrl}/#/`);
    await ff.waitFor(`document.querySelectorAll('.stat-value').length === 3`);
    const emptyStats = await ff.eval(
      `Array.from(document.querySelectorAll('.stat-value')).map((n) => n.textContent.trim())`
    );
    assert.deepEqual(emptyStats, ['0', '0 nafar', '0 so\'m']);
    assert.equal(
      await ff.eval(`document.querySelector('.empty-state-title')?.textContent.includes('qarzdorlik yo\\'q')`),
      true
    );

    await ff.clickSelector('#nav-students');
    await ff.waitFor(`document.querySelector('.empty-state-title')?.textContent.includes('o\\'quvchilar yo\\'q')`);

    await ff.clickSelector('#nav-groups');
    await ff.waitFor(`document.querySelector('.empty-state-title')?.textContent.includes('guruhlar mavjud emas')`);

    await ff.clickSelector('#nav-payments');
    await ff.waitFor(`document.querySelector('.empty-state-title')?.textContent.includes('mavjud emas')`);

    await ff.clickSelector('#nav-debtors');
    await ff.waitFor(`document.querySelector('.empty-state-title')?.textContent.includes('Qarzdorlik mavjud emas')`);

    await new Promise((r) => emptyCtx.server.close(r));
    emptyCtx.db.close();
    emptyCtx = null;
    completedWorkflows.push('Workflow 7: Empty-state workflows across Dashboard, Students, Groups, Payments, Debtors');

    // ========================================================================
    // Workflow 1: Create groups, create students, assign/edit, verify in all views
    // ========================================================================
    mainCtx = await startIsolatedServer(mainDbPath);
    await ff.navigate(`${mainCtx.baseUrl}/#/groups`);
    await ff.waitFor(`document.querySelector('.page-title')?.textContent === 'Guruhlar'`);

    for (const groupName of ['Frontend React', 'Backend Node', 'Archive Empty']) {
      await ff.clickSelector('.page-actions .btn-primary');
      await ff.waitForModalOpen();
      await ff.fillInput('#add-group-name', groupName);
      await ff.clickSelector('#modal-overlay button[type="submit"]');
      await ff.waitForModalClosed();
      await ff.waitFor(`document.getElementById('main-content')?.textContent.includes(${JSON.stringify(groupName)})`);
    }

    // Navigate to Students, verify cancel & reopen clears stale form values
    await ff.clickSelector('#nav-students');
    await ff.waitFor(`document.querySelector('.page-title')?.textContent === 'O\\'quvchilar'`);
    await ff.clickSelector('.page-actions .btn-primary');
    await ff.waitForModalOpen();
    await ff.fillInput('#add-student-name', 'Draft Unsaved Student');
    await ff.pressKey('Escape');
    await ff.waitForModalClosed();

    await ff.clickSelector('.page-actions .btn-primary');
    await ff.waitForModalOpen();
    assert.equal(await ff.eval(`document.getElementById('add-student-name').value`), '');

    // Create Student 1: Malika Karimova -> Frontend React, comma fee 450,000
    await ff.fillInput('#add-student-name', 'Malika Karimova');
    await ff.fillInput('#add-student-phone', '+998 90 123 45 67');
    await ff.fillInput('#add-student-fee', '450,000');
    await ff.clickSelector('#add-student-group-combobox .combobox-change-btn');
    await ff.waitFor(`getComputedStyle(document.getElementById('add-student-group-combobox-input').parentElement).display !== 'none'`);
    await ff.fillInput('#add-student-group-combobox-input', 'Frontend');
    await ff.pressKey('Enter');
    await ff.clickSelector('#modal-overlay button[type="submit"]');
    await ff.waitForModalClosed();
    await ff.waitFor(`document.getElementById('main-content')?.textContent.includes('Malika Karimova')`);

    // Create Student 2: Jasur Olimov -> 0 fee (scholarship), unassigned
    await ff.clickSelector('.page-actions .btn-primary');
    await ff.waitForModalOpen();
    await ff.fillInput('#add-student-name', 'Jasur Olimov');
    await ff.fillInput('#add-student-fee', '0');
    await ff.clickSelector('#modal-overlay button[type="submit"]');
    await ff.waitForModalClosed();
    await ff.waitFor(`document.getElementById('main-content')?.textContent.includes('Jasur Olimov')`);

    // Create Student 3: Sardor Rahimov -> Backend Node, fee 120001
    await ff.clickSelector('.page-actions .btn-primary');
    await ff.waitForModalOpen();
    await ff.fillInput('#add-student-name', 'Sardor Rahimov');
    await ff.fillInput('#add-student-fee', '120001');
    await ff.clickSelector('#add-student-group-combobox .combobox-change-btn');
    await ff.waitFor(`getComputedStyle(document.getElementById('add-student-group-combobox-input').parentElement).display !== 'none'`);
    await ff.fillInput('#add-student-group-combobox-input', 'Backend');
    await ff.pressKey('Enter');
    await ff.clickSelector('#modal-overlay button[type="submit"]');
    await ff.waitForModalClosed();
    await ff.waitFor(`document.getElementById('main-content')?.textContent.includes('Sardor Rahimov')`);

    // Edit Malika Karimova -> fee 600 000, phone +998 91 777 88 99
    await ff.eval(`(() => {
      const row = Array.from(document.querySelectorAll('tbody tr')).find((r) => r.textContent.includes('Malika Karimova'));
      const editBtn = Array.from(row.querySelectorAll('button')).find((b) => b.textContent.includes('Tahrirlash'));
      editBtn.click();
    })()`);
    await ff.waitForModalOpen();
    await ff.fillInput('#modal-overlay input[id^="edit-student-phone-"]', '+998 91 777 88 99');
    await ff.fillInput('#modal-overlay input[id^="edit-student-fee-"]', '600 000');
    await ff.clickSelector('#modal-overlay button[type="submit"]');
    await ff.waitForModalClosed();
    await ff.waitFor(`document.getElementById('main-content')?.textContent.includes('+998 91 777 88 99')`);

    // Verify consistency in Group Detail view (#/groups/1)
    await ff.clickSelector('#nav-groups');
    await ff.waitFor(`document.getElementById('main-content')?.textContent.includes('Frontend React')`);
    await ff.clickSelector('a[href="#/groups/1"]');
    await ff.waitFor(`document.querySelector('.page-title')?.textContent === 'Frontend React'`);
    assert.equal(await ff.eval(`document.getElementById('main-content')?.textContent.includes('Malika Karimova')`), true);
    completedWorkflows.push('Workflow 1: Group & Student creation, assignment, editing, and cross-view consistency');

    // ========================================================================
    // Workflow 2: Record multiple payments, verify label associations & history
    // ========================================================================
    const currentMonth = await ff.eval(`(() => {
      const now = new Date();
      return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    })()`);

    await ff.clickSelector('#nav-payments');
    await ff.waitFor(`document.getElementById('payment-amount-input') !== null`);

    // Verify DEFECT-05 fix in real browser: all 3 labels on #/payments have valid .control!
    const labelControlsBound = await ff.eval(
      `Array.from(document.querySelectorAll('form label')).every((lbl) => lbl.control !== null)`
    );
    assert.equal(labelControlsBound, true, 'All labels on #/payments must bind to form controls');

    // Record 2 payments for Malika Karimova totaling 600,000 in currentMonth
    for (const [amountStr, day] of [['250,000', '05'], ['350000', '18']]) {
      await ff.clickSelector('#student-combobox-input');
      await ff.fillInput('#student-combobox-input', 'Malika');
      await ff.pressKey('Enter');
      await ff.fillInput('#payment-amount-input', amountStr);
      await ff.fillInput('#payment-date-input', `${currentMonth}-${day}`);
      await ff.clickSelector('#payment-submit-btn');
      await ff.waitFor(`document.getElementById('payment-success-banner').style.display === 'block'`);
      await ff.eval(`document.querySelector('#payment-success-banner button.btn-primary').click()`);
    }

    // Record partial payment 20,001 for Sardor Rahimov -> remaining debt 100,000
    await ff.clickSelector('#student-combobox-input');
    await ff.fillInput('#student-combobox-input', 'Sardor');
    await ff.pressKey('Enter');
    await ff.fillInput('#payment-amount-input', '20001');
    await ff.fillInput('#payment-date-input', `${currentMonth}-12`);
    await ff.clickSelector('#payment-submit-btn');
    await ff.waitFor(`document.getElementById('payment-success-banner').style.display === 'block'`);

    // Revisit Malika's payment history (#/students/1)
    await ff.navigate(`${mainCtx.baseUrl}/#/students/1`);
    await ff.waitFor(`document.querySelector('.page-title')?.textContent === 'Malika Karimova'`);
    const malikaHistoryRows = await ff.eval(`document.querySelectorAll('.data-table tbody tr').length`);
    assert.equal(malikaHistoryRows, 2);
    assert.equal(await ff.eval(`document.getElementById('main-content')?.textContent.includes('2 ta')`), true);
    completedWorkflows.push('Workflow 2: Multiple payments recorded and verified in student payment history');

    // ========================================================================
    // Workflow 3: Monthly debtor report & independent verification vs API & Dashboard
    // ========================================================================
    await ff.clickSelector('#nav-debtors');
    await ff.waitFor(`document.querySelector('#report-content .data-table tbody') !== null`);
    const debtorRowsText = await ff.eval(
      `Array.from(document.querySelectorAll('#report-content .data-table tbody tr')).map((r) => r.textContent)`
    );
    assert.equal(debtorRowsText.length, 1, 'Only Sardor (partial payer) should be debtor in currentMonth');
    assert.ok(debtorRowsText[0].includes('Sardor Rahimov'));

    const apiDebtorsRes = await fetch(`${mainCtx.baseUrl}/debtors?month=${currentMonth}`);
    const apiDebtors = await apiDebtorsRes.json();
    assert.equal(apiDebtors.length, 1);
    assert.equal(apiDebtors[0].debt, 100000);

    // Check Dashboard matches Debtor Report
    await ff.clickSelector('#nav-dashboard');
    await ff.waitFor(`document.querySelectorAll('.stat-value').length === 3`);
    const dashStats = await ff.eval(
      `Array.from(document.querySelectorAll('.stat-value')).map((n) => n.textContent.trim())`
    );
    assert.equal(dashStats[0], '3');
    assert.equal(dashStats[1], '1 nafar');
    completedWorkflows.push('Workflow 3: Monthly debtor report verified against API and Dashboard');

    // ========================================================================
    // Workflow 4: Invalid form submissions & zero unwanted DB changes
    // ========================================================================
    const countsBeforeInvalid = {
      groups: mainCtx.db.prepare('SELECT COUNT(*) AS c FROM groups').get().c,
      students: mainCtx.db.prepare('SELECT COUNT(*) AS c FROM students').get().c,
      payments: mainCtx.db.prepare('SELECT COUNT(*) AS c FROM payments').get().c
    };

    // Duplicate group name -> Uzbek 409 error
    await ff.clickSelector('#nav-groups');
    await ff.waitFor(`document.querySelector('.page-title')?.textContent === 'Guruhlar'`);
    await ff.clickSelector('.page-actions .btn-primary');
    await ff.waitForModalOpen();
    await ff.fillInput('#add-group-name', 'Frontend React');
    await ff.clickSelector('#modal-overlay button[type="submit"]');
    await ff.waitFor(`document.querySelector('#modal-overlay .form-error')?.style.display === 'block'`);
    assert.equal(
      await ff.eval(`document.querySelector('#modal-overlay .form-error').textContent.includes('allaqachon mavjud')`),
      true
    );
    await ff.pressKey('Escape');
    await ff.waitForModalClosed();

    // Invalid student fee (-500 and decimal 450,50)
    await ff.clickSelector('#nav-students');
    await ff.waitFor(`document.querySelector('.page-title')?.textContent === 'O\\'quvchilar'`);
    await ff.clickSelector('.page-actions .btn-primary');
    await ff.waitForModalOpen();
    await ff.fillInput('#add-student-name', 'Invalid Student');
    await ff.fillInput('#add-student-fee', '450,50');
    await ff.clickSelector('#modal-overlay button[type="submit"]');
    await ff.waitFor(`document.querySelector('#modal-overlay .form-error')?.style.display === 'block'`);
    await ff.pressKey('Escape');
    await ff.waitForModalClosed();

    // Invalid zero payment
    await ff.clickSelector('#nav-payments');
    await ff.waitFor(`document.getElementById('payment-amount-input') !== null`);
    await ff.clickSelector('#student-combobox-input');
    await ff.fillInput('#student-combobox-input', 'Malika');
    await ff.pressKey('Enter');
    await ff.fillInput('#payment-amount-input', '0');
    await ff.clickSelector('#payment-submit-btn');
    await ff.waitFor(`document.getElementById('payment-error-box')?.style.display === 'block'`);

    const countsAfterInvalid = {
      groups: mainCtx.db.prepare('SELECT COUNT(*) AS c FROM groups').get().c,
      students: mainCtx.db.prepare('SELECT COUNT(*) AS c FROM students').get().c,
      payments: mainCtx.db.prepare('SELECT COUNT(*) AS c FROM payments').get().c
    };
    assert.deepEqual(countsAfterInvalid, countsBeforeInvalid, 'Invalid forms must not mutate DB');
    completedWorkflows.push('Workflow 4: Invalid submissions blocked with Uzbek errors and zero DB mutations');

    // ========================================================================
    // Workflow 5: Referential integrity (ON DELETE RESTRICT) & safe empty deletion
    // ========================================================================
    // Attempt deleting non-empty group "Backend Node" -> blocked
    await ff.clickSelector('#nav-groups');
    await ff.waitFor(`document.getElementById('main-content')?.textContent.includes('Backend Node')`);
    await ff.eval(`(() => {
      const row = Array.from(document.querySelectorAll('tbody tr')).find((r) => r.textContent.includes('Backend Node'));
      const delBtn = Array.from(row.querySelectorAll('button')).find((b) => b.textContent.includes('O\\'chirish'));
      delBtn.click();
    })()`);
    await ff.waitForModalOpen();
    assert.equal(
      await ff.eval(`document.querySelector('#modal-overlay .modal-title')?.textContent.includes('bo\\'lmaydi')`),
      true
    );
    await ff.pressKey('Escape');
    await ff.waitForModalClosed();

    // Delete empty group "Archive Empty" -> succeeds
    await ff.eval(`(() => {
      const row = Array.from(document.querySelectorAll('tbody tr')).find((r) => r.textContent.includes('Archive Empty'));
      const delBtn = Array.from(row.querySelectorAll('button')).find((b) => b.textContent.includes('O\\'chirish'));
      delBtn.click();
    })()`);
    await ff.waitForModalOpen();
    await ff.clickSelector('#modal-overlay button.btn-danger');
    await ff.waitForModalClosed();
    await ff.waitFor(`!document.getElementById('main-content')?.textContent.includes('Archive Empty')`);

    // Attempt deleting student "Malika Karimova" who has payments -> 409 Uzbek conflict
    await ff.clickSelector('#nav-students');
    await ff.waitFor(`document.getElementById('main-content')?.textContent.includes('Malika Karimova')`);
    await ff.eval(`(() => {
      const row = Array.from(document.querySelectorAll('tbody tr')).find((r) => r.textContent.includes('Malika Karimova'));
      const delBtn = Array.from(row.querySelectorAll('button')).find((b) => b.textContent.includes('O\\'chirish'));
      delBtn.click();
    })()`);
    await ff.waitForModalOpen();
    await ff.clickSelector('#modal-overlay button.btn-danger');
    await ff.waitFor(`document.querySelector('#modal-overlay .form-error')?.style.display === 'block'`);
    assert.equal(
      await ff.eval(`document.querySelector('#modal-overlay .form-error').textContent.includes('to\\'lovlar tarixi')`),
      true
    );
    await ff.pressKey('Escape');
    await ff.waitForModalClosed();
    completedWorkflows.push('Workflow 5: ON DELETE RESTRICT referential integrity enforced in UI & DB');

    // ========================================================================
    // Workflow 6: Direct nested SPA URL, page reload & full server restart persistence
    // ========================================================================
    await ff.navigate(`${mainCtx.baseUrl}/students/1`);
    await ff.waitFor(`document.querySelector('.page-title')?.textContent === 'Malika Karimova'`);
    assert.equal(await ff.eval(`window.location.hash`), '#/students/1');

    await ff.reload();
    await ff.waitFor(`document.querySelector('.page-title')?.textContent === 'Malika Karimova'`);

    // Restart server process on the same SQLite DB file and verify persisted records
    await new Promise((r) => mainCtx.server.close(r));
    mainCtx.db.close();
    mainCtx = await startIsolatedServer(mainDbPath);

    await ff.navigate(`${mainCtx.baseUrl}/#/students/1`);
    await ff.waitFor(`document.querySelector('.page-title')?.textContent === 'Malika Karimova'`);
    assert.equal(await ff.eval(`document.querySelectorAll('.data-table tbody tr').length`), 2);
    completedWorkflows.push('Workflow 6: Direct nested URL, reload, and full server restart persistence verified');

    // ========================================================================
    // Workflow 8: Rapid clicks, XSS safe rendering & responsive viewports
    // ========================================================================
    // XSS payload student name via UI
    const xssName = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
    await ff.clickSelector('#nav-students');
    await ff.waitFor(`document.querySelector('.page-title')?.textContent === 'O\\'quvchilar'`);
    await ff.clickSelector('.page-actions .btn-primary');
    await ff.waitForModalOpen();
    await ff.fillInput('#add-student-name', xssName);
    await ff.fillInput('#add-student-fee', '100000');
    await ff.clickSelector('#modal-overlay button[type="submit"]');
    await ff.waitForModalClosed();
    await ff.waitFor(`document.getElementById('main-content')?.textContent.includes('<img src=x')`);
    assert.equal(await ff.eval(`window.__xss`), undefined, 'XSS payload must never execute');
    assert.equal(await ff.eval(`document.querySelectorAll('tbody img, tbody script').length`), 0);

    // Rapid-click duplicate write prevention on payment submission
    await ff.clickSelector('#nav-payments');
    await ff.waitFor(`document.getElementById('payment-amount-input') !== null`);
    await ff.clickSelector('#student-combobox-input');
    await ff.fillInput('#student-combobox-input', 'Jasur');
    await ff.pressKey('Enter');
    await ff.fillInput('#payment-amount-input', '999');

    const paymentsBeforeRapid = mainCtx.db.prepare('SELECT COUNT(*) AS c FROM payments').get().c;
    await ff.eval(`(() => {
      const btn = document.getElementById('payment-submit-btn');
      for (let i = 0; i < 5; i++) btn.click();
    })()`);
    await ff.waitFor(`document.getElementById('payment-success-banner').style.display === 'block'`);
    const paymentsAfterRapid = mainCtx.db.prepare('SELECT COUNT(*) AS c FROM payments').get().c;
    assert.equal(paymentsAfterRapid, paymentsBeforeRapid + 1, '5 rapid clicks must create exactly 1 payment');

    // Responsive viewports: Tablet (768x1024) & Mobile (375x812) drawer toggle
    await ff.setViewport(768, 1024);
    await ff.waitFor(`window.innerWidth === 768`);
    await ff.setViewport(375, 812);
    await ff.waitFor(
      `window.innerWidth === 375 && getComputedStyle(document.getElementById('mobile-menu-btn')).display !== 'none' && document.getElementById('app-sidebar').getBoundingClientRect().right <= 0`
    );
    await ff.clickSelector('#mobile-menu-btn');
    await ff.waitFor(`document.getElementById('app-sidebar').classList.contains('open')`);
    await ff.eval(`document.getElementById('sidebar-backdrop').click()`);
    await ff.waitFor(`!document.getElementById('app-sidebar').classList.contains('open')`);

    // Assert zero browser console errors and zero failed static asset requests
    assert.equal(
      ff.consoleErrors.length,
      0,
      `Unexpected browser console errors: ${JSON.stringify(ff.consoleErrors)}`
    );
    assert.equal(
      ff.networkFailures.length,
      0,
      `Unexpected static asset/network failures: ${JSON.stringify(ff.networkFailures)}`
    );
    completedWorkflows.push('Workflow 8: Rapid-click protection, XSS safety, responsive viewports & 0 console/network errors');

    // ========================================================================
    // Workflow 9: Persistent Section Headers, Controls UX & Responsive Scrolling
    // ========================================================================
    await ff.setViewport(1280, 800);
    await ff.waitFor(`window.innerWidth === 1280 && document.getElementById('app-sidebar').getBoundingClientRect().left === 0`);

    // Bulk seed overflowing dataset in a fast single SQLite transaction
    const nowIso = new Date().toISOString();
    mainCtx.db.exec('BEGIN');
    const insOverflowGroup = mainCtx.db.prepare('INSERT INTO groups (name, created_at) VALUES (?, ?)');
    for (let g = 1; g <= 32; g++) {
      insOverflowGroup.run(`Guruh #${String(g).padStart(2, '0')} — Frontend & Backend`, nowIso);
    }
    const validGroupIds = mainCtx.db.prepare('SELECT id FROM groups ORDER BY id ASC').all().map((r) => r.id);
    const insOverflowStudent = mainCtx.db.prepare(
      'INSERT INTO students (full_name, phone, monthly_fee, group_id, created_at) VALUES (?, ?, ?, ?, ?)'
    );
    for (let s = 1; s <= 230; s++) {
      const gid = s <= 45 ? 1 : validGroupIds[s % validGroupIds.length];
      const name = s === 5 ? 'U'.repeat(200) : `Talaba ${String(s).padStart(3, '0')} Abdurahmonov`;
      const fee = 450000 + (s % 4) * 50000;
      insOverflowStudent.run(name, `+998 90 ${String(1000000 + s).slice(-7)}`, fee, gid, nowIso);
    }
    const insOverflowPayment = mainCtx.db.prepare(
      'INSERT INTO payments (student_id, amount, payment_date, created_at) VALUES (?, ?, ?, ?)'
    );
    const prevMonthStr = '2025-10';
    for (let p = 1; p <= 40; p++) {
      const day = String(((p - 1) % 28) + 1).padStart(2, '0');
      insOverflowPayment.run(1, 50000, `${prevMonthStr}-${day}`, nowIso);
    }
    mainCtx.db.exec('COMMIT');

    // 1. Dashboard: verify persistent header and single scroll container
    await ff.navigate(`${mainCtx.baseUrl}/#/`);
    await ff.waitFor(`document.querySelectorAll('.stat-value').length === 3`);
    const dashInitial = await ff.eval(`(() => {
      const title = document.querySelector('.page-title');
      const action = document.querySelector('.page-actions .btn-primary');
      return {
        scrollY: window.scrollY,
        titleTop: Math.round(title.getBoundingClientRect().top),
        actionTop: Math.round(action.getBoundingClientRect().top)
      };
    })()`);
    assert.equal(dashInitial.scrollY, 0);

    await ff.eval(`document.querySelector('.page-shell-body').scrollTop = 500`);
    await ff.waitFor(`document.querySelector('.page-shell')?.classList.contains('is-scrolled')`);
    const dashScrolled = await ff.eval(`(() => {
      const title = document.querySelector('.page-title');
      const action = document.querySelector('.page-actions .btn-primary');
      const scrollers = Array.from(document.querySelectorAll('*')).filter((el) => {
        const cs = getComputedStyle(el);
        return (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1;
      });
      return {
        scrollY: window.scrollY,
        titleTop: Math.round(title.getBoundingClientRect().top),
        actionTop: Math.round(action.getBoundingClientRect().top),
        scrollerClasses: scrollers.map((s) => s.className)
      };
    })()`);
    assert.equal(dashScrolled.scrollY, 0, 'Window scrollY must remain 0');
    assert.equal(dashScrolled.titleTop, dashInitial.titleTop, 'Dashboard title must remain at fixed top');
    assert.equal(dashScrolled.actionTop, dashInitial.actionTop, 'Dashboard action button must remain at fixed top');
    assert.equal(dashScrolled.scrollerClasses.includes('page-shell-body'), true);

    // 2. Groups: verify persistent header, sticky thead, and post-scroll modal interaction
    await ff.navigate(`${mainCtx.baseUrl}/#/groups`);
    await ff.waitFor(`document.querySelectorAll('.data-table tbody tr').length >= 30`);
    const groupsInitial = await ff.eval(`(() => {
      const title = document.querySelector('.page-title');
      const btn = document.querySelector('.page-actions .btn-primary');
      return {
        scrollY: window.scrollY,
        titleTop: Math.round(title.getBoundingClientRect().top),
        btnTop: Math.round(btn.getBoundingClientRect().top)
      };
    })()`);
    assert.equal(groupsInitial.scrollY, 0);

    await ff.eval(`document.querySelector('.page-shell-body').scrollTop = 700`);
    await ff.waitFor(`document.querySelector('.page-shell')?.classList.contains('is-scrolled')`);
    const groupsScrolled = await ff.eval(`(() => {
      const title = document.querySelector('.page-title');
      const btn = document.querySelector('.page-actions .btn-primary');
      const th = document.querySelector('.data-table thead th');
      const topShell = document.querySelector('.page-shell-top');
      const thR = th.getBoundingClientRect();
      const topR = topShell.getBoundingClientRect();
      return {
        scrollY: window.scrollY,
        titleTop: Math.round(title.getBoundingClientRect().top),
        btnTop: Math.round(btn.getBoundingClientRect().top),
        thTop: Math.round(thR.top),
        topBottom: Math.round(topR.bottom)
      };
    })()`);
    assert.equal(groupsScrolled.scrollY, 0);
    assert.equal(groupsScrolled.titleTop, groupsInitial.titleTop);
    assert.equal(groupsScrolled.btnTop, groupsInitial.btnTop);
    assert.ok(groupsScrolled.thTop >= groupsScrolled.topBottom - 1, 'Sticky thead th must not be occluded by top shell');

    await ff.clickSelector('.page-actions .btn-primary');
    await ff.waitForModalOpen();
    assert.equal(await ff.eval(`document.activeElement?.id`), 'add-group-name');
    await ff.pressKey('Escape');
    await ff.waitForModalClosed();

    // 3. Group Detail: verify persistent group header, back link, action buttons & sticky thead
    await ff.navigate(`${mainCtx.baseUrl}/#/groups/1`);
    await ff.waitFor(`document.querySelectorAll('.data-table tbody tr').length >= 40`);
    const gDetailInitial = await ff.eval(`(() => {
      const title = document.querySelector('.page-title');
      const addBtn = document.querySelector('.page-actions .btn-primary');
      return {
        titleTop: Math.round(title.getBoundingClientRect().top),
        addBtnTop: Math.round(addBtn.getBoundingClientRect().top)
      };
    })()`);
    await ff.eval(`document.querySelector('.page-shell-body').scrollTop = 800`);
    await ff.waitFor(`document.querySelector('.page-shell')?.classList.contains('is-scrolled')`);
    const gDetailScrolled = await ff.eval(`(() => {
      const title = document.querySelector('.page-title');
      const addBtn = document.querySelector('.page-actions .btn-primary');
      return {
        scrollY: window.scrollY,
        titleTop: Math.round(title.getBoundingClientRect().top),
        addBtnTop: Math.round(addBtn.getBoundingClientRect().top)
      };
    })()`);
    assert.equal(gDetailScrolled.scrollY, 0);
    assert.equal(gDetailScrolled.titleTop, gDetailInitial.titleTop);
    assert.equal(gDetailScrolled.addBtnTop, gDetailInitial.addBtnTop);

    // 4. Students: verify persistent header, search toolbar, sticky thead, pinned pagination & post-scroll interactions
    await ff.navigate(`${mainCtx.baseUrl}/#/students`);
    await ff.waitFor(`document.querySelectorAll('.data-table tbody tr').length === 100`);
    const stuInitial = await ff.eval(`(() => {
      const title = document.querySelector('.page-title');
      const addBtn = document.querySelector('.page-actions .btn-primary');
      const searchInp = document.querySelector('.search-input');
      const badge = document.getElementById('students-count-badge');
      return {
        scrollY: window.scrollY,
        titleTop: Math.round(title.getBoundingClientRect().top),
        addBtnTop: Math.round(addBtn.getBoundingClientRect().top),
        searchTop: Math.round(searchInp.getBoundingClientRect().top),
        badgeText: badge?.textContent
      };
    })()`);
    assert.equal(stuInitial.scrollY, 0);
    assert.ok(stuInitial.badgeText.includes('23'));

    await ff.eval(`document.querySelector('.table-scroll').scrollTop = 1200`);
    await ff.waitFor(`document.querySelector('.page-shell')?.classList.contains('is-scrolled')`);
    const stuScrolled = await ff.eval(`(() => {
      const title = document.querySelector('.page-title');
      const addBtn = document.querySelector('.page-actions .btn-primary');
      const searchInp = document.querySelector('.search-input');
      const bodyEl = document.querySelector('.page-shell-body');
      const th = document.querySelector('.data-table thead th');
      const pagination = document.querySelector('.pagination-bar');
      const topShell = document.querySelector('.page-shell-top');
      return {
        scrollY: window.scrollY,
        bodyScrollTop: bodyEl.scrollTop,
        titleTop: Math.round(title.getBoundingClientRect().top),
        addBtnTop: Math.round(addBtn.getBoundingClientRect().top),
        searchTop: Math.round(searchInp.getBoundingClientRect().top),
        thTop: Math.round(th.getBoundingClientRect().top),
        topBottom: Math.round(topShell.getBoundingClientRect().top + topShell.getBoundingClientRect().height),
        paginationBottom: Math.round(pagination.getBoundingClientRect().bottom)
      };
    })()`);
    assert.equal(stuScrolled.scrollY, 0);
    assert.equal(stuScrolled.bodyScrollTop, 0, 'Outer page-shell-body must not scroll when table owns scroll');
    assert.equal(stuScrolled.titleTop, stuInitial.titleTop);
    assert.equal(stuScrolled.addBtnTop, stuInitial.addBtnTop);
    assert.equal(stuScrolled.searchTop, stuInitial.searchTop);
    assert.ok(stuScrolled.thTop >= stuScrolled.topBottom - 1);

    // Post-scroll Pagination: click Next -> Page 2 / 3 and scroll resets to 0
    await ff.eval(`(() => {
      const btn = Array.from(document.querySelectorAll('.pagination-bar button')).find((b) => b.textContent.includes('Keyingi'));
      if (btn) btn.click();
    })()`);
    await ff.waitFor(`document.querySelector('.pagination-info')?.textContent.includes('Sahifa 2 / 3')`);
    assert.equal(await ff.eval(`document.querySelector('.table-scroll').scrollTop`), 0);
    assert.equal(await ff.eval(`document.querySelector('.page-shell')?.classList.contains('is-scrolled')`), false);

    // Post-scroll Filter: scroll again, then search "Talaba 001"
    await ff.eval(`document.querySelector('.table-scroll').scrollTop = 800`);
    await ff.fillInput('.search-input', 'Talaba 001');
    await ff.waitFor(`document.querySelectorAll('.data-table tbody tr').length === 1`);
    assert.equal(await ff.eval(`document.querySelector('.pagination-info')`), null, 'Single page filter should not show pagination');
    assert.ok(await ff.eval(`document.querySelector('.table-panel').clientHeight < 350`), 'Short list must hug rows without blank space');
    await ff.fillInput('.search-input', '');
    await ff.waitFor(`document.querySelectorAll('.data-table tbody tr').length === 100`);

    // Post-scroll Modal: scroll table, click + Yangi o'quvchi qo'shish -> modal opens with focus
    await ff.eval(`document.querySelector('.table-scroll').scrollTop = 900`);
    await ff.clickSelector('.page-actions .btn-primary');
    await ff.waitForModalOpen();
    assert.equal(await ff.eval(`document.activeElement?.id`), 'add-student-name');
    await ff.pressKey('Escape');
    await ff.waitForModalClosed();

    // 5. Debtors: verify persistent title, primary action, month filter & sticky bottom pagination without row bleed
    await ff.navigate(`${mainCtx.baseUrl}/#/debtors`);
    await ff.waitFor(`document.querySelectorAll('#report-content .data-table tbody tr').length === 100`);
    const debtorInitial = await ff.eval(`(() => {
      const title = document.querySelector('.page-title');
      const action = document.querySelector('.page-actions .btn-primary');
      const monthInput = document.getElementById('debtor-month-input');
      return {
        scrollY: window.scrollY,
        titleTop: Math.round(title.getBoundingClientRect().top),
        actionTop: Math.round(action.getBoundingClientRect().top),
        monthTop: Math.round(monthInput.getBoundingClientRect().top)
      };
    })()`);
    assert.equal(debtorInitial.scrollY, 0);

    await ff.eval(`document.querySelector('.page-shell-body').scrollTop = 1200`);
    await ff.waitFor(`document.querySelector('.page-shell')?.classList.contains('is-scrolled')`);
    const debtorScrolled = await ff.eval(`(() => {
      const title = document.querySelector('.page-title');
      const action = document.querySelector('.page-actions .btn-primary');
      const monthInput = document.getElementById('debtor-month-input');
      const th = document.querySelector('.data-table thead th');
      const topShell = document.querySelector('.page-shell-top');
      const body = document.querySelector('.page-shell-body');
      const pagination = document.querySelector('.pagination-bar');
      const pR = pagination.getBoundingClientRect();
      const bR = body.getBoundingClientRect();
      return {
        scrollY: window.scrollY,
        titleTop: Math.round(title.getBoundingClientRect().top),
        actionTop: Math.round(action.getBoundingClientRect().top),
        monthTop: Math.round(monthInput.getBoundingClientRect().top),
        thTop: Math.round(th.getBoundingClientRect().top),
        topBottom: Math.round(topShell.getBoundingClientRect().bottom),
        paginationBottom: Math.round(pR.bottom),
        bodyBottom: Math.round(bR.bottom)
      };
    })()`);
    assert.equal(debtorScrolled.scrollY, 0);
    assert.equal(debtorScrolled.titleTop, debtorInitial.titleTop);
    assert.equal(debtorScrolled.actionTop, debtorInitial.actionTop);
    assert.equal(debtorScrolled.monthTop, debtorInitial.monthTop);
    assert.ok(debtorScrolled.thTop >= debtorScrolled.topBottom - 1);
    assert.equal(debtorScrolled.paginationBottom, debtorScrolled.bodyBottom, 'Pagination bar must sit flush at bottom:0 with no row bleed');

    // Post-scroll Month Change: change month while scrolled -> reloads and resets scroll to 0
    await ff.fillInput('#debtor-month-input', '2025-10');
    await ff.waitFor(`document.getElementById('report-month-label')?.textContent.includes('2025')`);
    assert.equal(await ff.eval(`document.querySelector('.page-shell-body').scrollTop`), 0);
    await ff.fillInput('#debtor-month-input', currentMonth);
    await ff.waitFor(`document.querySelectorAll('#report-content .data-table tbody tr').length === 100`);

    // 6. Payments: verify combobox dropdown is not clipped by card
    await ff.navigate(`${mainCtx.baseUrl}/#/payments`);
    await ff.waitFor(`document.getElementById('student-combobox-input') !== null`);
    await ff.clickSelector('#student-combobox-input');
    await ff.waitFor(`getComputedStyle(document.getElementById('student-combobox-listbox')).display !== 'none'`);
    const pComboboxCheck = await ff.eval(`(() => {
      const lb = document.getElementById('student-combobox-listbox');
      const card = lb.closest('.card');
      return {
        lbHeight: Math.round(lb.getBoundingClientRect().height),
        cardOverflow: getComputedStyle(card).overflow
      };
    })()`);
    assert.ok(pComboboxCheck.lbHeight >= 200, 'Student combobox listbox must open with full accessible height');
    assert.equal(pComboboxCheck.cardOverflow, 'visible', 'Card must have overflow: visible to prevent dropdown clipping');

    // 7. Route history navigation (back & forward) preserves layout & scroll reset
    await ff.navigate(`${mainCtx.baseUrl}/#/students`);
    await ff.waitFor(`document.querySelector('.page-title')?.textContent === 'O\\'quvchilar'`);
    await ff.eval(`document.querySelector('.table-scroll').scrollTop = 500`);

    await ff.navigate(`${mainCtx.baseUrl}/#/debtors`);
    await ff.waitFor(`document.querySelector('.page-title')?.textContent === 'Qarzdorlar hisoboti'`);
    assert.equal(await ff.eval(`document.querySelector('.page-shell-body').scrollTop`), 0);

    await ff.navigate(`${mainCtx.baseUrl}/#/groups`);
    await ff.waitFor(`document.querySelector('.page-title')?.textContent === 'Guruhlar'`);

    await ff.eval(`window.history.back()`);
    await ff.waitFor(`document.querySelector('.page-title')?.textContent === 'Qarzdorlar hisoboti'`);
    assert.equal(await ff.eval(`document.querySelector('.page-shell-body').scrollTop`), 0);

    await ff.eval(`window.history.back()`);
    await ff.waitFor(`document.querySelector('.page-title')?.textContent === 'O\\'quvchilar'`);

    await ff.eval(`window.history.forward()`);
    await ff.waitFor(`document.querySelector('.page-title')?.textContent === 'Qarzdorlar hisoboti'`);

    // 8. Responsive resizing: Mobile (375x812) & Tablet (768x1024) verification
    await ff.setViewport(375, 812);
    await ff.waitFor(`window.innerWidth === 375 && document.getElementById('app-sidebar').getBoundingClientRect().right <= 0`);
    await ff.navigate(`${mainCtx.baseUrl}/#/students`);
    await ff.waitFor(`document.querySelectorAll('.data-table tbody tr').length === 100`);
    const mobileStu = await ff.eval(`(() => {
      const docW = document.documentElement.scrollWidth;
      const clientW = document.documentElement.clientWidth;
      const title = document.querySelector('.page-title');
      const btn = document.querySelector('.page-actions .btn-primary');
      return {
        noHorizontalBlowout: docW <= clientW,
        titleVisible: title && title.getBoundingClientRect().height > 0,
        btnVisible: btn && btn.getBoundingClientRect().height > 0
      };
    })()`);
    assert.equal(mobileStu.noHorizontalBlowout, true, 'Mobile must not blow out horizontal scrollWidth');
    assert.equal(mobileStu.titleVisible, true);
    assert.equal(mobileStu.btnVisible, true);

    await ff.setViewport(768, 1024);
    await ff.waitFor(`window.innerWidth === 768`);
    await ff.navigate(`${mainCtx.baseUrl}/#/debtors`);
    await ff.waitFor(`document.querySelectorAll('#report-content .data-table tbody tr').length === 100`);
    await ff.eval(`document.querySelector('.page-shell-body').scrollTop = 800`);
    await ff.waitFor(`document.querySelector('.page-shell')?.classList.contains('is-scrolled')`);
    const tabletDebtor = await ff.eval(`(() => {
      const th = document.querySelector('.data-table thead th');
      const topShell = document.querySelector('.page-shell-top');
      return {
        scrollY: window.scrollY,
        thTop: Math.round(th.getBoundingClientRect().top),
        topBottom: Math.round(topShell.getBoundingClientRect().bottom)
      };
    })()`);
    assert.equal(tabletDebtor.scrollY, 0);
    assert.ok(tabletDebtor.thTop >= tabletDebtor.topBottom - 1, 'Tablet must keep sticky thead th visible');

    await ff.setViewport(1280, 800);
    await ff.waitFor(`window.innerWidth === 1280 && document.getElementById('app-sidebar').getBoundingClientRect().left === 0`);
    completedWorkflows.push('Workflow 9: Persistent Section Headers, Controls UX & Responsive Scrolling');

    // ========================================================================
    // Workflow 10: Financial Reporting, Month Calculations, PDF Receipts & Group Assignment
    // ========================================================================
    // 1. Register student with enrollment date September 2026 and fee 600,000
    await ff.navigate(`${mainCtx.baseUrl}/#/students`);
    await ff.waitFor(`document.querySelector('.page-title')?.textContent === 'O\\'quvchilar'`);
    await ff.clickSelector('.page-actions .btn-primary');
    await ff.waitForModalOpen();
    await ff.fillInput('#add-student-name', 'Dilshod Karimov');
    await ff.fillInput('#add-student-phone', '+998 90 777 66 55');
    await ff.fillInput('#add-student-fee', '600000');
    await ff.fillInput('#add-student-enrollment', '2026-09-01');
    await ff.clickSelector('#modal-overlay button[type="submit"]');
    await ff.waitForModalClosed();
    await ff.fillInput('.search-input', 'Dilshod');
    await ff.waitFor(`document.getElementById('main-content')?.textContent.includes('Dilshod Karimov')`);

    // 2. Debtor calculation: appears for 2026-09 with full debt, NOT for 2026-08 (prior to enrollment)
    await ff.navigate(`${mainCtx.baseUrl}/#/reports?tab=debtors&month=2026-09`);
    await ff.waitFor(`document.getElementById('report-month-label')?.textContent.includes('Sentabr')`);
    await ff.waitFor(`document.getElementById('debtors-search-input') !== null`);
    await ff.fillInput('#debtors-search-input', 'Dilshod');
    await ff.waitFor(`document.querySelector('#report-content .data-table tbody')?.textContent.includes('Dilshod Karimov')`);

    const dilshodSeptDebtor = await ff.eval(`(() => {
      const rows = Array.from(document.querySelectorAll('#report-content .data-table tbody tr'));
      const row = rows.find(r => r.textContent.includes('Dilshod Karimov'));
      if (!row) return null;
      return { text: row.textContent };
    })()`);
    assert.ok(dilshodSeptDebtor, 'Dilshod must be in debtors list for 2026-09');
    assert.ok(dilshodSeptDebtor.text.replace(/\s+/g, ' ').includes('600 000'), 'Debt should be 600 000');

    // Switch month to 2026-08: Dilshod should NOT appear because enrollment is 2026-09-01
    await ff.fillInput('#debtor-month-input', '2026-08');
    await ff.waitFor(`document.getElementById('report-month-label')?.textContent.includes('Avgust')`);
    if (await ff.eval(`document.getElementById('debtors-search-input') !== null`)) {
      await ff.fillInput('#debtors-search-input', 'Dilshod');
    }
    const dilshodAugDebtor = await ff.eval(`(() => {
      const rows = Array.from(document.querySelectorAll('#report-content .data-table tbody tr'));
      return rows.find(r => r.textContent.includes('Dilshod Karimov'));
    })()`);
    assert.ok(!dilshodAugDebtor, 'Dilshod must not appear as debtor before enrollment month');

    // 3. Record pending payment for 2026-09: Outstanding debt must remain unchanged
    await ff.navigate(`${mainCtx.baseUrl}/#/payments`);
    await ff.waitFor(`document.getElementById('student-combobox-input') !== null`);
    await ff.clickSelector('#student-combobox-input');
    await ff.fillInput('#student-combobox-input', 'Dilshod Karimov');
    await ff.pressKey('Enter');
    await ff.waitFor(`document.getElementById('selected-student-card')?.style.display === 'flex'`);
    await ff.fillInput('#payment-amount-input', '200000');
    await ff.fillInput('#payment-month-input', '2026-09');
    await ff.clickSelector('#payment-pending-btn');
    await ff.waitFor(`document.getElementById('payment-success-banner')?.style.display === 'block'`);
    assert.equal(
      await ff.eval(`document.getElementById('payment-success-banner').textContent.includes('kutilayotgan')`),
      true
    );

    // Verify September 2026 debt is STILL 600 000 (pending payment does not reduce debt)
    await ff.navigate(`${mainCtx.baseUrl}/#/reports?tab=debtors&month=2026-09`);
    await ff.waitFor(`document.getElementById('report-month-label')?.textContent.includes('Sentabr')`);
    await ff.waitFor(`document.getElementById('debtors-search-input') !== null`);
    await ff.fillInput('#debtors-search-input', 'Dilshod');
    await ff.waitFor(`document.querySelector('#report-content .data-table tbody')?.textContent.includes('Dilshod Karimov')`);
    const debtAfterPending = await ff.eval(`(() => {
      const rows = Array.from(document.querySelectorAll('#report-content .data-table tbody tr'));
      const row = rows.find(r => r.textContent.includes('Dilshod Karimov'));
      return row ? row.textContent : '';
    })()`);
    assert.ok(debtAfterPending.replace(/\s+/g, ' ').includes('600 000'), 'Pending payment must not reduce outstanding debt');

    // 4. Confirm pending payment from student profile: debt decreases, stable receipt created, PDF generated
    const dilshodStudent = mainCtx.db.prepare('SELECT id FROM students WHERE full_name = ?').get('Dilshod Karimov');
    await ff.navigate(`${mainCtx.baseUrl}/#/students/${dilshodStudent.id}`);
    await ff.waitFor(`document.querySelector('.page-title')?.textContent === 'Dilshod Karimov'`);

    // Click "Tasdiqlash" button on the pending payment row
    await ff.eval(`(() => {
      const btn = Array.from(document.querySelectorAll('.data-table tbody tr button')).find(b => b.textContent.includes('Tasdiqlash'));
      if (btn) btn.click();
    })()`);
    await ff.waitFor(`document.querySelector('.data-table tbody')?.textContent.includes('REC-202609-')`);

    // Verify PDF receipt download endpoint returns valid PDF bytes (%PDF-)
    const pdfVerification = await ff.eval(`(async () => {
      const pdfLink = document.querySelector('.data-table tbody a[href*="/api/receipts/"]');
      if (!pdfLink) return { ok: false, error: 'No PDF link found' };
      const resp = await fetch(pdfLink.href);
      const ct = resp.headers.get('content-type');
      const buf = await resp.arrayBuffer();
      const headerStr = String.fromCharCode(...new Uint8Array(buf.slice(0, 5)));
      return { ok: resp.ok, status: resp.status, contentType: ct, isPdf: headerStr === '%PDF-' };
    })()`);
    assert.equal(pdfVerification.ok, true);
    assert.equal(pdfVerification.isPdf, true, 'Receipt endpoint must return real valid PDF starting with %PDF-');

    // Verify September 2026 debt is now 400 000 (600k - 200k confirmed)
    await ff.navigate(`${mainCtx.baseUrl}/#/reports?tab=debtors&month=2026-09`);
    await ff.waitFor(`document.getElementById('report-month-label')?.textContent.includes('Sentabr')`);
    await ff.waitFor(`document.getElementById('debtors-search-input') !== null`);
    await ff.fillInput('#debtors-search-input', 'Dilshod');
    await ff.waitFor(`document.querySelector('#report-content .data-table tbody')?.textContent.includes('Dilshod Karimov')`);
    const debtAfterConfirmSept = await ff.eval(`(() => {
      const rows = Array.from(document.querySelectorAll('#report-content .data-table tbody tr'));
      const row = rows.find(r => r.textContent.includes('Dilshod Karimov'));
      return row ? row.textContent : '';
    })()`);
    assert.ok(debtAfterConfirmSept.replace(/\s+/g, ' ').includes('400 000'), 'Debt after confirmed payment must be 400 000');
    assert.ok(debtAfterConfirmSept.replace(/\s+/g, ' ').includes('200 000'), 'Confirmed payment amount must be 200 000');

    // Verify October 2026 debt is untouched (still 600 000, September payment did not leak to October)
    await ff.fillInput('#debtor-month-input', '2026-10');
    await ff.waitFor(`document.getElementById('report-month-label')?.textContent.includes('Oktabr')`);
    await ff.waitFor(`document.getElementById('debtors-search-input') !== null`);
    await ff.fillInput('#debtors-search-input', 'Dilshod');
    await ff.waitFor(`document.querySelector('#report-content .data-table tbody')?.textContent.includes('Dilshod Karimov')`);
    const debtOct = await ff.eval(`(() => {
      const rows = Array.from(document.querySelectorAll('#report-content .data-table tbody tr'));
      const row = rows.find(r => r.textContent.includes('Dilshod Karimov'));
      return row ? row.textContent : '';
    })()`);
    assert.ok(debtOct.replace(/\s+/g, ' ').includes('600 000'), 'October debt must be 600 000');

    // 5. Group Assignment Modal: Assign existing student to group without creating duplicate
    const studentsCountBeforeAssign = mainCtx.db.prepare('SELECT COUNT(*) AS c FROM students').get().c;
    await ff.navigate(`${mainCtx.baseUrl}/#/groups/1`);
    await ff.waitFor(`document.querySelector('.page-title') !== null`);
    await ff.clickSelector('#btn-group-add-student');
    await ff.waitForModalOpen();
    assert.equal(
      await ff.eval(`document.querySelector('#modal-overlay .modal-title')?.textContent.includes('biriktirish')`),
      true
    );

    await ff.fillInput('#assign-student-search', 'Dilshod');
    await ff.waitFor(`document.querySelector('#modal-overlay table tbody')?.textContent.includes('Dilshod Karimov')`);
    await ff.eval(`(() => {
      const row = Array.from(document.querySelectorAll('#modal-overlay table tbody tr')).find(r => r.textContent.includes('Dilshod Karimov'));
      const cb = row.querySelector('input[type="checkbox"]');
      cb.click();
    })()`);
    await ff.clickSelector('#btn-assign-students-submit');
    await ff.waitForModalClosed();
    await ff.waitFor(`document.getElementById('main-content')?.textContent.includes('Dilshod Karimov')`);

    const studentsCountAfterAssign = mainCtx.db.prepare('SELECT COUNT(*) AS c FROM students').get().c;
    assert.equal(studentsCountAfterAssign, studentsCountBeforeAssign, 'Assigning existing student must never create duplicate student');
    const dilshodGroup = mainCtx.db.prepare('SELECT group_id FROM students WHERE id = ?').get(dilshodStudent.id);
    assert.equal(dilshodGroup.group_id, 1, 'Dilshod must now be assigned to Group 1');

    // 6. Comprehensive Reports views: Overview, Groups breakdown with drill-down modal, and Annual report
    await ff.navigate(`${mainCtx.baseUrl}/#/reports?tab=overview&month=2026-09`);
    await ff.waitFor(`document.querySelector('.stats-grid') !== null`);
    assert.equal(
      await ff.eval(`document.getElementById('main-content')?.textContent.includes('Kutilayotgan to\\'lov (Reja)')`),
      true
    );
    assert.equal(
      await ff.eval(`document.getElementById('main-content')?.textContent.includes('Jami tushum (Tasdiqlangan)')`),
      true
    );

    // Guruhlar bo'yicha tab
    await ff.clickSelector('button[data-tab="groups"]');
    await ff.waitFor(`document.querySelector('#report-content .data-table') !== null`);
    // Click 'Tafsilotlar' on Group 1
    const group1 = mainCtx.db.prepare('SELECT name FROM groups WHERE id = 1').get();
    await ff.eval(`(() => {
      const rows = Array.from(document.querySelectorAll('#report-content .data-table tbody tr'));
      const row = rows.find(r => r.textContent.includes(${JSON.stringify(group1.name)}));
      const btn = row ? Array.from(row.querySelectorAll('button')).find(b => b.textContent.includes('Tafsilotlar')) : null;
      if (btn) btn.click();
    })()`);
    await ff.waitForModalOpen();
    assert.equal(
      await ff.eval(`document.querySelector('#modal-overlay .modal-title')?.textContent.includes('O\\'quvchilar tafsiloti')`),
      true
    );
    assert.equal(
      await ff.eval(`document.querySelector('#modal-overlay')?.textContent.includes('Dilshod Karimov')`),
      true
    );
    await ff.pressKey('Escape');
    await ff.waitForModalClosed();

    // Yillik hisobot tab
    await ff.clickSelector('button[data-tab="annual"]');
    await ff.waitFor(`document.querySelector('#report-content .data-table tbody tr') !== null`);
    const annualRowsCount = await ff.eval(`document.querySelectorAll('#report-content .data-table tbody tr').length`);
    assert.ok(annualRowsCount >= 12, 'Annual report must render all 12 months');

    completedWorkflows.push('Workflow 10: Financial Reporting, Month Calculations, PDF Receipts & Group Assignment');

    // --------------------------------------------------------------------------
    // WORKFLOW 11: Real-Browser End-to-End Administrator Verification
    // (Full lifecycle: Groups, Students with 2026-10-28 enrollment, Pending/Confirm/Reject
    //  payments, Receipt verification, Historical month isolation, Detail views & Reload)
    // --------------------------------------------------------------------------
    // 1. Create group
    await ff.navigate(`${mainCtx.baseUrl}/#/groups?action=new`);
    await ff.waitForModalOpen();
    await ff.fillInput('#add-group-name', 'E2E QA Guruh');
    await ff.clickSelector('#modal-overlay button[type="submit"]');
    await ff.waitForModalClosed();
    await ff.waitFor(`document.getElementById('main-content')?.textContent.includes('E2E QA Guruh')`);

    const qaGroup = mainCtx.db.prepare("SELECT * FROM groups WHERE name = 'E2E QA Guruh'").get();
    assert.ok(qaGroup, 'QA Group must be persisted in database');

    // 2. Create student with 2026-10-28 enrollment
    await ff.navigate(`${mainCtx.baseUrl}/#/students?action=new`);
    await ff.waitForModalOpen();
    await ff.fillInput('#add-student-name', 'Nodirbek E2E');
    await ff.fillInput('#add-student-fee', '500000');
    await ff.fillInput('#add-student-enrollment', '2026-10-28');
    await ff.clickSelector('#modal-overlay button[type="submit"]');
    await ff.waitForModalClosed();
    await ff.fillInput('.search-input', 'Nodirbek');
    await ff.waitFor(`document.getElementById('main-content')?.textContent.includes('Nodirbek E2E')`);

    const nodirStudent = mainCtx.db.prepare("SELECT * FROM students WHERE full_name = 'Nodirbek E2E'").get();
    assert.ok(nodirStudent);
    assert.equal(nodirStudent.enrollment_date, '2026-10-28');

    // 3. Assign Nodirbek to E2E QA Guruh
    await ff.navigate(`${mainCtx.baseUrl}/#/groups/${qaGroup.id}`);
    await ff.waitFor(`document.querySelector('.page-title') !== null`);
    await ff.clickSelector('#btn-group-add-student');
    await ff.waitForModalOpen();
    await ff.fillInput('#assign-student-search', 'Nodirbek');
    await ff.waitFor(`document.querySelector('#modal-overlay table tbody')?.textContent.includes('Nodirbek E2E')`);
    await ff.eval(`(() => {
      const row = Array.from(document.querySelectorAll('#modal-overlay table tbody tr')).find(r => r.textContent.includes('Nodirbek E2E'));
      const cb = row.querySelector('input[type="checkbox"]');
      if (cb) cb.click();
    })()`);
    await ff.clickSelector('#btn-assign-students-submit');
    await ff.waitForModalClosed();
    await ff.waitFor(`document.getElementById('main-content')?.textContent.includes('Nodirbek E2E')`);

    // 4. Record pending payment for Nodirbek (250,000 UZS)
    await ff.navigate(`${mainCtx.baseUrl}/#/payments?student_id=${nodirStudent.id}&month=2026-10`);
    await ff.waitFor(`document.getElementById('payment-amount-input') !== null`);
    await ff.waitFor(`document.getElementById('selected-student-card')?.style.display === 'flex'`);
    await ff.fillInput('#payment-amount-input', '250000');
    await ff.clickSelector('#payment-pending-btn');
    await ff.waitFor(`document.getElementById('payment-success-banner')?.style.display !== 'none'`);

    // Record second pending payment for Nodirbek (100,000 UZS)
    await ff.navigate(`${mainCtx.baseUrl}/#/students`);
    await ff.waitFor(`document.querySelector('.page-title')?.textContent === 'O\\'quvchilar'`);
    await ff.navigate(`${mainCtx.baseUrl}/#/payments?student_id=${nodirStudent.id}&month=2026-10`);
    await ff.waitFor(`document.getElementById('payment-amount-input') !== null`);
    await ff.waitFor(`document.getElementById('selected-student-card')?.style.display === 'flex'`);
    await ff.fillInput('#payment-amount-input', '100000');
    await ff.clickSelector('#payment-pending-btn');
    await ff.waitFor(`document.getElementById('payment-success-banner')?.style.display !== 'none'`);

    // 5. Open Nodirbek's student detail page -> confirm 250k payment and reject 100k payment
    await ff.navigate(`${mainCtx.baseUrl}/#/students/${nodirStudent.id}`);
    await ff.waitFor(`document.querySelector('#main-content .data-table tbody tr') !== null`);
    await ff.waitFor(`document.querySelector('.btn-danger-outline') !== null`);

    // Reject the 100k payment (the row with '100 000' and 'Rad etish')
    await ff.eval(`(() => {
      const rows = Array.from(document.querySelectorAll('#main-content .data-table tbody tr'));
      const row100k = rows.find(r => r.textContent.replace(/\\s+/g, ' ').includes('100 000'));
      const rejectBtn = row100k ? row100k.querySelector('.btn-danger-outline') : null;
      if (rejectBtn) rejectBtn.click();
    })()`);
    await ff.waitFor(`document.querySelector('#main-content .data-table tbody')?.textContent.includes('Rad etilgan')`);

    // Confirm the 250k payment
    await ff.eval(`(() => {
      const rows = Array.from(document.querySelectorAll('#main-content .data-table tbody tr'));
      const row250k = rows.find(r => r.textContent.replace(/\\s+/g, ' ').includes('250 000'));
      const confirmBtn = row250k ? row250k.querySelector('.btn-primary') : null;
      if (confirmBtn) confirmBtn.click();
    })()`);
    await ff.waitFor(`document.querySelector('#main-content .data-table tbody')?.textContent.includes('Chek (PDF)')`);

    // 6. Verify enrollment month isolation: In September 2026, Nodirbek has ZERO debt
    await ff.navigate(`${mainCtx.baseUrl}/#/reports?tab=debtors&month=2026-09`);
    await ff.waitFor(`document.getElementById('report-month-label')?.textContent.includes('Sentabr')`);
    await ff.waitFor(`document.getElementById('debtors-search-input') !== null`);
    await ff.fillInput('#debtors-search-input', 'Nodirbek');
    const nodirInSept = await ff.eval(`(() => {
      const tbody = document.querySelector('#report-content .data-table tbody');
      return tbody ? tbody.textContent.includes('Nodirbek E2E') : false;
    })()`);
    assert.equal(nodirInSept, false, 'October 28 enrollee must NOT be a debtor in September 2026');

    // 7. In October 2026: Nodirbek has remaining debt of 250,000 UZS (500k fee - 250k confirmed; rejected 100k does not reduce)
    await ff.fillInput('#debtor-month-input', '2026-10');
    await ff.waitFor(`document.getElementById('report-month-label')?.textContent.includes('Oktabr')`);
    await ff.waitFor(`document.getElementById('debtors-search-input') !== null`);
    await ff.fillInput('#debtors-search-input', 'Nodirbek');
    await ff.waitFor(`document.querySelector('#report-content .data-table tbody')?.textContent.includes('Nodirbek E2E')`);
    const nodirOctRow = await ff.eval(`(() => {
      const rows = Array.from(document.querySelectorAll('#report-content .data-table tbody tr'));
      const row = rows.find(r => r.textContent.includes('Nodirbek E2E'));
      return row ? row.textContent : '';
    })()`);
    assert.ok(nodirOctRow.replace(/\s+/g, ' ').includes('250 000'), 'October remaining debt must be 250 000');

    // 8. Edit student details
    await ff.navigate(`${mainCtx.baseUrl}/#/students/${nodirStudent.id}`);
    await ff.waitFor(`document.querySelector('.page-actions button') !== null`);
    await ff.clickSelector('.page-actions button'); // Edit button
    await ff.waitForModalOpen();
    await ff.fillInput('#modal-overlay input[id^="edit-student-phone-"]', '+998 90 888 77 66');
    await ff.clickSelector('#modal-overlay button[type="submit"]');
    await ff.waitForModalClosed();
    await ff.waitFor(`document.getElementById('main-content')?.textContent.includes('+998 90 888 77 66')`);

    // 9. Full page reload and server state persistence
    await ff.reload();
    await ff.waitFor(`document.getElementById('main-content')?.textContent.includes('+998 90 888 77 66')`);
    await ff.waitFor(`document.getElementById('main-content')?.textContent.includes('Chek (PDF)')`);
    await ff.waitFor(`document.getElementById('main-content')?.textContent.includes('Rad etilgan')`);

    completedWorkflows.push('Workflow 11: Real-Browser End-to-End Administrator Verification');

    for (const line of completedWorkflows) {
      console.log(`[PASS] ${line}`);
    }
    console.log('All real-browser Firefox WebDriver BiDi E2E workflows passed.');
  } finally {
    await ff.close();
    if (emptyCtx) {
      await new Promise((r) => emptyCtx.server.close(r));
      emptyCtx.db.close();
    }
    if (mainCtx) {
      await new Promise((r) => mainCtx.server.close(r));
      mainCtx.db.close();
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirect) {
  runE2E().catch((err) => {
    console.error('E2E Browser Suite Failed:', err);
    process.exit(1);
  });
}
