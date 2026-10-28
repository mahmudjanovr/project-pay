import test from 'node:test';
import assert from 'node:assert/strict';

import { createDatabase } from '../src/db/connection.js';
import { initDatabase } from '../src/db/init.js';
import { getMonthlyDebtors } from '../src/services/debtors.js';
import { createStudent } from '../src/services/students.js';
import { createPayment } from '../src/services/payments.js';

test('Monthly debtor calculation business rules', async (t) => {
  // Setup fresh isolated in-memory database with deterministic fixtures
  const db = createDatabase(':memory:');
  initDatabase(db);

  // Fixtures:
  // Student 1: 1,000,000 UZS fee, partial payment in May 2026 (400,000 UZS) -> Debt: 600,000
  // Student 2: 800,000 UZS fee, exact payment in May 2026 (800,000 UZS) -> Debt: 0 (not in debtors)
  // Student 3: 500,000 UZS fee, overpayment in May 2026 (700,000 UZS) -> Debt: 0 (not in debtors)
  // Student 4: 1,200,000 UZS fee, NO payments in May 2026 -> Debt: 1,200,000 (paid: 0)
  // Student 5: 0 UZS fee (scholarship), no payments -> Debt: 0 (not in debtors)
  const s1 = createStudent(db, { full_name: 'Student One', monthly_fee: 1000000, enrollment_date: '2026-05-01' });
  const s2 = createStudent(db, { full_name: 'Student Two', monthly_fee: 800000, enrollment_date: '2026-05-01' });
  const s3 = createStudent(db, { full_name: 'Student Three', monthly_fee: 500000, enrollment_date: '2026-05-01' });
  const s4 = createStudent(db, { full_name: 'Student Four', monthly_fee: 1200000, enrollment_date: '2026-05-01' });
  const s5 = createStudent(db, { full_name: 'Scholarship Student', monthly_fee: 0, enrollment_date: '2026-05-01' });

  // Payments for May 2026 (2026-05)
  createPayment(db, { student_id: s1.id, amount: 400000, payment_date: '2026-05-10' });
  createPayment(db, { student_id: s2.id, amount: 800000, payment_date: '2026-05-15' });
  createPayment(db, { student_id: s3.id, amount: 700000, payment_date: '2026-05-20' });

  await t.test('calculates correct debtors for May 2026', () => {
    const debtors = getMonthlyDebtors(db, '2026-05');

    // Expected debtors: Student 1 (partial) and Student 4 (no payment)
    assert.equal(debtors.length, 2, 'Only students with paid < monthly_fee must be returned');

    const debtor1 = debtors.find((d) => d.student_id === s1.id);
    assert.ok(debtor1, 'Student 1 must be in debtors');
    assert.equal(debtor1.full_name, 'Student One');
    assert.equal(debtor1.monthly_fee, 1000000);
    assert.equal(debtor1.total_paid, 400000);
    assert.equal(debtor1.debt, 600000);

    const debtor4 = debtors.find((d) => d.student_id === s4.id);
    assert.ok(debtor4, 'Student 4 must be in debtors');
    assert.equal(debtor4.full_name, 'Student Four');
    assert.equal(debtor4.monthly_fee, 1200000);
    assert.equal(debtor4.total_paid, 0);
    assert.equal(debtor4.debt, 1200000);

    // Exact payment (s2), overpayment (s3), and zero fee (s5) must not be in debtors
    assert.equal(debtors.some((d) => d.student_id === s2.id), false);
    assert.equal(debtors.some((d) => d.student_id === s3.id), false);
    assert.equal(debtors.some((d) => d.student_id === s5.id), false);
  });

  await t.test('ensures excess payment does not carry forward as credit to another month', () => {
    // In June 2026 (2026-06), Student 3 makes no payment.
    // In May, Student 3 overpaid by 200,000 UZS.
    // Business rule: Excess payments do not carry forward as credit.
    // Therefore, in June, Student 3 must owe the full 500,000 UZS fee.
    const juneDebtors = getMonthlyDebtors(db, '2026-06');
    const debtor3InJune = juneDebtors.find((d) => d.student_id === s3.id);

    assert.ok(debtor3InJune, 'Student 3 must be a debtor in June');
    assert.equal(debtor3InJune.total_paid, 0);
    assert.equal(debtor3InJune.debt, 500000);
  });

  await t.test('payments from other months do not affect selected month', () => {
    // Record payment for Student 4 in April 2026 and June 2026
    createPayment(db, { student_id: s4.id, amount: 1200000, payment_date: '2026-04-25' });
    createPayment(db, { student_id: s4.id, amount: 1200000, payment_date: '2026-06-05' });

    // Student 4 made NO payments in May 2026. May debt must remain exactly 1,200,000 UZS.
    const mayDebtors = getMonthlyDebtors(db, '2026-05');
    const debtor4InMay = mayDebtors.find((d) => d.student_id === s4.id);
    assert.ok(debtor4InMay);
    assert.equal(debtor4InMay.total_paid, 0);
    assert.equal(debtor4InMay.debt, 1200000);

    // In April 2026, Student 4 paid full fee -> NOT a debtor
    const aprilDebtors = getMonthlyDebtors(db, '2026-04');
    assert.equal(aprilDebtors.some((d) => d.student_id === s4.id), false);
  });
});

test('Month boundary conditions and multiple payments', async (t) => {
  const db = createDatabase(':memory:');
  initDatabase(db);

  // Student with 1,000,000 fee
  const student = createStudent(db, { full_name: 'Boundary Test Student', monthly_fee: 1000000, enrollment_date: '2026-05-01' });

  await t.test('payments on first day and last day of month are included', () => {
    // Payment on first day of May: 2026-05-01
    createPayment(db, { student_id: student.id, amount: 300000, payment_date: '2026-05-01' });

    // Payment on last day of May: 2026-05-31
    createPayment(db, { student_id: student.id, amount: 700000, payment_date: '2026-05-31' });

    // Total in May = 300,000 + 700,000 = 1,000,000 -> Debt = 0, excluded from debtors
    const mayDebtors = getMonthlyDebtors(db, '2026-05');
    assert.equal(mayDebtors.some((d) => d.student_id === student.id), false, 'Full payment on boundaries clears debt');
  });

  await t.test('payments immediately outside boundaries are strictly excluded', () => {
    const student2 = createStudent(db, { full_name: 'Outside Boundary Student', monthly_fee: 1000000, enrollment_date: '2026-05-01' });

    // Payment immediately before May: 2026-04-30
    createPayment(db, { student_id: student2.id, amount: 500000, payment_date: '2026-04-30' });

    // Payment immediately after May: 2026-06-01
    createPayment(db, { student_id: student2.id, amount: 500000, payment_date: '2026-06-01' });

    // For May 2026, student2 has 0 payments in May
    const mayDebtors = getMonthlyDebtors(db, '2026-05');
    const debtor = mayDebtors.find((d) => d.student_id === student2.id);
    assert.ok(debtor, 'Student must be a debtor for May');
    assert.equal(debtor.total_paid, 0, 'Outside boundary payments must not count in May');
    assert.equal(debtor.debt, 1000000);
  });

  await t.test('multiple payments in one month are summed correctly without duplicate rows', () => {
    const student3 = createStudent(db, { full_name: 'Multi Payment Student', monthly_fee: 1000000, enrollment_date: '2026-05-01' });

    // Three payments in May 2026
    createPayment(db, { student_id: student3.id, amount: 150000, payment_date: '2026-05-05' });
    createPayment(db, { student_id: student3.id, amount: 250000, payment_date: '2026-05-15' });
    createPayment(db, { student_id: student3.id, amount: 100000, payment_date: '2026-05-25' });

    // Total paid = 500,000. Debt = 500,000.
    const mayDebtors = getMonthlyDebtors(db, '2026-05');
    const matches = mayDebtors.filter((d) => d.student_id === student3.id);

    assert.equal(matches.length, 1, 'There must be no duplicate student rows');
    assert.equal(matches[0].total_paid, 500000);
    assert.equal(matches[0].debt, 500000);
  });
});

test('Future month debt calculation', async (t) => {
  const db = createDatabase(':memory:');
  initDatabase(db);

  createStudent(db, { full_name: 'Student A', monthly_fee: 600000 });
  createStudent(db, { full_name: 'Student B', monthly_fee: 900000 });
  createStudent(db, { full_name: 'Student Free', monthly_fee: 0 });

  await t.test('future month with no payments shows debt for all fee-paying students', () => {
    const futureDebtors = getMonthlyDebtors(db, '2035-08');

    // Fee-paying students owe their full monthly_fee
    assert.equal(futureDebtors.length, 2);

    const a = futureDebtors.find((d) => d.full_name === 'Student A');
    assert.ok(a);
    assert.equal(a.total_paid, 0);
    assert.equal(a.debt, 600000);

    const b = futureDebtors.find((d) => d.full_name === 'Student B');
    assert.ok(b);
    assert.equal(b.total_paid, 0);
    assert.equal(b.debt, 900000);

    // Free student is not in debtors
    assert.equal(futureDebtors.some((d) => d.full_name === 'Student Free'), false);
  });
});

test('SQL parameterization and injection prevention', async (t) => {
  const db = createDatabase(':memory:');
  initDatabase(db);

  createStudent(db, { full_name: 'Inject Target', monthly_fee: 1000000 });

  await t.test('rejects malicious report month input at validation layer', () => {
    assert.throws(
      () => getMonthlyDebtors(db, "2026-05' OR '1'='1"),
      /Report month/
    );

    assert.throws(
      () => getMonthlyDebtors(db, "2026-05'; DROP TABLE students; --"),
      /Report month/
    );
  });

  await t.test('direct parameterized query execution does not execute injected SQL', () => {
    // Verify that passing malicious strings as parameter values cannot perform SQL injection
    const maliciousInput = "2026-05' OR 1=1 --";
    const stmt = db.prepare('SELECT * FROM students WHERE full_name = ?');
    const result = stmt.all(maliciousInput);
    assert.equal(result.length, 0, 'Parameterized query must treat malicious input strictly as string literal');

    // Tables still intact
    const count = db.prepare('SELECT COUNT(*) as count FROM students').get();
    assert.equal(count.count, 1);
  });
});

test('Financial integrity and overflow handling in debtor calculations', async (t) => {
  const db = createDatabase(':memory:');
  initDatabase(db);

  await t.test('calculates debt correctly for maximum supported financial amounts', () => {
    // 9,007,199,254,740,991 is Number.MAX_SAFE_INTEGER
    const MAX = 9007199254740991;
    const student = createStudent(db, { full_name: 'Max Student', monthly_fee: MAX });
    createPayment(db, { student_id: student.id, amount: 5000000000000000, payment_date: '2026-10-15' });

    const debtors = getMonthlyDebtors(db, '2026-10');
    assert.equal(debtors.length, 1);
    assert.equal(debtors[0].student_id, student.id);
    assert.equal(debtors[0].total_paid, 5000000000000000);
    assert.equal(debtors[0].debt, 4007199254740991);
    assert.ok(Number.isSafeInteger(debtors[0].debt));
    assert.ok(Number.isSafeInteger(debtors[0].total_paid));
  });

  await t.test('detects integer overflow in payment aggregation and throws RangeError without returning corrupt total', () => {
    // Isolated db to test corrupt or raw values exceeding safe integer range
    const rawDb = createDatabase(':memory:');
    rawDb.exec(`
      CREATE TABLE students (id INTEGER PRIMARY KEY, full_name TEXT, monthly_fee REAL);
      CREATE TABLE payments (id INTEGER PRIMARY KEY, student_id INTEGER, amount REAL, payment_date TEXT);
    `);

    // Student has a fee beyond safe integer (e.g. legacy/corrupt record: 10^17)
    // Payments exceed Number.MAX_SAFE_INTEGER (9,007,199,254,740,991)
    rawDb.prepare("INSERT INTO students VALUES (1, 'Overflow Student', 100000000000000000)").run();
    rawDb.prepare("INSERT INTO payments VALUES (1, 1, 9007199254740992, '2026-10-10')").run();

    assert.throws(
      () => getMonthlyDebtors(rawDb, '2026-10'),
      (err) => {
        return err instanceof RangeError && err.message.includes('Financial calculation overflow detected');
      }
    );
  });
});

