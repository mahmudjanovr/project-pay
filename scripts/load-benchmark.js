#!/usr/bin/env node
/**
 * Configurable Synthetic Dataset & Load/Performance Benchmark for Ecomdev.
 *
 * Safety guarantees:
 * - Always creates isolated temporary SQLite databases inside os.tmpdir().
 * - Never touches or opens project_pay.db.
 * - Automatically removes temporary directories on exit.
 *
 * Usage:
 *   node scripts/load-benchmark.js
 *   node scripts/load-benchmark.js --scales=small,medium,large,xl --samples=40 --concurrency=20
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import { createDatabase } from '../src/db/connection.js';
import { initDatabase } from '../src/db/init.js';
import { startServer } from '../src/server.js';
import { MONTHLY_DEBTORS_QUERY } from '../src/services/debtors.js';

const SCENARIOS = {
  small: { name: 'Small baseline', studentCount: 100, groupCount: 10, paymentCount: 1_000 },
  medium: { name: 'Medium', studentCount: 1_000, groupCount: 50, paymentCount: 10_000 },
  large: { name: 'Large', studentCount: 10_000, groupCount: 200, paymentCount: 100_000 },
  xl: { name: 'Extended XL', studentCount: 25_000, groupCount: 500, paymentCount: 250_000 }
};

function parseArgs(argv) {
  const opts = {
    scales: ['small', 'medium', 'large', 'xl'],
    samples: 40,
    concurrency: 20,
    jsonOnly: false
  };

  for (const arg of argv) {
    if (arg.startsWith('--scales=')) {
      opts.scales = arg
        .slice('--scales='.length)
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s in SCENARIOS);
    } else if (arg.startsWith('--samples=')) {
      const n = parseInt(arg.slice('--samples='.length), 10);
      if (Number.isSafeInteger(n) && n > 0) opts.samples = n;
    } else if (arg.startsWith('--concurrency=')) {
      const n = parseInt(arg.slice('--concurrency='.length), 10);
      if (Number.isSafeInteger(n) && n > 0) opts.concurrency = n;
    } else if (arg === '--json') {
      opts.jsonOnly = true;
    }
  }
  return opts;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function nextRandom() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  const idx = Math.min(sortedArr.length - 1, Math.ceil((p / 100) * sortedArr.length) - 1);
  return Number(sortedArr[Math.max(0, idx)].toFixed(2));
}

function summarizeTimings(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    samples: sorted.length,
    minMs: Number(sorted[0].toFixed(2)),
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
    maxMs: Number(sorted[sorted.length - 1].toFixed(2)),
    avgMs: Number((sum / sorted.length).toFixed(2))
  };
}

const MONTHS = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
const MONTH_MAX_DAYS = {
  '2026-05': 31,
  '2026-06': 30,
  '2026-07': 31,
  '2026-08': 31,
  '2026-09': 30,
  '2026-10': 31
};

async function runScenario(scenario, { samples: sampleIterations, concurrency }) {
  const { name, studentCount, groupCount, paymentCount } = scenario;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `project-pay-load-${studentCount}-`));
  const dbPath = path.join(tmpDir, 'synthetic_load.db');
  const rng = mulberry32(20261026 + studentCount);

  let server = null;
  let db = null;

  try {
    // 1. Deterministic synthetic seeding & independent ground-truth calculation
    const seedStart = performance.now();
    const seedDb = createDatabase(dbPath);
    initDatabase(seedDb);

    const expectedStudents = [];
    const paidInOctByStudent = new Map();

    const seedTx = seedDb.transaction(() => {
      const insertGroup = seedDb.prepare('INSERT INTO groups (name, created_at) VALUES (?, ?)');
      for (let g = 1; g <= groupCount; g++) {
        insertGroup.run(`Synthetic Group ${String(g).padStart(4, '0')}`, '2026-01-01T00:00:00.000Z');
      }

      const feeOptions = [0, 300000, 450000, 600000, 800000, 1000000, 1200000];
      const insertStudent = seedDb.prepare(
        'INSERT INTO students (full_name, phone, monthly_fee, created_at, group_id) VALUES (?, ?, ?, ?, ?)'
      );

      for (let s = 1; s <= studentCount; s++) {
        const fee = feeOptions[Math.floor(rng() * feeOptions.length)];
        const assignGroup = rng() < 0.85 ? Math.floor(rng() * groupCount) + 1 : null;
        const phone = rng() < 0.8 ? `+998 90 ${String(1000000 + (s % 8999999))}` : null;
        const fullName = `Synthetic Student ${String(s).padStart(6, '0')}`;
        insertStudent.run(fullName, phone, fee, '2026-01-15T00:00:00.000Z', assignGroup);
        expectedStudents.push({ id: s, fee });
      }

      const insertPayment = seedDb.prepare(
        'INSERT INTO payments (student_id, amount, payment_date, created_at) VALUES (?, ?, ?, ?)'
      );
      for (let p = 1; p <= paymentCount; p++) {
        const studentId = Math.floor(rng() * studentCount) + 1;
        const month = MONTHS[Math.floor(rng() * MONTHS.length)];
        const day = String(Math.floor(rng() * MONTH_MAX_DAYS[month]) + 1).padStart(2, '0');
        const paymentDate = `${month}-${day}`;
        const amount = (Math.floor(rng() * 12) + 1) * 100000;
        insertPayment.run(studentId, amount, paymentDate, `${paymentDate}T10:00:00.000Z`);
        if (month === '2026-10') {
          paidInOctByStudent.set(studentId, (paidInOctByStudent.get(studentId) || 0) + amount);
        }
      }
    });

    seedTx();
    seedDb.pragma('wal_checkpoint(TRUNCATE)');

    let queryPlans = null;
    if (studentCount === 10_000) {
      queryPlans = {
        debtors: seedDb
          .prepare(`EXPLAIN QUERY PLAN ${MONTHLY_DEBTORS_QUERY}`)
          .all('2026-10-01', '2026-10-31'),
        listStudents: seedDb
          .prepare(
            'EXPLAIN QUERY PLAN SELECT s.id, s.full_name, s.phone, s.monthly_fee, s.created_at, s.group_id, g.name AS group_name FROM students s LEFT JOIN groups g ON g.id = s.group_id ORDER BY s.id ASC'
          )
          .all(),
        listGroups: seedDb
          .prepare(
            'EXPLAIN QUERY PLAN SELECT g.id, g.name, g.created_at, COUNT(s.id) AS student_count FROM groups g LEFT JOIN students s ON s.group_id = g.id GROUP BY g.id, g.name, g.created_at ORDER BY g.name COLLATE NOCASE ASC'
          )
          .all(),
        studentPayments: seedDb
          .prepare(
            'EXPLAIN QUERY PLAN SELECT id, student_id, amount, payment_date, created_at FROM payments WHERE student_id = ? ORDER BY payment_date ASC, id ASC'
          )
          .all(1)
      };
    }

    seedDb.close();
    const seedMs = Number((performance.now() - seedStart).toFixed(2));
    const dbBytesBefore = fs.statSync(dbPath).size;

    // 2. Measure application startup + warm readiness
    const startupStart = performance.now();
    const origLog = console.log;
    console.log = () => {};
    let started;
    try {
      started = startServer(0, dbPath);
      await new Promise((resolve) => {
        started.server.once('listening', resolve);
      });
    } finally {
      console.log = origLog;
    }
    server = started.server;
    db = started.db;

    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const warmRes = await fetch(`${baseUrl}/api/groups`);
    assert.equal(warmRes.status, 200);
    const startupMs = Number((performance.now() - startupStart).toFixed(2));

    // 3. Verify debtor report exactness against independent calculation on both interfaces
    let expectedDebtorCount = 0;
    let expectedTotalDebt = 0n;
    for (const st of expectedStudents) {
      const paid = paidInOctByStudent.get(st.id) || 0;
      if (paid < st.fee) {
        expectedDebtorCount += 1;
        expectedTotalDebt += BigInt(st.fee - paid);
      }
    }

    const [directRes, apiRes] = await Promise.all([
      fetch(`${baseUrl}/debtors?month=2026-10`),
      fetch(`${baseUrl}/api/reports/debtors?month=2026-10`)
    ]);
    assert.equal(directRes.status, 200);
    assert.equal(apiRes.status, 200);
    const actualDebtors = await directRes.json();
    const apiDebtors = await apiRes.json();
    assert.equal(actualDebtors.length, expectedDebtorCount, 'Debtor row count mismatch');
    assert.equal(apiDebtors.length, expectedDebtorCount, 'API debtor row count mismatch');
    const actualTotalDebt = actualDebtors.reduce((acc, d) => acc + BigInt(d.debt), 0n);
    assert.equal(actualTotalDebt, expectedTotalDebt, 'Debtor sum mismatch');

    // 4. Endpoint latency & throughput benchmarks
    const memBefore = process.memoryUsage();
    const cpuBefore = process.cpuUsage();

    async function benchmarkEndpoint(pathFn) {
      const timings = [];
      let errors = 0;
      const tStart = performance.now();
      for (let i = 0; i < sampleIterations; i++) {
        const t0 = performance.now();
        const res = await fetch(`${baseUrl}${pathFn(i)}`);
        await res.arrayBuffer();
        timings.push(performance.now() - t0);
        if (!res.ok) errors += 1;
      }
      const totalSec = (performance.now() - tStart) / 1000;
      return {
        ...summarizeTimings(timings),
        rps: Number((sampleIterations / totalSec).toFixed(1)),
        errors
      };
    }

    const endpoints = {
      dashboardLoad: await (async () => {
        const timings = [];
        let errors = 0;
        const tStart = performance.now();
        for (let i = 0; i < sampleIterations; i++) {
          const t0 = performance.now();
          const [r1, r2] = await Promise.all([
            fetch(`${baseUrl}/api/students`),
            fetch(`${baseUrl}/api/reports/debtors?month=2026-10`)
          ]);
          await Promise.all([r1.arrayBuffer(), r2.arrayBuffer()]);
          timings.push(performance.now() - t0);
          if (!r1.ok || !r2.ok) errors += 1;
        }
        const totalSec = (performance.now() - tStart) / 1000;
        return {
          ...summarizeTimings(timings),
          rps: Number((sampleIterations / totalSec).toFixed(1)),
          errors
        };
      })(),
      listStudents: await benchmarkEndpoint(() => '/api/students'),
      listGroups: await benchmarkEndpoint(() => '/api/groups'),
      debtorsReport: await benchmarkEndpoint(() => '/debtors?month=2026-10'),
      studentPayments: await benchmarkEndpoint((i) => `/api/students/${(i % studentCount) + 1}/payments`),
      groupStudents: await benchmarkEndpoint((i) => `/api/groups/${(i % groupCount) + 1}/students`)
    };

    // 5. Controlled concurrent read + write workload (concurrency workers x 5 ops)
    const opsPerWorker = 5;
    const totalConcurrentOps = concurrency * opsPerWorker;
    let concErrors = 0;
    let concWrites = 0;
    const concStart = performance.now();

    await Promise.all(
      Array.from({ length: concurrency }, (_, w) =>
        (async () => {
          for (let k = 0; k < opsPerWorker; k++) {
            if ((w + k) % 3 === 0) {
              const res = await fetch(`${baseUrl}/api/payments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  student_id: ((w * opsPerWorker + k) % studentCount) + 1,
                  amount: 50000,
                  payment_date: '2026-11-15'
                })
              });
              await res.json();
              if (res.status === 201) concWrites += 1;
              else concErrors += 1;
            } else {
              const res = await fetch(`${baseUrl}/debtors?month=2026-10`);
              await res.arrayBuffer();
              if (res.status !== 200) concErrors += 1;
            }
          }
        })()
      )
    );
    const concDurationMs = Number((performance.now() - concStart).toFixed(2));

    // 6. Failed-request recovery & SQLite integrity verification
    const badRes = await fetch(`${baseUrl}/api/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: 99999999, amount: -50, payment_date: '2026-02-30' })
    });
    assert.equal(badRes.status, 400);

    const totalPaymentsAfter = db.prepare('SELECT COUNT(*) AS c FROM payments').get().c;
    assert.equal(totalPaymentsAfter, paymentCount + concWrites, 'Partial or duplicate write detected');

    const fkViolations = db.pragma('foreign_key_check');
    const integrity = db.pragma('integrity_check', { simple: true });
    assert.equal(fkViolations.length, 0, 'Foreign key violation detected');
    assert.equal(integrity, 'ok', 'SQLite integrity_check failed');

    const cpuUsed = process.cpuUsage(cpuBefore);
    const memAfter = process.memoryUsage();
    db.pragma('wal_checkpoint(TRUNCATE)');
    const dbBytesAfter = fs.statSync(dbPath).size;

    return {
      scenario: name,
      counts: {
        students: studentCount,
        groups: groupCount,
        payments: paymentCount,
        debtorsOct: expectedDebtorCount
      },
      seedMs,
      startupMs,
      dbSizeKB: {
        beforeKB: Math.round(dbBytesBefore / 1024),
        afterKB: Math.round(dbBytesAfter / 1024)
      },
      memoryMB: {
        rssBeforeMB: Number((memBefore.rss / 1048576).toFixed(1)),
        rssAfterMB: Number((memAfter.rss / 1048576).toFixed(1)),
        heapUsedAfterMB: Number((memAfter.heapUsed / 1048576).toFixed(1))
      },
      cpuMs: {
        userMs: Math.round(cpuUsed.user / 1000),
        systemMs: Math.round(cpuUsed.system / 1000)
      },
      concurrency: {
        totalOps: totalConcurrentOps,
        writes: concWrites,
        errors: concErrors,
        durationMs: concDurationMs,
        rps: Number((totalConcurrentOps / (concDurationMs / 1000)).toFixed(1))
      },
      endpoints,
      queryPlans
    };
  } finally {
    if (server) {
      await new Promise((r) => server.close(r));
    }
    if (db) {
      db.close();
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const results = [];

  for (const key of opts.scales) {
    const res = await runScenario(SCENARIOS[key], opts);
    results.push(res);
    if (!opts.jsonOnly) {
      console.log(
        `[PASS] ${res.scenario} (${res.counts.students}s/${res.counts.groups}g/${res.counts.payments}p): ` +
          `seed=${res.seedMs}ms, startup=${res.startupMs}ms, ` +
          `debtors p50=${res.endpoints.debtorsReport.p50Ms}ms p95=${res.endpoints.debtorsReport.p95Ms}ms p99=${res.endpoints.debtorsReport.p99Ms}ms (${res.endpoints.debtorsReport.rps} rps), ` +
          `students p50=${res.endpoints.listStudents.p50Ms}ms p95=${res.endpoints.listStudents.p95Ms}ms, ` +
          `concurrency=${res.concurrency.rps} rps (${res.concurrency.errors} errors), DB=${res.dbSizeKB.afterKB}KB`
      );
    }
  }

  if (opts.jsonOnly) {
    console.log(JSON.stringify({ environment: { node: process.version, platform: process.platform, arch: process.arch, cpus: os.cpus().length }, results }, null, 2));
  }
}

main().catch((err) => {
  console.error('Load test failed:', err);
  process.exit(1);
});
