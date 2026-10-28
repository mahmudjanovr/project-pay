# Ecomdev

Ecomdev is an internal student tuition and payment management web application for an educational training center, built for the Ecomdev developer assignment. It manages students, study groups, tuition payment records, and monthly debtor reports from a single same-origin Node.js application.

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

- **Node.js**: v22+ or v24 LTS (with native `fetch` and `node:test` support, plus build tools if `better-sqlite3` compiles from source on your platform)
- **npm**: Included with Node.js

Install dependencies from the project root:

```bash
npm install
```

## Configuration & Environment Variables

Configuration is read in `src/server.js` with sensible defaults so no `.env` file is required to run locally:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | TCP port on which the Express HTTP server listens. |
| `DATABASE_PATH` | `project_pay.db` | Path to the SQLite database file (or `:memory:` for ephemeral in-memory execution). |

Example with custom configuration:

```bash
PORT=4000 DATABASE_PATH=./data/pay.db npm start
```

## Running the Application

Start the server (initializes/migrates the SQLite database automatically if needed and serves both the API and web UI):

```bash
# Production / standard startup
npm start

# Development startup
npm run dev
```

Once running, open `http://localhost:3000` in your browser.

## Running Tests

Run the full automated unit and API integration test suite (uses isolated in-memory and temporary SQLite databases without touching `project_pay.db`):

```bash
npm test
```

## API Reference

All request and response bodies use `application/json`. Monetary amounts (`monthly_fee`, `amount`, `total_paid`, `debt`) must be safe integers (UZS) — floating-point values and string numbers are rejected without silent coercion.

### Debtors Report

- **`GET /debtors?month=YYYY-MM`** *(also available at `GET /api/reports/debtors?month=YYYY-MM`)*
  - **Query Parameters**: `month` (required, canonical `YYYY-MM` format with month `01`–`12`, e.g. `2026-10`).
  - **Behavior**: Sums each student's payments with `payment_date` in `[YYYY-MM-01, nextMonth-01)` and returns only students whose `total_paid < monthly_fee`. Students with `monthly_fee = 0` (scholarship/free) and students who paid in full or overpaid are excluded. Excess payments from other months do not carry forward.
  - **Responses**:
    - `200 OK`: `[{ "id": 1, "student_id": 1, "full_name": "Alisher Navoiy", "monthly_fee": 500000, "total_paid": 200000, "debt": 300000 }]`
    - `400 Bad Request`: Missing or malformed `month` parameter.

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
