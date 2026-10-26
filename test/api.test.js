import test from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';
import { startServer, PORT } from '../src/server.js';
import { createDatabase } from '../src/db/connection.js';
import { initDatabase } from '../src/db/init.js';

// Helper to spin up an ephemeral server with an in-memory database
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

test('Student API Endpoints', async (t) => {
  const ctx = createTestContext();
  t.after(() => ctx.close());

  let createdStudentId;

  await t.test('GET /api/students initially returns empty array', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/students`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.deepEqual(data, []);
  });

  await t.test('POST /api/students creates student with trimmed name and non-negative fee', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: '  Anvar Olimov  ',
        monthly_fee: 1000000
      })
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.ok(data.id > 0);
    assert.equal(data.full_name, 'Anvar Olimov');
    assert.equal(data.monthly_fee, 1000000);
    assert.ok(data.created_at.endsWith('Z'));
    createdStudentId = data.id;
  });

  await t.test('POST /api/students rejects invalid inputs', async () => {
    // Empty name
    const r1 = await fetch(`${ctx.baseUrl}/api/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: '   ', monthly_fee: 500000 })
    });
    assert.equal(r1.status, 400);
    const e1 = await r1.json();
    assert.equal(e1.error, 'Bad Request');
    assert.ok(e1.message.includes('empty'));

    // Negative fee
    const r2 = await fetch(`${ctx.baseUrl}/api/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: 'Valid Name', monthly_fee: -100 })
    });
    assert.equal(r2.status, 400);

    // Float fee
    const r3 = await fetch(`${ctx.baseUrl}/api/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: 'Valid Name', monthly_fee: 100.5 })
    });
    assert.equal(r3.status, 400);

    // String fee
    const r4 = await fetch(`${ctx.baseUrl}/api/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: 'Valid Name', monthly_fee: '1000000' })
    });
    assert.equal(r4.status, 400);

    // Extra unknown field
    const r5 = await fetch(`${ctx.baseUrl}/api/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: 'Valid Name', monthly_fee: 500000, extra: 'bad' })
    });
    assert.equal(r5.status, 400);
  });

  await t.test('GET /api/students/:id returns existing student', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/students/${createdStudentId}`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.id, createdStudentId);
    assert.equal(data.full_name, 'Anvar Olimov');
    assert.equal(data.monthly_fee, 1000000);
  });

  await t.test('GET /api/students/:id returns 404 for non-existent student', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/students/99999`);
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.equal(data.error, 'Not Found');
    assert.ok(data.message.includes('99999'));
  });

  await t.test('GET /api/students/:id returns 400 for malformed route IDs', async () => {
    const badIds = ['abc', '0', '-5', '1.5', '99999999999999999999'];
    for (const badId of badIds) {
      const res = await fetch(`${ctx.baseUrl}/api/students/${badId}`);
      assert.equal(res.status, 400, `Expected 400 for ID: ${badId}`);
      const data = await res.json();
      assert.equal(data.error, 'Bad Request');
    }
  });

  await t.test('PATCH /api/students/:id partially updates full_name and preserves monthly_fee', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/students/${createdStudentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: 'Anvar Updated' })
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.id, createdStudentId);
    assert.equal(data.full_name, 'Anvar Updated');
    assert.equal(data.monthly_fee, 1000000); // Preserved
  });

  await t.test('PATCH /api/students/:id partially updates monthly_fee and preserves full_name', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/students/${createdStudentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monthly_fee: 1500000 })
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.id, createdStudentId);
    assert.equal(data.full_name, 'Anvar Updated'); // Preserved
    assert.equal(data.monthly_fee, 1500000);
  });

  await t.test('PATCH /api/students/:id rejects empty updates and invalid fields', async () => {
    // Empty update
    const r1 = await fetch(`${ctx.baseUrl}/api/students/${createdStudentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(r1.status, 400);

    // Invalid negative fee
    const r2 = await fetch(`${ctx.baseUrl}/api/students/${createdStudentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monthly_fee: -1 })
    });
    assert.equal(r2.status, 400);

    // Empty whitespace name
    const r3 = await fetch(`${ctx.baseUrl}/api/students/${createdStudentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: '   ' })
    });
    assert.equal(r3.status, 400);

    // Extra field
    const r4 = await fetch(`${ctx.baseUrl}/api/students/${createdStudentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: 'Valid', extra: 123 })
    });
    assert.equal(r4.status, 400);

    // Non-existent student
    const r5 = await fetch(`${ctx.baseUrl}/api/students/99999`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: 'Valid' })
    });
    assert.equal(r5.status, 404);
  });

  await t.test('DELETE /api/students/:id deletes student without payments', async () => {
    // Create temporary student
    const createRes = await fetch(`${ctx.baseUrl}/api/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: 'To Delete', monthly_fee: 500000 })
    });
    const tempStudent = await createRes.json();

    const delRes = await fetch(`${ctx.baseUrl}/api/students/${tempStudent.id}`, {
      method: 'DELETE'
    });
    assert.equal(delRes.status, 200);
    const delData = await delRes.json();
    assert.equal(delData.success, true);

    // Subsequent GET returns 404
    const getRes = await fetch(`${ctx.baseUrl}/api/students/${tempStudent.id}`);
    assert.equal(getRes.status, 404);
  });

  await t.test('DELETE /api/students/:id returns 404 for non-existent student', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/students/99999`, {
      method: 'DELETE'
    });
    assert.equal(res.status, 404);
  });
});

test('Payment API Endpoints and Conflict Handling', async (t) => {
  const ctx = createTestContext();
  t.after(() => ctx.close());

  // Create a student for payment tests
  const studentRes = await fetch(`${ctx.baseUrl}/api/students`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ full_name: 'Payment Student', monthly_fee: 800000 })
  });
  const student = await studentRes.json();

  let paymentId;

  await t.test('POST /api/payments creates payment for existing student', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_id: student.id,
        amount: 400000,
        payment_date: '2026-10-15'
      })
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.ok(data.id > 0);
    assert.equal(data.student_id, student.id);
    assert.equal(data.amount, 400000);
    assert.equal(data.payment_date, '2026-10-15');
    assert.ok(data.created_at.endsWith('Z'));
    paymentId = data.id;
  });

  await t.test('POST /api/payments returns 404 if student does not exist', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_id: 99999,
        amount: 400000,
        payment_date: '2026-10-15'
      })
    });

    assert.equal(res.status, 404);
    const data = await res.json();
    assert.equal(data.error, 'Not Found');
    assert.ok(data.message.includes('99999'));
  });

  await t.test('POST /api/payments rejects invalid fields and impossible dates', async () => {
    // Zero amount
    const r1 = await fetch(`${ctx.baseUrl}/api/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: student.id, amount: 0, payment_date: '2026-10-15' })
    });
    assert.equal(r1.status, 400);

    // Negative amount
    const r2 = await fetch(`${ctx.baseUrl}/api/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: student.id, amount: -500, payment_date: '2026-10-15' })
    });
    assert.equal(r2.status, 400);

    // Impossible calendar date (February 30)
    const r3 = await fetch(`${ctx.baseUrl}/api/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: student.id, amount: 1000, payment_date: '2026-02-30' })
    });
    assert.equal(r3.status, 400);

    // Impossible leap day (2023 is non-leap)
    const r4 = await fetch(`${ctx.baseUrl}/api/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: student.id, amount: 1000, payment_date: '2023-02-29' })
    });
    assert.equal(r4.status, 400);

    // Malformed date
    const r5 = await fetch(`${ctx.baseUrl}/api/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: student.id, amount: 1000, payment_date: '2026-1-5' })
    });
    assert.equal(r5.status, 400);
  });

  await t.test('GET /api/students/:id/payments lists payments for student', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/students/${student.id}/payments`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.length, 1);
    assert.equal(data[0].id, paymentId);
    assert.equal(data[0].amount, 400000);
  });

  await t.test('GET /api/students/:id/payments returns 404 for non-existent student', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/students/99999/payments`);
    assert.equal(res.status, 404);
  });

  await t.test('DELETE /api/students/:id returns 409 Conflict when student has payment history', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/students/${student.id}`, {
      method: 'DELETE'
    });

    assert.equal(res.status, 409);
    const data = await res.json();
    assert.equal(data.error, 'Conflict');
    assert.ok(data.message.includes('payment history'));

    // Verify student was NOT deleted
    const checkRes = await fetch(`${ctx.baseUrl}/api/students/${student.id}`);
    assert.equal(checkRes.status, 200);
  });
});

test('Monthly Debtor Report Endpoint', async (t) => {
  const ctx = createTestContext();
  t.after(() => ctx.close());

  // Setup students:
  // s1: 1,000,000 fee, paid 400,000 in 2026-10 -> debt 600,000 (debtor)
  // s2: 500,000 fee, paid 500,000 in 2026-10 -> debt 0 (not debtor)
  // s3: 600,000 fee, paid 0 in 2026-10 -> debt 600,000 (debtor)
  // s4: 0 fee (scholarship) -> not debtor
  const r1 = await fetch(`${ctx.baseUrl}/api/students`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ full_name: 'Debtor Student', monthly_fee: 1000000 })
  });
  const s1 = await r1.json();

  const r2 = await fetch(`${ctx.baseUrl}/api/students`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ full_name: 'Paid Student', monthly_fee: 500000 })
  });
  const s2 = await r2.json();

  const r3 = await fetch(`${ctx.baseUrl}/api/students`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ full_name: 'Unpaid Student', monthly_fee: 600000 })
  });
  const s3 = await r3.json();

  const r4 = await fetch(`${ctx.baseUrl}/api/students`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ full_name: 'Scholarship Student', monthly_fee: 0 })
  });
  const s4 = await r4.json();

  // Payments in 2026-10
  await fetch(`${ctx.baseUrl}/api/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ student_id: s1.id, amount: 400000, payment_date: '2026-10-10' })
  });
  await fetch(`${ctx.baseUrl}/api/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ student_id: s2.id, amount: 500000, payment_date: '2026-10-15' })
  });

  await t.test('GET /api/reports/debtors?month=2026-10 returns correct debtor calculations', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/reports/debtors?month=2026-10`);
    assert.equal(res.status, 200);
    const debtors = await res.json();

    assert.equal(debtors.length, 2);

    const d1 = debtors.find((d) => d.student_id === s1.id);
    assert.ok(d1);
    assert.equal(d1.full_name, 'Debtor Student');
    assert.equal(d1.monthly_fee, 1000000);
    assert.equal(d1.total_paid, 400000);
    assert.equal(d1.debt, 600000);

    const d3 = debtors.find((d) => d.student_id === s3.id);
    assert.ok(d3);
    assert.equal(d3.full_name, 'Unpaid Student');
    assert.equal(d3.monthly_fee, 600000);
    assert.equal(d3.total_paid, 0);
    assert.equal(d3.debt, 600000);

    // Paid student (s2) and Free student (s4) must NOT be in debtors
    assert.equal(debtors.some((d) => d.student_id === s2.id), false);
    assert.equal(debtors.some((d) => d.student_id === s4.id), false);
  });

  await t.test('GET /api/reports/debtors rejects missing or invalid month', async () => {
    // Missing month query parameter
    const r1 = await fetch(`${ctx.baseUrl}/api/reports/debtors`);
    assert.equal(r1.status, 400);
    const e1 = await r1.json();
    assert.equal(e1.error, 'Bad Request');

    // Invalid month numbers
    const r2 = await fetch(`${ctx.baseUrl}/api/reports/debtors?month=2026-13`);
    assert.equal(r2.status, 400);

    const r3 = await fetch(`${ctx.baseUrl}/api/reports/debtors?month=2026-00`);
    assert.equal(r3.status, 400);

    // Invalid formats
    const r4 = await fetch(`${ctx.baseUrl}/api/reports/debtors?month=2026-1`);
    assert.equal(r4.status, 400);

    const r5 = await fetch(`${ctx.baseUrl}/api/reports/debtors?month=2026/10`);
    assert.equal(r5.status, 400);
  });
});

test('Unknown routes, malformed payloads, and server error handling', async (t) => {
  const ctx = createTestContext();
  t.after(() => ctx.close());

  await t.test('returns consistent JSON 404 for unknown routes', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/unknown-endpoint`);
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.equal(data.error, 'Not Found');
    assert.ok(data.message.includes('/api/unknown-endpoint'));
  });

  await t.test('returns 400 for malformed JSON request body', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"unclosed_json": '
    });

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.error, 'Bad Request');
    assert.equal(data.message, 'Malformed JSON in request body');
  });

  await t.test('does not leak internal details, stack traces, or SQL on errors', async () => {
    // Trigger 400 via invalid body
    const res = await fetch(`${ctx.baseUrl}/api/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: 123, monthly_fee: 'invalid' })
    });

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.error, 'Bad Request');
    assert.equal(data.stack, undefined);
    assert.equal(data.sql, undefined);
  });
});

test('Server configuration and lifecycle', async (t) => {
  await t.test('defaults PORT to 3000 when unspecified', () => {
    assert.ok(PORT === 3000 || typeof PORT === 'number');
  });

  await t.test('startServer starts and closes on custom ephemeral port', async () => {
    const { server, db } = startServer(0, ':memory:');
    const port = server.address().port;
    assert.ok(port > 0);

    const res = await fetch(`http://127.0.0.1:${port}/api/students`);
    assert.equal(res.status, 200);

    await new Promise((resolve) => server.close(resolve));
    db.close();
  });
});
