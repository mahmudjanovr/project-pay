import test from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db/connection.js';
import { initDatabase } from '../src/db/init.js';
import {
  listGroups,
  getGroupById,
  createGroup,
  updateGroup,
  deleteGroup
} from '../src/services/groups.js';
import {
  createStudent,
  getStudentById,
  listStudents,
  updateStudent,
  deleteStudent
} from '../src/services/students.js';
import { createPayment } from '../src/services/payments.js';
import { getMonthlyDebtors } from '../src/services/debtors.js';
import {
  validateGroupName,
  validateGroupInput,
  validateUpdateGroupInput,
  groupIdSchema,
  createStudentSchema,
  updateStudentSchema
} from '../src/validators/index.js';

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

test('Groups Database Schema and Migration Integrity', async (t) => {
  const db = createDatabase(':memory:');
  initDatabase(db);

  await t.test('groups table exists with STRICT mode and required columns', () => {
    const tableInfo = db.prepare(`PRAGMA table_info(groups)`).all();
    const colNames = tableInfo.map((c) => c.name);
    assert.ok(colNames.includes('id'));
    assert.ok(colNames.includes('name'));
    assert.ok(colNames.includes('created_at'));

    // Check table creation SQL contains STRICT
    const masterRow = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'groups'"
    ).get();
    assert.ok(masterRow.sql.includes('STRICT'));
  });

  await t.test('students table has group_id column and foreign key index exists', () => {
    const tableInfo = db.prepare(`PRAGMA table_info(students)`).all();
    const colNames = tableInfo.map((c) => c.name);
    assert.ok(colNames.includes('group_id'));

    const indexes = db.prepare(`PRAGMA index_list(students)`).all();
    const indexNames = indexes.map((i) => i.name);
    assert.ok(indexNames.includes('idx_students_group_id'));
  });

  await t.test('enforces non-empty name CHECK constraint on groups', () => {
    assert.throws(
      () => {
        db.prepare("INSERT INTO groups (name) VALUES ('')").run();
      },
      (err) => err.message.includes('CHECK constraint failed')
    );

    assert.throws(
      () => {
        db.prepare("INSERT INTO groups (name) VALUES ('   ')").run();
      },
      (err) => err.message.includes('CHECK constraint failed')
    );
  });

  await t.test('enforces case-insensitive UNIQUE constraint on groups name', () => {
    db.prepare("INSERT INTO groups (name) VALUES ('Node.js Bootcamp')").run();

    assert.throws(
      () => {
        db.prepare("INSERT INTO groups (name) VALUES ('node.js bootcamp')").run();
      },
      (err) => err.message.includes('UNIQUE constraint failed: groups.name')
    );

    assert.throws(
      () => {
        db.prepare("INSERT INTO groups (name) VALUES ('NODE.JS BOOTCAMP')").run();
      },
      (err) => err.message.includes('UNIQUE constraint failed: groups.name')
    );
  });

  await t.test('direct SQL insertion with non-existent group_id fails foreign key constraint', () => {
    assert.throws(
      () => {
        db.prepare(
          "INSERT INTO students (full_name, monthly_fee, group_id) VALUES ('Invalid Student', 500000, 99999)"
        ).run();
      },
      (err) => err.message.includes('FOREIGN KEY constraint failed')
    );
  });

  await t.test('direct SQL deletion of group with assigned students fails ON DELETE RESTRICT', () => {
    const group = db.prepare("INSERT INTO groups (name) VALUES ('SQL Restricted Group')").run();
    const gId = Number(group.lastInsertRowid);
    db.prepare(
      "INSERT INTO students (full_name, monthly_fee, group_id) VALUES ('Assigned Student', 500000, ?)"
    ).run(gId);

    assert.throws(
      () => {
        db.prepare('DELETE FROM groups WHERE id = ?').run(gId);
      },
      (err) => err.message.includes('FOREIGN KEY constraint failed')
    );
  });

  await t.test('migration upgrades existing database containing students and payments smoothly', () => {
    // Spin up a fresh database simulating pre-migration 003 state
    const oldDb = createDatabase(':memory:');
    oldDb.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        version TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ) STRICT;

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
        payment_date TEXT NOT NULL CHECK (
          payment_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'
          AND date(payment_date) = payment_date
        ),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ) STRICT;

      INSERT INTO _migrations (version) VALUES ('001_create_students_and_payments');
      INSERT INTO _migrations (version) VALUES ('002_harden_financial_and_date_integrity');

      INSERT INTO students (full_name, monthly_fee) VALUES ('Existing Student', 1200000);
      INSERT INTO payments (student_id, amount, payment_date) VALUES (1, 1200000, '2026-05-10');
    `);

    // Run migration
    initDatabase(oldDb);

    // Verify existing student and payment still exist
    const student = oldDb.prepare('SELECT * FROM students WHERE id = 1').get();
    assert.equal(student.full_name, 'Existing Student');
    assert.equal(student.monthly_fee, 1200000);
    assert.equal(student.group_id, null);

    const payment = oldDb.prepare('SELECT * FROM payments WHERE id = 1').get();
    assert.equal(payment.amount, 1200000);

    // Verify group can now be created and assigned to the existing student
    oldDb.prepare("INSERT INTO groups (name) VALUES ('Migrated Group')").run();
    oldDb.prepare('UPDATE students SET group_id = 1 WHERE id = 1').run();

    const updatedStudent = oldDb.prepare('SELECT * FROM students WHERE id = 1').get();
    assert.equal(updatedStudent.group_id, 1);
  });
});

test('Group Validation Schemas', async (t) => {
  await t.test('validateGroupName accepts valid names and trims whitespace', () => {
    assert.equal(validateGroupName('Backend Engineering'), 'Backend Engineering');
    assert.equal(validateGroupName('   Frontend 101   '), 'Frontend 101');
  });

  await t.test('validateGroupName rejects empty, whitespace, and non-string values', () => {
    assert.throws(() => validateGroupName(''));
    assert.throws(() => validateGroupName('   '));
    assert.throws(() => validateGroupName(null));
    assert.throws(() => validateGroupName(123));
  });

  await t.test('validateGroupInput enforces object structure and rejects extra fields', () => {
    assert.deepEqual(validateGroupInput({ name: 'DevOps 1' }), { name: 'DevOps 1' });
    assert.throws(() => validateGroupInput({ name: 'DevOps 1', extra: 'bad' }));
    assert.throws(() => validateGroupInput({}));
  });

  await t.test('validateUpdateGroupInput validates group rename payload', () => {
    assert.deepEqual(validateUpdateGroupInput({ name: 'QA Automation' }), { name: 'QA Automation' });
    assert.throws(() => validateUpdateGroupInput({ name: '' }));
    assert.throws(() => validateUpdateGroupInput({}));
  });

  await t.test('groupIdSchema accepts positive safe integers and null', () => {
    assert.equal(groupIdSchema.parse(1), 1);
    assert.equal(groupIdSchema.parse(100), 100);
    assert.equal(groupIdSchema.parse(null), null);
    assert.throws(() => groupIdSchema.parse(0));
    assert.throws(() => groupIdSchema.parse(-1));
    assert.throws(() => groupIdSchema.parse(1.5));
    assert.throws(() => groupIdSchema.parse('1'));
    assert.throws(() => groupIdSchema.parse(Number.MAX_SAFE_INTEGER + 1));
  });

  await t.test('createStudentSchema and updateStudentSchema accept group_id', () => {
    const validWithGroup = createStudentSchema.parse({
      full_name: 'Jasur Bek',
      monthly_fee: 500000,
      group_id: 2
    });
    assert.equal(validWithGroup.group_id, 2);

    const validNullGroup = createStudentSchema.parse({
      full_name: 'Jasur Bek',
      monthly_fee: 500000,
      group_id: null
    });
    assert.equal(validNullGroup.group_id, null);

    const validOmittedGroup = createStudentSchema.parse({
      full_name: 'Jasur Bek',
      monthly_fee: 500000
    });
    assert.equal(validOmittedGroup.group_id, undefined);

    // Update with group_id only
    const updateOnlyGroup = updateStudentSchema.parse({ group_id: 3 });
    assert.equal(updateOnlyGroup.group_id, 3);

    // Update unassigning group
    const unassign = updateStudentSchema.parse({ group_id: null });
    assert.equal(unassign.group_id, null);
  });
});

test('Group Services Layer', async (t) => {
  const db = createDatabase(':memory:');
  initDatabase(db);

  await t.test('listGroups returns empty array when no groups exist', () => {
    const list = listGroups(db);
    assert.deepEqual(list, []);
  });

  await t.test('createGroup creates group with trimmed name and student_count = 0', () => {
    const group1 = createGroup(db, { name: '  Python Backend  ' });
    assert.ok(group1.id > 0);
    assert.equal(group1.name, 'Python Backend');
    assert.equal(group1.student_count, 0);
    assert.ok(group1.created_at.endsWith('Z'));

    const group2 = createGroup(db, { name: 'React Frontend' });
    assert.ok(group2.id > group1.id);
  });

  await t.test('createGroup rejects duplicate group name case-insensitively', () => {
    assert.throws(
      () => createGroup(db, { name: 'python backend' }),
      (err) => err.message.includes('UNIQUE constraint failed')
    );
  });

  await t.test('getGroupById returns group with student_count or null', () => {
    const group = getGroupById(db, 1);
    assert.ok(group);
    assert.equal(group.name, 'Python Backend');
    assert.equal(group.student_count, 0);

    const nonExistent = getGroupById(db, 9999);
    assert.equal(nonExistent, null);
  });

  await t.test('updateGroup renames group and rejects duplicates', () => {
    const updated = updateGroup(db, 1, { name: 'Python Advanced' });
    assert.equal(updated.name, 'Python Advanced');
    assert.equal(updated.id, 1);

    // Reject renaming to existing group 2
    assert.throws(
      () => updateGroup(db, 1, { name: 'react frontend' }),
      (err) => err.message.includes('UNIQUE constraint failed')
    );

    // Return null for non-existent group
    const nonExistent = updateGroup(db, 9999, { name: 'Ghost' });
    assert.equal(nonExistent, null);
  });

  await t.test('deleteGroup deletes empty group successfully', () => {
    const newGroup = createGroup(db, { name: 'Temporary Group' });
    const result = deleteGroup(db, newGroup.id);
    assert.equal(result.found, true);
    assert.equal(result.deleted, true);
    assert.equal(result.hasStudents, false);

    assert.equal(getGroupById(db, newGroup.id), null);

    // Deleting non-existent returns found: false
    const nonExistent = deleteGroup(db, 9999);
    assert.equal(nonExistent.found, false);
    assert.equal(nonExistent.deleted, false);
  });

  await t.test('deleteGroup prevents deletion of group with assigned students', () => {
    // Assign student to group 1
    createStudent(db, {
      full_name: 'Temur Aliyev',
      monthly_fee: 1000000,
      group_id: 1
    });

    const group1 = getGroupById(db, 1);
    assert.equal(group1.student_count, 1);

    const deleteResult = deleteGroup(db, 1);
    assert.equal(deleteResult.found, true);
    assert.equal(deleteResult.deleted, false);
    assert.equal(deleteResult.hasStudents, true);
    assert.equal(deleteResult.student_count, 1);

    // Ensure group 1 still exists
    assert.ok(getGroupById(db, 1));
  });
});

test('Student and Group Service Integration', async (t) => {
  const db = createDatabase(':memory:');
  initDatabase(db);

  const groupA = createGroup(db, { name: 'Guruh A' });
  const groupB = createGroup(db, { name: 'Guruh B' });

  await t.test('createStudent with group_id assigns group and returns group_name', () => {
    const student = createStudent(db, {
      full_name: 'Dilshod Raximov',
      monthly_fee: 800000,
      group_id: groupA.id
    });

    assert.equal(student.group_id, groupA.id);
    assert.equal(student.group_name, 'Guruh A');

    const fetched = getStudentById(db, student.id);
    assert.equal(fetched.group_id, groupA.id);
    assert.equal(fetched.group_name, 'Guruh A');
  });

  await t.test('createStudent without group_id sets group_id and group_name to null', () => {
    const student = createStudent(db, {
      full_name: 'Madina Umarova',
      monthly_fee: 900000
    });

    assert.equal(student.group_id, null);
    assert.equal(student.group_name, null);
  });

  await t.test('listStudents includes group_id and group_name for all students', () => {
    const list = listStudents(db);
    assert.equal(list.length, 2);
    assert.equal(list[0].group_name, 'Guruh A');
    assert.equal(list[1].group_name, null);
  });

  await t.test('updateStudent can reassign, unassign, or preserve group_id', () => {
    // Reassign Madina to group B
    const updated1 = updateStudent(db, 2, { group_id: groupB.id });
    assert.equal(updated1.group_id, groupB.id);
    assert.equal(updated1.group_name, 'Guruh B');

    // Unassign Dilshod from group A
    const updated2 = updateStudent(db, 1, { group_id: null });
    assert.equal(updated2.group_id, null);
    assert.equal(updated2.group_name, null);

    // Update only name, group remains unchanged
    const updated3 = updateStudent(db, 2, { full_name: 'Madina Saidova' });
    assert.equal(updated3.full_name, 'Madina Saidova');
    assert.equal(updated3.group_id, groupB.id);
    assert.equal(updated3.group_name, 'Guruh B');
  });

  await t.test('deleting student unassigns student from group without deleting group', () => {
    // Madina is in group B. Delete Madina.
    const groupBefore = getGroupById(db, groupB.id);
    assert.equal(groupBefore.student_count, 1);

    deleteStudent(db, 2);

    const groupAfter = getGroupById(db, groupB.id);
    assert.ok(groupAfter);
    assert.equal(groupAfter.student_count, 0);
  });
});

test('Financial Calculations and Debtor Reports Independence from Groups', async (t) => {
  const db = createDatabase(':memory:');
  initDatabase(db);

  const groupWeb = createGroup(db, { name: 'Web Dev' });
  const groupMobile = createGroup(db, { name: 'Mobile Dev' });

  // Student 1: in Web Dev, 1,000,000 fee, paid 600,000 in May 2026 -> debt 400,000
  const s1 = createStudent(db, { full_name: 'Student 1', monthly_fee: 1000000, group_id: groupWeb.id });
  createPayment(db, { student_id: s1.id, amount: 600000, payment_date: '2026-05-05' });

  // Student 2: in Mobile Dev, 1,200,000 fee, paid 1,200,000 in May 2026 -> no debt (0)
  const s2 = createStudent(db, { full_name: 'Student 2', monthly_fee: 1200000, group_id: groupMobile.id });
  createPayment(db, { student_id: s2.id, amount: 1200000, payment_date: '2026-05-15' });

  // Student 3: no group, 800,000 fee, paid 0 in May 2026 -> debt 800,000
  const s3 = createStudent(db, { full_name: 'Student 3', monthly_fee: 800000, group_id: null });

  const debtors = getMonthlyDebtors(db, '2026-05');
  assert.equal(debtors.length, 2);

  const d1 = debtors.find((d) => d.student_id === s1.id);
  assert.ok(d1);
  assert.equal(d1.monthly_fee, 1000000);
  assert.equal(d1.total_paid, 600000);
  assert.equal(d1.debt, 400000);

  const d3 = debtors.find((d) => d.student_id === s3.id);
  assert.ok(d3);
  assert.equal(d3.monthly_fee, 800000);
  assert.equal(d3.total_paid, 0);
  assert.equal(d3.debt, 800000);

  // Student 2 has 0 debt and must not appear
  assert.equal(debtors.some((d) => d.student_id === s2.id), false);
});

test('Groups API Endpoints', async (t) => {
  const ctx = createTestContext();
  t.after(() => ctx.close());

  let testGroupId;

  await t.test('GET /api/groups initially returns empty array', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/groups`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.deepEqual(data, []);
  });

  await t.test('POST /api/groups creates a group and trims name', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '   Foundation English   ' })
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.ok(data.id > 0);
    assert.equal(data.name, 'Foundation English');
    assert.equal(data.student_count, 0);
    assert.ok(data.created_at.endsWith('Z'));
    testGroupId = data.id;
  });

  await t.test('POST /api/groups rejects invalid names and empty inputs', async () => {
    // Empty name
    const res1 = await fetch(`${ctx.baseUrl}/api/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '    ' })
    });
    assert.equal(res1.status, 400);

    // Missing name
    const res2 = await fetch(`${ctx.baseUrl}/api/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(res2.status, 400);

    // Extra unknown field
    const res3 = await fetch(`${ctx.baseUrl}/api/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Valid Name', extra: 123 })
    });
    assert.equal(res3.status, 400);
  });

  await t.test('POST /api/groups rejects duplicate name with 409 Conflict', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'foundation english' })
    });

    assert.equal(res.status, 409);
    const data = await res.json();
    assert.equal(data.error, 'Conflict');
    assert.ok(data.message.includes('already exists'));
  });

  await t.test('GET /api/groups lists created groups with student_count', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/groups`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.length, 1);
    assert.equal(data[0].id, testGroupId);
    assert.equal(data[0].name, 'Foundation English');
    assert.equal(data[0].student_count, 0);
  });

  await t.test('PATCH /api/groups/:id renames group', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/groups/${testGroupId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Advanced English' })
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.id, testGroupId);
    assert.equal(data.name, 'Advanced English');
  });

  await t.test('PATCH /api/groups/:id returns 404 for non-existent group', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/groups/99999`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Ghost Group' })
    });

    assert.equal(res.status, 404);
  });

  await t.test('PATCH /api/groups/:id returns 409 when renaming to existing group name', async () => {
    // Create second group
    const res2 = await fetch(`${ctx.baseUrl}/api/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'IELTS Prep' })
    });
    const group2 = await res2.json();

    // Try renaming group 2 to Advanced English (case-insensitive)
    const patchRes = await fetch(`${ctx.baseUrl}/api/groups/${group2.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'advanced english' })
    });
    assert.equal(patchRes.status, 409);
  });

  await t.test('POST /api/students accepts group_id and reflects group_name', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Olim Vohidov',
        monthly_fee: 750000,
        group_id: testGroupId
      })
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.group_id, testGroupId);
    assert.equal(data.group_name, 'Advanced English');
  });

  await t.test('POST /api/students rejects non-existent group_id with 400 Bad Request', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Stranger',
        monthly_fee: 500000,
        group_id: 99999
      })
    });

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.message.includes('Referenced group does not exist') || data.error === 'Bad Request');
  });

  await t.test('PATCH /api/students/:id rejects non-existent group_id with 400 Bad Request', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/students/1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        group_id: 99999
      })
    });

    assert.equal(res.status, 400);
  });

  await t.test('DELETE /api/groups/:id returns 409 Conflict when group has students', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/groups/${testGroupId}`, {
      method: 'DELETE'
    });

    assert.equal(res.status, 409);
    const data = await res.json();
    assert.equal(data.error, 'Conflict');
    assert.ok(data.message.includes('Cannot delete group with assigned students'));
  });

  await t.test('PATCH /api/students/:id unassigns group, then DELETE /api/groups/:id succeeds', async () => {
    // Unassign student 1 from testGroupId
    const patchRes = await fetch(`${ctx.baseUrl}/api/students/1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_id: null })
    });
    assert.equal(patchRes.status, 200);
    const updatedStudent = await patchRes.json();
    assert.equal(updatedStudent.group_id, null);
    assert.equal(updatedStudent.group_name, null);

    // Now testGroupId has 0 students and can be deleted
    const deleteRes = await fetch(`${ctx.baseUrl}/api/groups/${testGroupId}`, {
      method: 'DELETE'
    });
    assert.equal(deleteRes.status, 200);
    const deleteData = await deleteRes.json();
    assert.equal(deleteData.success, true);

    // Verify it is gone
    const getRes = await fetch(`${ctx.baseUrl}/api/groups`);
    const remaining = await getRes.json();
    assert.equal(remaining.some((g) => g.id === testGroupId), false);
  });

  await t.test('DELETE /api/groups/:id returns 404 for non-existent group', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/groups/99999`, {
      method: 'DELETE'
    });
    assert.equal(res.status, 404);
  });

  await t.test('DELETE /api/groups/:id returns 400 for invalid ID parameter', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/groups/invalid_id`, {
      method: 'DELETE'
    });
    assert.equal(res.status, 400);
  });

  await t.test('PATCH /api/groups/:id returns 400 for invalid ID parameter', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/groups/invalid_id`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Name' })
    });
    assert.equal(res.status, 400);
  });

  await t.test('GET /api/students and GET /api/students/:id include group information', async () => {
    // Create new group
    const gRes = await fetch(`${ctx.baseUrl}/api/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Cybersecurity' })
    });
    const group = await gRes.json();

    // Assign student 1 to Cybersecurity
    await fetch(`${ctx.baseUrl}/api/students/1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_id: group.id })
    });

    // Check GET /api/students/:id
    const sRes = await fetch(`${ctx.baseUrl}/api/students/1`);
    assert.equal(sRes.status, 200);
    const student = await sRes.json();
    assert.equal(student.group_id, group.id);
    assert.equal(student.group_name, 'Cybersecurity');

    // Check GET /api/students
    const listRes = await fetch(`${ctx.baseUrl}/api/students`);
    assert.equal(listRes.status, 200);
    const list = await listRes.json();
    const found = list.find((s) => s.id === 1);
    assert.ok(found);
    assert.equal(found.group_id, group.id);
    assert.equal(found.group_name, 'Cybersecurity');
  });
});
