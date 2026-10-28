import test from 'node:test';
import assert from 'node:assert/strict';

import { createDatabase } from '../src/db/connection.js';
import { initDatabase } from '../src/db/init.js';
import {
  createStudent,
  getStudentById,
  listStudents,
  updateStudent,
  deleteStudent
} from '../src/services/students.js';
import {
  createPayment,
  getPaymentsByStudent,
  listPayments
} from '../src/services/payments.js';

test('Student service operations', async (t) => {
  const db = createDatabase(':memory:');
  initDatabase(db);

  await t.test('creates student with trimmed name and UTC timestamp', () => {
    const student = createStudent(db, { full_name: '  Jasur Bek  ', monthly_fee: 750000 });
    assert.ok(student.id > 0);
    assert.equal(student.full_name, 'Jasur Bek');
    assert.equal(student.monthly_fee, 750000);
    assert.ok(student.created_at.endsWith('Z'), 'Timestamp must be UTC ISO-8601');

    const fetched = getStudentById(db, student.id);
    assert.deepEqual(fetched, student);
  });

  await t.test('returns null for non-existent student ID', () => {
    const fetched = getStudentById(db, 99999);
    assert.equal(fetched, null);
  });

  await t.test('lists students in ascending ID order', () => {
    createStudent(db, { full_name: 'Anvar', monthly_fee: 500000 });
    createStudent(db, { full_name: 'Bekzod', monthly_fee: 600000 });

    const students = listStudents(db);
    assert.ok(students.length >= 3);
    for (let i = 1; i < students.length; i++) {
      assert.ok(students[i].id > students[i - 1].id, 'Students must be ordered by id ascending');
    }
  });

  await t.test('updates student partially and preserves omitted fields', () => {
    const original = createStudent(db, { full_name: 'Original Name', monthly_fee: 800000 });

    // Update name only
    const updatedName = updateStudent(db, original.id, { full_name: 'New Name' });
    assert.ok(updatedName);
    assert.equal(updatedName.full_name, 'New Name');
    assert.equal(updatedName.monthly_fee, 800000); // Preserved
    assert.equal(updatedName.created_at, original.created_at);

    // Update fee only
    const updatedFee = updateStudent(db, original.id, { monthly_fee: 1200000 });
    assert.ok(updatedFee);
    assert.equal(updatedFee.full_name, 'New Name'); // Preserved
    assert.equal(updatedFee.monthly_fee, 1200000);

    // Update non-existent student
    const notFound = updateStudent(db, 99999, { full_name: 'Ghost' });
    assert.equal(notFound, null);

    // Reject empty update
    assert.throws(() => updateStudent(db, original.id, {}), /At least one field/);
  });

  await t.test('creates, retrieves, updates, preserves, and clears optional student phone', () => {
    // Omitted phone defaults to null
    const sNoPhone = createStudent(db, { full_name: 'No Phone Student', monthly_fee: 400000 });
    assert.equal(sNoPhone.phone, null);

    // Blank phone normalizes to null
    const sBlankPhone = createStudent(db, { full_name: 'Blank Phone Student', phone: '   ', monthly_fee: 400000 });
    assert.equal(sBlankPhone.phone, null);

    // Trimmed valid phone stored and returned
    const sWithPhone = createStudent(db, {
      full_name: 'Phone Student',
      phone: '  +998 90 123 45 67  ',
      monthly_fee: 900000
    });
    assert.equal(sWithPhone.phone, '+998 90 123 45 67');
    assert.equal(getStudentById(db, sWithPhone.id).phone, '+998 90 123 45 67');

    // listStudents includes phone field for all records
    const all = listStudents(db);
    assert.equal(all.find((s) => s.id === sNoPhone.id).phone, null);
    assert.equal(all.find((s) => s.id === sWithPhone.id).phone, '+998 90 123 45 67');

    // Updating another field preserves existing phone
    const afterFeeUpdate = updateStudent(db, sWithPhone.id, { monthly_fee: 950000 });
    assert.equal(afterFeeUpdate.phone, '+998 90 123 45 67');
    assert.equal(afterFeeUpdate.monthly_fee, 950000);

    // Updating only phone works and preserves other fields
    const afterPhoneUpdate = updateStudent(db, sNoPhone.id, { phone: '+998 93 555 66 77' });
    assert.equal(afterPhoneUpdate.phone, '+998 93 555 66 77');
    assert.equal(afterPhoneUpdate.full_name, 'No Phone Student');

    // Clearing phone via blank string or null sets phone to null
    const clearedViaBlank = updateStudent(db, sNoPhone.id, { phone: '   ' });
    assert.equal(clearedViaBlank.phone, null);

    const clearedViaNull = updateStudent(db, sWithPhone.id, { phone: null });
    assert.equal(clearedViaNull.phone, null);
  });

  await t.test('rejects invalid student inputs', () => {
    assert.throws(() => createStudent(db, { full_name: '   ', monthly_fee: 500000 }), /empty/);
    assert.throws(() => createStudent(db, { full_name: 'Valid', monthly_fee: -100 }), /non-negative/);
    assert.throws(() => createStudent(db, { full_name: 'Valid', monthly_fee: 100.5 }), /safe integer/);
    assert.throws(() => createStudent(db, { full_name: 'Valid', monthly_fee: '500000' }), /number/);
    assert.throws(() => createStudent(db, { full_name: 'Valid', phone: 123456, monthly_fee: 500000 }), /string/);
    assert.throws(() => updateStudent(db, 1, { unknown_field: 'x' }));
  });
});

test('Payment service operations', async (t) => {
  const db = createDatabase(':memory:');
  initDatabase(db);

  const student = createStudent(db, { full_name: 'Malika', monthly_fee: 900000 });

  await t.test('creates payment with validated fields and UTC timestamp', () => {
    const payment = createPayment(db, {
      student_id: student.id,
      amount: 450000,
      payment_date: '2026-10-10'
    });

    assert.ok(payment.id > 0);
    assert.equal(payment.student_id, student.id);
    assert.equal(payment.amount, 450000);
    assert.equal(payment.payment_date, '2026-10-10');
    assert.ok(payment.created_at.endsWith('Z'));
  });

  await t.test('retrieves payments by student ordered by date and id', () => {
    createPayment(db, { student_id: student.id, amount: 200000, payment_date: '2026-10-05' });
    createPayment(db, { student_id: student.id, amount: 250000, payment_date: '2026-10-20' });

    const studentPayments = getPaymentsByStudent(db, student.id);
    assert.equal(studentPayments.length, 3);
    assert.equal(studentPayments[0].payment_date, '2026-10-05');
    assert.equal(studentPayments[1].payment_date, '2026-10-10');
    assert.equal(studentPayments[2].payment_date, '2026-10-20');
  });

  await t.test('rejects payment for non-existent student (foreign key)', () => {
    assert.throws(
      () => createPayment(db, { student_id: 88888, amount: 100000, payment_date: '2026-10-10' }),
      /FOREIGN KEY constraint failed/
    );
  });

  await t.test('rejects invalid payment inputs at validation layer', () => {
    assert.throws(() => createPayment(db, { student_id: student.id, amount: 0, payment_date: '2026-10-10' }));
    assert.throws(() => createPayment(db, { student_id: student.id, amount: -100, payment_date: '2026-10-10' }));
    assert.throws(() => createPayment(db, { student_id: student.id, amount: 100.5, payment_date: '2026-10-10' }));
    assert.throws(() => createPayment(db, { student_id: student.id, amount: 1000, payment_date: '2026-02-31' }));
  });
});

test('Student deletion and transaction atomicity', async (t) => {
  const db = createDatabase(':memory:');
  initDatabase(db);

  await t.test('deleting student with payments fails via ON DELETE RESTRICT', () => {
    const student = createStudent(db, { full_name: 'Protected Student', monthly_fee: 500000 });
    createPayment(db, { student_id: student.id, amount: 100000, payment_date: '2026-10-10' });

    assert.throws(
      () => deleteStudent(db, student.id),
      /FOREIGN KEY constraint failed/
    );

    // Verify student is still in db
    assert.ok(getStudentById(db, student.id));
  });

  await t.test('deleting student without payments succeeds', () => {
    const student = createStudent(db, { full_name: 'Temporary Student', monthly_fee: 400000 });
    const result = deleteStudent(db, student.id);
    assert.equal(result.success, true);
    assert.equal(result.changes, 1);
    assert.equal(getStudentById(db, student.id), null);
  });

  await t.test('transactions roll back all changes if an error occurs', () => {
    const runBatch = db.transaction(() => {
      createStudent(db, { full_name: 'Batch Student 1', monthly_fee: 100000 });
      createStudent(db, { full_name: 'Batch Student 2', monthly_fee: 200000 });
      // Deliberately trigger error in 3rd operation
      throw new Error('Batch operation failed');
    });

    assert.throws(() => runBatch(), /Batch operation failed/);

    const all = listStudents(db);
    const hasBatch1 = all.some((s) => s.full_name === 'Batch Student 1');
    const hasBatch2 = all.some((s) => s.full_name === 'Batch Student 2');
    assert.equal(hasBatch1, false, 'Batch Student 1 must have been rolled back');
    assert.equal(hasBatch2, false, 'Batch Student 2 must have been rolled back');
  });
});
