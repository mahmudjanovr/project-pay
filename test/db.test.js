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

      const migrations = db.prepare('SELECT * FROM schema_migrations ORDER BY id ASC').all();
      assert.equal(migrations.length, 3);
      assert.equal(migrations[0].version, '001_initial_schema');
      assert.equal(migrations[1].version, '002_harden_constraints');
      assert.equal(migrations[2].version, '003_add_groups_table');
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

  await t.test('enforces impossible calendar dates rejected directly by SQLite', () => {
    const db = createDatabase(':memory:');
    try {
      initDatabase(db);
      db.prepare("INSERT INTO students (id, full_name, monthly_fee, created_at) VALUES (1, 'Test', 500000, '2026-10-01T00:00:00Z')").run();

      // Impossible days in month
      assert.throws(
        () => db.prepare('INSERT INTO payments (student_id, amount, payment_date, created_at) VALUES (?, ?, ?, ?)').run(1, 100, '2026-02-30', '2026-10-15T00:00:00Z'),
        /CHECK constraint failed/
      );
      assert.throws(
        () => db.prepare('INSERT INTO payments (student_id, amount, payment_date, created_at) VALUES (?, ?, ?, ?)').run(1, 100, '2026-04-31', '2026-10-15T00:00:00Z'),
        /CHECK constraint failed/
      );

      // Non-leap year leap day
      assert.throws(
        () => db.prepare('INSERT INTO payments (student_id, amount, payment_date, created_at) VALUES (?, ?, ?, ?)').run(1, 100, '2023-02-29', '2026-10-15T00:00:00Z'),
        /CHECK constraint failed/
      );
      assert.throws(
        () => db.prepare('INSERT INTO payments (student_id, amount, payment_date, created_at) VALUES (?, ?, ?, ?)').run(1, 100, '1900-02-29', '2026-10-15T00:00:00Z'),
        /CHECK constraint failed/
      );

      // Valid leap days allowed
      assert.doesNotThrow(
        () => db.prepare('INSERT INTO payments (student_id, amount, payment_date, created_at) VALUES (?, ?, ?, ?)').run(1, 100, '2024-02-29', '2026-10-15T00:00:00Z')
      );
      assert.doesNotThrow(
        () => db.prepare('INSERT INTO payments (student_id, amount, payment_date, created_at) VALUES (?, ?, ?, ?)').run(1, 100, '2000-02-29', '2026-10-15T00:00:00Z')
      );
    } finally {
      db.close();
    }
  });

  await t.test('enforces safe integer upper bound in SQLite schema', () => {
    const db = createDatabase(':memory:');
    try {
      initDatabase(db);

      // Maximum safe integer is allowed
      assert.doesNotThrow(
        () => db.prepare('INSERT INTO students (id, full_name, monthly_fee, created_at) VALUES (?, ?, ?, ?)').run(1, 'Rich', 9007199254740991, '2026-10-01T00:00:00Z')
      );
      assert.doesNotThrow(
        () => db.prepare('INSERT INTO payments (student_id, amount, payment_date, created_at) VALUES (?, ?, ?, ?)').run(1, 9007199254740991, '2026-10-15', '2026-10-15T00:00:00Z')
      );

      // Beyond MAX_SAFE_INTEGER is rejected by CHECK constraint
      assert.throws(
        () => db.prepare('INSERT INTO students (full_name, monthly_fee, created_at) VALUES (?, ?, ?)').run('Overflow', BigInt('10000000000000000'), '2026-10-01T00:00:00Z'),
        /CHECK constraint failed/
      );
      assert.throws(
        () => db.prepare('INSERT INTO payments (student_id, amount, payment_date, created_at) VALUES (?, ?, ?, ?)').run(1, BigInt('10000000000000000'), '2026-10-15', '2026-10-15T00:00:00Z'),
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

test('Migration safety and transaction rollback', async (t) => {
  await t.test('transactional migration rollback prevents partially applied schema on failure', () => {
    const db = createDatabase(':memory:');
    try {
      initDatabase(db);

      // Simulate a custom failing migration
      const failingMigration = {
        version: '999_failing_migration',
        up(dbInstance) {
          dbInstance.exec('CREATE TABLE should_be_rolled_back (id INTEGER PRIMARY KEY);');
          throw new Error('Simulated failure during migration');
        }
      };

      const getApplied = db.prepare('SELECT version FROM schema_migrations');
      const insertMigration = db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)');

      assert.throws(() => {
        const runTx = db.transaction(() => {
          failingMigration.up(db);
          insertMigration.run(failingMigration.version, new Date().toISOString());
        });
        runTx();
      }, /Simulated failure/);

      // Verify table was not created and migration was not recorded
      const tableExists = db.prepare("SELECT count(*) as c FROM sqlite_master WHERE type='table' AND name='should_be_rolled_back'").get().c;
      assert.equal(tableExists, 0, 'Table must be rolled back on migration failure');

      const migrationExists = db.prepare("SELECT count(*) as c FROM schema_migrations WHERE version='999_failing_migration'").get().c;
      assert.equal(migrationExists, 0, 'Failed migration must not be recorded in schema_migrations');
    } finally {
      db.close();
    }
  });

  await t.test('smoothly upgrades an existing database that was on unhardened schema', () => {
    const db = createDatabase(':memory:');
    try {
      db.pragma('foreign_keys = ON');

      // Set up legacy schema without date(payment_date) check
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          version TEXT NOT NULL UNIQUE,
          applied_at TEXT NOT NULL
        ) STRICT;
        INSERT INTO schema_migrations (version, applied_at) VALUES ('001_initial_schema', '2026-10-01T00:00:00.000Z');

        CREATE TABLE students (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          full_name TEXT NOT NULL CHECK (length(trim(full_name)) > 0),
          monthly_fee INTEGER NOT NULL CHECK (monthly_fee >= 0),
          created_at TEXT NOT NULL
        ) STRICT;

        CREATE TABLE payments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
          amount INTEGER NOT NULL CHECK (amount > 0),
          payment_date TEXT NOT NULL CHECK (payment_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
          created_at TEXT NOT NULL
        ) STRICT;
      `);

      db.prepare("INSERT INTO students (id, full_name, monthly_fee, created_at) VALUES (1, 'Legacy Student', 500000, '2026-10-01T00:00:00Z')").run();
      db.prepare("INSERT INTO payments (id, student_id, amount, payment_date, created_at) VALUES (1, 1, 250000, '2026-10-15', '2026-10-15T00:00:00Z')").run();

      // Now run initDatabase which will apply migration 002
      initDatabase(db);

      // Verify records preserved
      const student = db.prepare('SELECT * FROM students WHERE id = 1').get();
      assert.equal(student.full_name, 'Legacy Student');
      const payment = db.prepare('SELECT * FROM payments WHERE id = 1').get();
      assert.equal(payment.amount, 250000);

      // Verify hardened date check is now active on payments
      assert.throws(
        () => db.prepare("INSERT INTO payments (student_id, amount, payment_date, created_at) VALUES (1, 100, '2026-02-30', '2026-10-15T00:00:00Z')").run(),
        /CHECK constraint failed/
      );
    } finally {
      db.close();
    }
  });
});
