/**
 * Database schema and migrations definition for Ecomdev.
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
    version: '005_add_payment_billing_month_and_confirmation',
    up(db) {
      const paymentColumns = db.prepare('PRAGMA table_info(payments)').all();
      const hasBillingMonth = paymentColumns.some((col) => col.name === 'billing_month');
      if (!hasBillingMonth) {
        db.exec('ALTER TABLE payments ADD COLUMN billing_month TEXT;');
      }

      const hasStatus = paymentColumns.some((col) => col.name === 'status');
      if (!hasStatus) {
        db.exec("ALTER TABLE payments ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed';");
      }

      const hasConfirmedAt = paymentColumns.some((col) => col.name === 'confirmed_at');
      if (!hasConfirmedAt) {
        db.exec('ALTER TABLE payments ADD COLUMN confirmed_at TEXT;');
      }

      const hasPaymentMethod = paymentColumns.some((col) => col.name === 'payment_method');
      if (!hasPaymentMethod) {
        db.exec("ALTER TABLE payments ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cash';");
      }

      // Safe migration policy for existing payments:
      // In the pre-existing system, payments were attributed to the calendar month of payment_date.
      // Infer billing_month from substr(payment_date, 1, 7) for existing records.
      db.exec(`
        UPDATE payments
        SET billing_month = substr(payment_date, 1, 7)
        WHERE billing_month IS NULL;

        UPDATE payments
        SET confirmed_at = created_at
        WHERE confirmed_at IS NULL AND status = 'confirmed';
      `);

      const studentColumns = db.prepare('PRAGMA table_info(students)').all();
      const hasEnrollmentDate = studentColumns.some((col) => col.name === 'enrollment_date');
      if (!hasEnrollmentDate) {
        db.exec('ALTER TABLE students ADD COLUMN enrollment_date TEXT;');
      }

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_payments_student_billing_status ON payments (student_id, billing_month, status);
        CREATE INDEX IF NOT EXISTS idx_payments_billing_month ON payments (billing_month);
      `);
    }
  },
  {
    version: '006_create_receipts_table',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS receipts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          receipt_number TEXT NOT NULL UNIQUE CHECK (length(trim(receipt_number)) > 0),
          payment_id INTEGER NOT NULL UNIQUE REFERENCES payments(id) ON DELETE RESTRICT,
          student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
          amount INTEGER NOT NULL CHECK (amount > 0 AND amount <= 9007199254740991),
          billing_month TEXT NOT NULL CHECK (billing_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
          issued_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        ) STRICT;

        CREATE INDEX IF NOT EXISTS idx_receipts_student_id ON receipts (student_id);
        CREATE INDEX IF NOT EXISTS idx_receipts_payment_id ON receipts (payment_id);
        CREATE INDEX IF NOT EXISTS idx_receipts_number ON receipts (receipt_number);
      `);
    }
  }
];
