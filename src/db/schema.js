/**
 * Database schema and migrations definition for Project Pay.
 * Uses SQLite STRICT tables, foreign keys with ON DELETE RESTRICT, and check constraints.
 */

export const migrations = [
  {
    version: '001_initial_schema',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS students (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          full_name TEXT NOT NULL CHECK (length(trim(full_name)) > 0),
          monthly_fee INTEGER NOT NULL CHECK (monthly_fee >= 0 AND monthly_fee <= 9007199254740991),
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        ) STRICT;

        CREATE TABLE IF NOT EXISTS payments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
          amount INTEGER NOT NULL CHECK (amount > 0 AND amount <= 9007199254740991),
          payment_date TEXT NOT NULL CHECK (payment_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(payment_date) = payment_date),
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        ) STRICT;

        CREATE INDEX IF NOT EXISTS idx_payments_student_date_id ON payments (student_id, payment_date, id);
        CREATE INDEX IF NOT EXISTS idx_payments_payment_date ON payments (payment_date);
      `);
    }
  },
  {
    version: '002_harden_constraints',
    up(db) {
      // For existing databases where 001 was already applied without the strengthened CHECK constraints
      const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'payments'").get();
      if (tableInfo && !tableInfo.sql.includes('date(payment_date) = payment_date')) {
        db.exec(`
          CREATE TABLE payments_harden (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
            amount INTEGER NOT NULL CHECK (amount > 0 AND amount <= 9007199254740991),
            payment_date TEXT NOT NULL CHECK (payment_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(payment_date) = payment_date),
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
          ) STRICT;

          INSERT INTO payments_harden (id, student_id, amount, payment_date, created_at)
          SELECT id, student_id, amount, payment_date, created_at FROM payments;

          DROP TABLE payments;
          ALTER TABLE payments_harden RENAME TO payments;

          CREATE INDEX IF NOT EXISTS idx_payments_student_date_id ON payments (student_id, payment_date, id);
          CREATE INDEX IF NOT EXISTS idx_payments_payment_date ON payments (payment_date);
        `);
      }
    }
  },
  {
    version: '003_add_groups_table',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS groups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(name)) > 0),
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        ) STRICT;
      `);

      // Add group_id to students table if not already present
      const studentColumns = db.prepare('PRAGMA table_info(students)').all();
      const hasGroupId = studentColumns.some((col) => col.name === 'group_id');
      if (!hasGroupId) {
        db.exec('ALTER TABLE students ADD COLUMN group_id INTEGER REFERENCES groups(id) ON DELETE RESTRICT;');
      }

      db.exec('CREATE INDEX IF NOT EXISTS idx_students_group_id ON students (group_id);');
    }
  },
  {
    version: '004_add_student_phone',
    up(db) {
      const studentColumns = db.prepare('PRAGMA table_info(students)').all();
      const hasPhone = studentColumns.some((col) => col.name === 'phone');
      if (!hasPhone) {
        db.exec('ALTER TABLE students ADD COLUMN phone TEXT;');
      }
    }
  },
  {
    version: '005_billing_month_and_receipts',
    up(db) {
      // 1. Add billing_month, status, and confirmed_at to payments table
      const paymentColumns = db.prepare('PRAGMA table_info(payments)').all();
      const hasBillingMonth = paymentColumns.some((col) => col.name === 'billing_month');
      if (!hasBillingMonth) {
        db.exec('ALTER TABLE payments ADD COLUMN billing_month TEXT;');
      }

      const hasStatus = paymentColumns.some((col) => col.name === 'status');
      if (!hasStatus) {
        db.exec("ALTER TABLE payments ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed'));");
      }

      const hasConfirmedAt = paymentColumns.some((col) => col.name === 'confirmed_at');
      if (!hasConfirmedAt) {
        db.exec('ALTER TABLE payments ADD COLUMN confirmed_at TEXT;');
      }

      // Safe backward-compatible migration for existing payments without explicit billing_month
      db.exec(`
        UPDATE payments
        SET billing_month = substr(payment_date, 1, 7)
        WHERE billing_month IS NULL
          AND payment_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]*';

        UPDATE payments
        SET confirmed_at = created_at
        WHERE status = 'confirmed' AND confirmed_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_payments_billing_month_status ON payments (billing_month, status);
        CREATE INDEX IF NOT EXISTS idx_payments_student_billing ON payments (student_id, billing_month, status);
      `);

      // 2. Add status and enrollment_date to students table
      const studentColumns = db.prepare('PRAGMA table_info(students)').all();
      const hasStudentStatus = studentColumns.some((col) => col.name === 'status');
      if (!hasStudentStatus) {
        db.exec("ALTER TABLE students ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'exempt'));");
      }

      const hasEnrollmentDate = studentColumns.some((col) => col.name === 'enrollment_date');
      if (!hasEnrollmentDate) {
        db.exec('ALTER TABLE students ADD COLUMN enrollment_date TEXT;');
      }

      // 3. Create persistent receipts table
      db.exec(`
        CREATE TABLE IF NOT EXISTS receipts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          receipt_number TEXT NOT NULL UNIQUE CHECK (length(trim(receipt_number)) > 0),
          payment_id INTEGER NOT NULL UNIQUE REFERENCES payments(id) ON DELETE RESTRICT,
          student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
          amount INTEGER NOT NULL CHECK (amount > 0 AND amount <= 9007199254740991),
          billing_month TEXT NOT NULL CHECK (billing_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND substr(billing_month, 6, 2) BETWEEN '01' AND '12'),
          payment_date TEXT NOT NULL CHECK (payment_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(payment_date) = payment_date),
          confirmed_at TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        ) STRICT;

        CREATE INDEX IF NOT EXISTS idx_receipts_student_id ON receipts (student_id);
        CREATE INDEX IF NOT EXISTS idx_receipts_payment_id ON receipts (payment_id);
        CREATE INDEX IF NOT EXISTS idx_receipts_receipt_number ON receipts (receipt_number);
        CREATE INDEX IF NOT EXISTS idx_receipts_billing_month ON receipts (billing_month);
      `);
    }
  }
];
