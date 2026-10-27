# Project Pay

Project Pay is an internal student tuition and payment management web application for an educational training center, built for the Ecomdev developer assignment. It manages students, study groups, tuition payment records, and monthly debtor reports from a single same-origin Node.js application.

## Main Features

- **Student Management (CRUD)**: Create, list, search (by name or phone), view, partially update, and delete student records with `full_name`, optional `phone`, optional `group_id` assignment, and integer `monthly_fee` (in UZS). Students with recorded payment history are protected from deletion (`409 Conflict`).
- **Study Groups**: Create, rename, list, inspect group rosters, and delete empty groups. Case-insensitive unique group names and foreign-key restrictions prevent deleting groups that still have assigned students.
- **Payment Recording & Per-Student History**: Record positive integer payments (`UZS`) on validated calendar dates (`YYYY-MM-DD`, including leap-year rules) and inspect chronological per-student payment history.
- **Monthly Debtor Report**: Compute outstanding balances for any `YYYY-MM` month (`debt = monthly_fee - total_paid` where `total_paid < monthly_fee`), exposed at both `GET /debtors?month=YYYY-MM` and `GET /api/reports/debtors?month=YYYY-MM`.
- **Responsive Web Interface**: Lightweight Uzbek (Latin) single-page dashboard with accessible searchable student and group comboboxes, mobile navigation drawer, and horizontally scrollable data tables.

## Technology Stack

- **Runtime**: Node.js (ES Modules, `"type": "module"`, Node.js 24 LTS recommended)
- **HTTP Server**: Express 5 (`express@^5.3.0`)
- **Database**: SQLite via `better-sqlite3` (`better-sqlite3@^13.0.3`)
- **Validation**: Zod (`zod@^4.6.7`)
- **Frontend**: Vanilla HTML5, CSS3, and browser ES Modules served statically by Express on the same origin (`public/`)
- **Testing**: Node.js built-in test runner (`node:test` and `node:assert/strict`)

## Prerequisites & Installation

- **Node.js**: v22+ or v24 LTS (with native `fetch` and `node:test` support)
- **npm**: Included with Node.js

Install dependencies from the project root:

```bash
# macOS / Linux
npm install

# Windows PowerShell (use npm.cmd if PowerShell script execution policy restricts npm.ps1)
npm.cmd install
```

## Configuration & Environment Variables

Configuration is read in `src/server.js` with sensible defaults so no `.env` file is required to run locally:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | TCP port on which the Express HTTP server listens. |
| `DATABASE_PATH` | `project_pay.db` | Path to the SQLite database file (or `:memory:` for ephemeral in-memory execution). |

Example with custom configuration:

```bash
# macOS / Linux
PORT=4000 DATABASE_PATH=./data/pay.db npm start

# Windows PowerShell
$env:PORT="4000"; $env:DATABASE_PATH="./data/pay.db"; npm.cmd start

# Windows Command Prompt
set PORT=4000 && set DATABASE_PATH=./data/pay.db && npm.cmd start
```

## Running the Application

Start the server (initializes/migrates the SQLite database automatically if needed and serves both the API and web UI):

```bash
# Standard startup (Linux/macOS)
npm start

# Standard startup (Windows PowerShell)
npm.cmd start

# Development startup
npm run dev
# Windows: npm.cmd run dev
```

Once running, open `http://localhost:3000` in your browser.

## Running Tests

Run the full automated unit and API integration test suite (uses isolated in-memory and temporary SQLite databases without touching `project_pay.db`):

```bash
# Unit & API Integration Tests (263 passing tests)
npm test
# Windows: npm.cmd test

# End-to-End Real Browser Tests (Firefox WebDriver BiDi, 10 passing workflows)
npm run test:e2e
# Windows: npm.cmd run test:e2e

# Synthetic Load & Concurrency Benchmark
npm run test:load
# Windows: npm.cmd run test:load
```

## API Reference

All request and response bodies use `application/json`. Monetary amounts (`monthly_fee`, `amount`, `total_paid`, `debt`) must be safe integers (UZS) — floating-point values and string numbers are rejected without silent coercion.

### Debtors & Reporting Endpoints

- **`GET /debtors?month=YYYY-MM`** *(also available at `GET /api/reports/debtors?month=YYYY-MM`)*
  - **Query Parameters**: `month` (required, canonical `YYYY-MM` format with month `01`–`12`, e.g. `2026-10`).
  - **Behavior**: Sums each student's payments with `payment_date` in `[YYYY-MM-01, nextMonth-01)` and returns only students whose `total_paid < monthly_fee`. Students with `monthly_fee = 0` (scholarship/free) and students who paid in full or overpaid are excluded. Excess payments from other months do not carry forward. Includes `Cache-Control: no-store` to prevent stale browser responses.
  - **Responses**:
    - `200 OK`: `[{ "id": 1, "student_id": 1, "full_name": "Alisher Navoiy", "monthly_fee": 500000, "total_paid": 200000, "debt": 300000 }]`
    - `400 Bad Request`: Missing or malformed `month` parameter.

- **`GET /api/reports/annual?year=YYYY`**
  - **Query Parameters**: `year` (required, canonical 4-digit year `1900`–`2100`, e.g. `2026`).
  - **Behavior**: Returns the calendar-year financial summary and complete 12-month breakdown (Yanvar through Dekabr) using underlying payment records. Includes total cash collected, payment transaction counts, unique paying students, active students, and monthly expected vs. outstanding debt figures.
  - **Responses**:
    - `200 OK`:
      ```json
      {
        "year": 2026,
        "total_collected": 1500000,
        "payment_count": 4,
        "paying_student_count": 2,
        "active_students_count": 2,
        "total_expected_year": 12000000,
        "total_debt_year": 10500000,
        "months": [
          {
            "month": "2026-01",
            "month_name": "Yanvar",
            "month_index": 1,
            "total_collected": 0,
            "payment_count": 0,
            "paying_student_count": 0,
            "debtor_count": 2,
            "fully_paid_count": 0,
            "total_expected": 1000000,
            "total_debt": 1000000
          }
        ]
      }
      ```
    - `400 Bad Request`: Missing or invalid `year` parameter.

## Reporting Methodology & Data Model Definitions

### 1. Monthly Debtor Calculation
- **Period Attribution**: A payment is attributed strictly to the calendar month of its recorded `payment_date` (`[YYYY-MM-01, YYYY-MM-lastDay]`).
- **Student Debt**: Calculated per fee-paying student (`monthly_fee > 0`) as `debt = MAX(0, s.monthly_fee - total_paid_in_month)`.
- **Debtor Inclusion**: A student is included in the debtor list if and only if `s.monthly_fee > 0` AND their payments with `payment_date` in that month sum to `< s.monthly_fee`.
- **Independence Across Months**: Each calendar month is calculated independently. Overpayments in one month do not roll over as credit into subsequent or prior months.

### 2. Annual Financial Reporting
- **Actual Cash Collections**: `total_collected` reflects the exact sum of all payment amounts recorded with `payment_date` within `[YYYY-01-01, YYYY-12-31]`.
- **12-Month Calendar Breakdown**: All 12 months (January to December) are explicitly represented in chronological order. Months with zero activity display `total_collected: 0` without fabricating records or crashing.
- **Expected Tuition & Debt in Annual View**: Calculated from registered fee-paying students.

### 3. Historical Data Limitations
- **Current Active Rate Basis**: In the Project Pay schema, students have an active `monthly_fee` integer column; historical tuition rate revisions and explicit enrollment start/end dates are not versioned in the database schema. Therefore, monthly debt and expected amounts reflect current active fee rates against actual payments recorded in that period.
- **Cash-Basis Date Attribution**: Payments record `payment_date` (the calendar date cash was received) rather than an explicit `billing_month` (the target tuition period). All financial aggregation reports this distinction transparently in the UI notice banner.

### Students

- **`GET /api/students`** — Returns all students ordered by `id ASC` (`id`, `full_name`, `phone`, `monthly_fee`, `created_at`, `group_id`, `group_name`).
- **`POST /api/students`** — Creates a student.
  - Body: `{ "full_name": "Alisher Navoiy", "phone": "+998 90 123 45 67", "monthly_fee": 500000, "group_id": 1 }` (`phone` and `group_id` are optional and nullable; blank `phone` strings normalize to `null`; unknown keys return `400`).
- **`GET /api/students/:id`** — Returns a single student or `404 Not Found`.
- **`PATCH /api/students/:id`** — Partially updates one or more of `full_name`, `phone`, `monthly_fee`, `group_id`. Passing `"phone": null` (or `""`) clears the phone number; passing `"group_id": null` unassigns the group.
- **`DELETE /api/students/:id`** — Deletes a student without payments (`200 OK`), or returns `409 Conflict` if the student has payment records.
- **`GET /api/students/:id/payments`** — Returns chronological payments (`payment_date ASC, id ASC`) for the specified student, or `404 Not Found` if the student does not exist.

### Payments

- **`POST /api/payments`** — Records a payment.
  - Body: `{ "student_id": 1, "amount": 250000, "payment_date": "2026-10-15" }`
  - Validates strictly positive safe integer `amount` and real calendar date (rejects impossible dates such as `2026-02-30` or `2023-02-29`). Returns `201 Created` or `404 Not Found` if the student does not exist.

### Groups

- **`GET /api/groups`** — Lists all groups ordered case-insensitively by name, including `student_count`.
- **`POST /api/groups`** — Creates a group (`{ "name": "Frontend 101" }`). Returns `409 Conflict` on case-insensitive duplicate name.
- **`GET /api/groups/:id`** — Returns a single group with `student_count` or `404 Not Found`.
- **`GET /api/groups/:id/students`** — Lists students assigned to the group or `404 Not Found`.
- **`PATCH /api/groups/:id`** — Renames a group (`{ "name": "Frontend Advanced" }`).
- **`DELETE /api/groups/:id`** — Deletes an empty group (`200 OK`), or returns `409 Conflict` if students are still assigned.

## Database & Migration Behavior

- **Foreign Keys & Durability**: Every connection created by `createDatabase()` enables and verifies `PRAGMA foreign_keys = ON`. File-backed databases automatically enable `PRAGMA journal_mode = WAL`.
- **SQLite `STRICT` Schema & Constraints**: Tables (`students`, `groups`, `payments`, `schema_migrations`) use SQLite `STRICT` mode alongside `CHECK` constraints for non-empty names, safe integer bounds, canonical calendar dates (`date(payment_date) = payment_date`), and `ON DELETE RESTRICT` foreign keys.
- **Automatic Idempotent Migrations**: Calling `initDatabase(db)` runs pending migrations inside a single SQLite transaction and records applied versions in `schema_migrations`:
  1. `001_initial_schema` — Creates `students`, `payments`, and payment indexes.
  2. `002_harden_constraints` — Upgrades legacy `payments` tables to enforce SQLite calendar date checks.
  3. `003_add_groups_table` — Creates `groups` and adds `group_id` foreign key + index to `students`.
  4. `004_add_student_phone` — Adds nullable `phone TEXT` column to `students` while preserving all existing records.

## Future Improvements

1. **Authentication & Role-Based Access Control (RBAC)**: Add session-based staff authentication (administrator vs. cashier roles) and an immutable audit log recording who created or updated student fees and payments.
2. **Enrollment Lifecycle & Effective-Dated Tuition History**: Track student enrollment start/end dates (`active` / `paused` / `graduated`) and effective-dated fee changes so historical debtor queries reflect the exact tuition rate a student owed in past months.
3. **Explicit Target-Month Allocation & Payment Adjustments**: Separate `payment_date` (when cash was received) from `billing_month` (which month's tuition is being paid) so advance payments or late arrears settle the intended month accurately, alongside void/refund ledger entries.
4. **Automated Telegram / SMS Debtor Reminders**: Connect a Telegram bot or local SMS gateway using the student `phone` field to send automated payment receipts and monthly balance reminders.
5. **Server-Side Pagination & CSV/XLSX Exports**: Add cursor/offset pagination for large student and payment histories, plus one-click CSV/Excel exports of monthly debtor and collection reports for accounting reconciliation.
