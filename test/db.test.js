import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { createDatabase } from '../src/db/connection.js';
import { initDatabase } from '../src/db/init.js';

test('Database connection and foreign-key enforcement', async (t) => {
  await t.test('enables and verifies foreign-key enforcement on every connection', () => {
    const db = createDatabase(':memory:');
    try {
      const fk = db.pragma('foreign_keys', { simple: true });
      assert.equal(fk, 1, 'Foreign keys must be active');
    } finally {
      db.close();
    }
  });

  await t.test('fails if foreign key constraint cannot be satisfied', () => {
    const db = createDatabase(':memory:');
    try {
      initDatabase(db);

      // Inserting payment referencing non-existent student_id must throw
      assert.throws(
        () => {
          db.prepare('INSERT INTO payments (student_id, amount, payment_date, created_at) VALUES (?, ?, ?, ?)').run(
            999,
            500000,
            '2026-10-15',
            '2026-10-15T00:00:00.000Z'
          );
        },
        (err) => {
          return err.message.includes('FOREIGN KEY constraint failed');
        }
      );
    } finally {
      db.close();
    }
  });
});

test('Database initialization and repeat initialization', async (t) => {
  await t.test('initializes schema without adding demo records', () => {
    const db = createDatabase(':memory:');
    try {
      initDatabase(db);

      const students = db.prepare('SELECT COUNT(*) as count FROM students').get();
      assert.equal(students.count, 0, 'No demo student records should exist');

      const payments = db.prepare('SELECT COUNT(*) as count FROM payments').get();
      assert.equal(payments.count, 0, 'No demo payment records should exist');

      const migrations = db.prepare('SELECT * FROM schema_migrations').all();
      assert.equal(migrations.length, 1);
      assert.equal(migrations[0].version, '001_initial_schema');
    } finally {
      db.close();
    }
  });

  await t.test('repeat initialization is idempotent and does not destroy existing data', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-pay-test-'));
    const dbPath = path.join(tmpDir, 'test_repeat_init.db');

    try {
      // First connection & init
      const db1 = createDatabase(dbPath);
      initDatabase(db1);

      // Insert real records
      db1.prepare('INSERT INTO students (id, full_name, monthly_fee, created_at) VALUES (?, ?, ?, ?)').run(
        1,
        'Nodirbek',
        1200000,
        '2026-10-01T10:00:00.000Z'
      );
      db1.prepare('INSERT INTO payments (id, student_id, amount, payment_date, created_at) VALUES (?, ?, ?, ?, ?)').run(
        1,
        1,
        600000,
        '2026-10-05',
        '2026-10-05T12:00:00.000Z'
      );
      db1.close();

      // Second connection & re-init
      const db2 = createDatabase(dbPath);
      initDatabase(db2);

      const student = db2.prepare('SELECT * FROM students WHERE id = 1').get();
      assert.ok(student);
      assert.equal(student.full_name, 'Nodirbek');
      assert.equal(student.monthly_fee, 1200000);

      const payment = db2.prepare('SELECT * FROM payments WHERE id = 1').get();
      assert.ok(payment);
      assert.equal(payment.amount, 600000);

      // Third initialization on same open connection
      initDatabase(db2);
      const studentCount = db2.prepare('SELECT COUNT(*) as count FROM students').get();
      assert.equal(studentCount.count, 1, 'Data must not be duplicated or destroyed');

      db2.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

test('Foreign-key deletion restriction (ON DELETE RESTRICT)', async (t) => {
  await t.test('restricts deletion of student with payment history', () => {
    const db = createDatabase(':memory:');
    try {
      initDatabase(db);

      db.prepare('INSERT INTO students (id, full_name, monthly_fee, created_at) VALUES (?, ?, ?, ?)').run(
        1,
        'Rustam',
        800000,
        '2026-10-01T00:00:00.000Z'
      );
      db.prepare('INSERT INTO payments (student_id, amount, payment_date, created_at) VALUES (?, ?, ?, ?)').run(
        1,
        400000,
        '2026-10-10',
        '2026-10-10T00:00:00.000Z'
      );

      // Deletion must be restricted
      assert.throws(
        () => {
          db.prepare('DELETE FROM students WHERE id = ?').run(1);
        },
        (err) => {
          return err.message.includes('FOREIGN KEY constraint failed');
        }
      );

      // Student is still in database
      const student = db.prepare('SELECT * FROM students WHERE id = 1').get();
      assert.ok(student);
    } finally {
      db.close();
    }
  });

  await t.test('allows deletion of student without payment history', () => {
    const db = createDatabase(':memory:');
    try {
      initDatabase(db);

      db.prepare('INSERT INTO students (id, full_name, monthly_fee, created_at) VALUES (?, ?, ?, ?)').run(
        2,
        'No Payments Student',
        500000,
        '2026-10-01T00:00:00.000Z'
      );

      const res = db.prepare('DELETE FROM students WHERE id = ?').run(2);
      assert.equal(res.changes, 1);

      const student = db.prepare('SELECT * FROM students WHERE id = 2').get();
      assert.equal(student, undefined);
    } finally {
      db.close();
    }
  });
});

test('SQLite STRICT table and CHECK constraint integrity', async (t) => {
  await t.test('enforces students full_name non-empty and non-whitespace check', () => {
    const db = createDatabase(':memory:');
    try {
      initDatabase(db);

      assert.throws(
        () => db.prepare('INSERT INTO students (full_name, monthly_fee, created_at) VALUES (?, ?, ?)').run('', 100, '2026-10-01T00:00:00Z'),
        /CHECK constraint failed/
      );

      assert.throws(
        () => db.prepare('INSERT INTO students (full_name, monthly_fee, created_at) VALUES (?, ?, ?)').run('   ', 100, '2026-10-01T00:00:00Z'),
        /CHECK constraint failed/
      );
    } finally {
      db.close();
    }
  });

  await t.test('enforces non-negative monthly_fee on students', () => {
    const db = createDatabase(':memory:');
    try {
      initDatabase(db);

      assert.throws(
        () => db.prepare('INSERT INTO students (full_name, monthly_fee, created_at) VALUES (?, ?, ?)').run('Valid Name', -100, '2026-10-01T00:00:00Z'),
        /CHECK constraint failed/
      );

      // Zero monthly fee is allowed
      assert.doesNotThrow(
        () => db.prepare('INSERT INTO students (full_name, monthly_fee, created_at) VALUES (?, ?, ?)').run('Free Student', 0, '2026-10-01T00:00:00Z')
      );
    } finally {
      db.close();
    }
  });

  await t.test('enforces STRICT INTEGER type check on monthly_fee', () => {
    const db = createDatabase(':memory:');
    try {
      initDatabase(db);

      assert.throws(
        () => db.prepare('INSERT INTO students (full_name, monthly_fee, created_at) VALUES (?, ?, ?)').run('Float Fee', 500000.75, '2026-10-01T00:00:00Z'),
        /cannot store REAL value in INTEGER column/
      );
    } finally {
      db.close();
    }
  });

  await t.test('enforces positive amount on payments (zero and negative rejected)', () => {
    const db = createDatabase(':memory:');
    try {
      initDatabase(db);
      db.prepare("INSERT INTO students (id, full_name, monthly_fee, created_at) VALUES (1, 'Test', 500000, '2026-10-01T00:00:00Z')").run();

      // Zero amount rejected
      assert.throws(
        () => db.prepare('INSERT INTO payments (student_id, amount, payment_date, created_at) VALUES (?, ?, ?, ?)').run(1, 0, '2026-10-15', '2026-10-15T00:00:00Z'),
        /CHECK constraint failed/
      );

      // Negative amount rejected
      assert.throws(
        () => db.prepare('INSERT INTO payments (student_id, amount, payment_date, created_at) VALUES (?, ?, ?, ?)').run(1, -500, '2026-10-15', '2026-10-15T00:00:00Z'),
        /CHECK constraint failed/
      );

      // Positive amount allowed
      assert.doesNotThrow(
        () => db.prepare('INSERT INTO payments (student_id, amount, payment_date, created_at) VALUES (?, ?, ?, ?)').run(1, 100000, '2026-10-15', '2026-10-15T00:00:00Z')
      );
    } finally {
      db.close();
    }
  });

  await t.test('enforces payment_date format GLOB constraint', () => {
    const db = createDatabase(':memory:');
    try {
      initDatabase(db);
      db.prepare("INSERT INTO students (id, full_name, monthly_fee, created_at) VALUES (1, 'Test', 500000, '2026-10-01T00:00:00Z')").run();

      assert.throws(
        () => db.prepare('INSERT INTO payments (student_id, amount, payment_date, created_at) VALUES (?, ?, ?, ?)').run(1, 100, '2026-1-5', '2026-10-15T00:00:00Z'),
        /CHECK constraint failed/
      );

      assert.throws(
        () => db.prepare('INSERT INTO payments (student_id, amount, payment_date, created_at) VALUES (?, ?, ?, ?)').run(1, 100, 'invalid-date', '2026-10-15T00:00:00Z'),
        /CHECK constraint failed/
      );
    } finally {
      db.close();
    }
  });

  await t.test('index idx_payments_student_date_id exists', () => {
    const db = createDatabase(':memory:');
    try {
      initDatabase(db);
      const indexList = db.prepare("PRAGMA index_list('payments')").all();
      const hasIndex = indexList.some((idx) => idx.name === 'idx_payments_student_date_id');
      assert.ok(hasIndex, 'Index idx_payments_student_date_id must exist on payments table');
    } finally {
      db.close();
    }
  });
});
