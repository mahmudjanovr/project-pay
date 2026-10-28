import test from 'node:test';
import assert from 'node:assert/strict';

import {
  studentNameSchema,
  monthlyFeeSchema,
  paymentAmountSchema,
  paymentDateSchema,
  reportMonthSchema,
  billingMonthSchema,
  createStudentSchema,
  createPaymentSchema,
  validateStudentInput,
  validatePaymentInput,
  validateStudentName,
  validateMonthlyFee,
  validatePaymentAmount,
  validatePaymentDate,
  validateReportMonth,
  validateBillingMonth
} from '../src/validators/index.js';

import {
  isLeapYear,
  getDaysInMonth,
  isValidCalendarDate,
  isValidReportMonth,
  getMonthDateRange
} from '../src/utils/date.js';

test('Student name validation', async (t) => {
  await t.test('trims whitespace and accepts valid names', () => {
    assert.equal(validateStudentName('  Ali Valiyev  '), 'Ali Valiyev');
    assert.equal(validateStudentName('Aziza'), 'Aziza');
    assert.equal(studentNameSchema.parse('\tBobur \n'), 'Bobur');
  });

  await t.test('rejects empty or whitespace-only names', () => {
    assert.throws(() => validateStudentName(''), /Student name cannot be empty/);
    assert.throws(() => validateStudentName('   '), /Student name cannot be empty/);
    assert.throws(() => validateStudentName('\t  \n'), /Student name cannot be empty/);
  });

  await t.test('rejects non-string values', () => {
    assert.throws(() => validateStudentName(null));
    assert.throws(() => validateStudentName(undefined));
    assert.throws(() => validateStudentName(12345));
    assert.throws(() => validateStudentName({ name: 'Ali' }));
  });
});

test('Monthly fee validation', async (t) => {
  await t.test('accepts non-negative safe integers (including zero)', () => {
    assert.equal(validateMonthlyFee(0), 0);
    assert.equal(validateMonthlyFee(500000), 500000);
    assert.equal(validateMonthlyFee(1500000), 1500000);
  });

  await t.test('rejects negative numbers', () => {
    assert.throws(() => validateMonthlyFee(-1), /non-negative/);
    assert.throws(() => validateMonthlyFee(-500000), /non-negative/);
  });

  await t.test('rejects floating-point numbers without rounding or truncating', () => {
    assert.throws(() => validateMonthlyFee(500000.5), /safe integer/);
    assert.throws(() => validateMonthlyFee(0.1), /safe integer/);
  });

  await t.test('rejects string representations without coercion', () => {
    assert.throws(() => validateMonthlyFee('500000'));
    assert.throws(() => validateMonthlyFee('0'));
    assert.throws(() => validateMonthlyFee(''));
  });

  await t.test('rejects NaN, Infinity, -0, and unsafe integers', () => {
    assert.throws(() => validateMonthlyFee(NaN));
    assert.throws(() => validateMonthlyFee(Infinity));
    assert.throws(() => validateMonthlyFee(-Infinity));
    assert.throws(() => validateMonthlyFee(-0));
    assert.throws(() => validateMonthlyFee(Number.MAX_SAFE_INTEGER + 1));
  });
});

test('Payment amount validation', async (t) => {
  await t.test('accepts strictly positive safe integers', () => {
    assert.equal(validatePaymentAmount(1), 1);
    assert.equal(validatePaymentAmount(500000), 500000);
  });

  await t.test('rejects zero and negative values', () => {
    assert.throws(() => validatePaymentAmount(0), /positive integer/);
    assert.throws(() => validatePaymentAmount(-1), /positive integer/);
    assert.throws(() => validatePaymentAmount(-100000), /positive integer/);
  });

  await t.test('rejects floating-point numbers', () => {
    assert.throws(() => validatePaymentAmount(100.5), /safe integer/);
    assert.throws(() => validatePaymentAmount(0.01), /safe integer/);
  });

  await t.test('rejects strings without coercion', () => {
    assert.throws(() => validatePaymentAmount('100000'));
    assert.throws(() => validatePaymentAmount('1'));
  });

  await t.test('rejects non-numeric values', () => {
    assert.throws(() => validatePaymentAmount(null));
    assert.throws(() => validatePaymentAmount(undefined));
    assert.throws(() => validatePaymentAmount(NaN));
    assert.throws(() => validatePaymentAmount(Infinity));
  });
});

test('Date validation and leap-year edge cases', async (t) => {
  await t.test('leap year rules', () => {
    assert.equal(isLeapYear(2024), true); // Divisible by 4
    assert.equal(isLeapYear(2000), true); // Divisible by 400
    assert.equal(isLeapYear(2023), false); // Not divisible by 4
    assert.equal(isLeapYear(1900), false); // Divisible by 100, not 400
    assert.equal(isLeapYear(2100), false); // Divisible by 100, not 400
  });

  await t.test('validates leap day correctly', () => {
    assert.equal(validatePaymentDate('2024-02-29'), '2024-02-29'); // Valid leap year
    assert.equal(validatePaymentDate('2000-02-29'), '2000-02-29'); // Valid 400-year leap

    assert.throws(() => validatePaymentDate('2023-02-29'), /valid calendar date/); // Non-leap year
    assert.throws(() => validatePaymentDate('1900-02-29'), /valid calendar date/); // Non-leap century
    assert.throws(() => validatePaymentDate('2024-02-30'), /valid calendar date/); // Impossible day
  });

  await t.test('validates days in 30-day and 31-day months', () => {
    // 30-day months
    assert.equal(validatePaymentDate('2024-04-30'), '2024-04-30');
    assert.throws(() => validatePaymentDate('2024-04-31'), /valid calendar date/);

    assert.equal(validatePaymentDate('2024-06-30'), '2024-06-30');
    assert.throws(() => validatePaymentDate('2024-06-31'), /valid calendar date/);

    assert.equal(validatePaymentDate('2024-09-30'), '2024-09-30');
    assert.throws(() => validatePaymentDate('2024-09-31'), /valid calendar date/);

    assert.equal(validatePaymentDate('2024-11-30'), '2024-11-30');
    assert.throws(() => validatePaymentDate('2024-11-31'), /valid calendar date/);

    // 31-day months
    assert.equal(validatePaymentDate('2024-01-31'), '2024-01-31');
    assert.equal(validatePaymentDate('2024-03-31'), '2024-03-31');
    assert.equal(validatePaymentDate('2024-05-31'), '2024-05-31');
    assert.equal(validatePaymentDate('2024-07-31'), '2024-07-31');
    assert.equal(validatePaymentDate('2024-08-31'), '2024-08-31');
    assert.equal(validatePaymentDate('2024-10-31'), '2024-10-31');
    assert.equal(validatePaymentDate('2024-12-31'), '2024-12-31');

    assert.throws(() => validatePaymentDate('2024-01-32'), /valid calendar date/);
  });

  await t.test('rejects non-canonical date formats', () => {
    assert.throws(() => validatePaymentDate('2024-2-5'));
    assert.throws(() => validatePaymentDate('2024-02-5'));
    assert.throws(() => validatePaymentDate('2024/02/05'));
    assert.throws(() => validatePaymentDate('2024.02.05'));
    assert.throws(() => validatePaymentDate('2024-02-05T00:00:00Z'));
    assert.throws(() => validatePaymentDate('2024-00-10'));
    assert.throws(() => validatePaymentDate('2024-13-10'));
    assert.throws(() => validatePaymentDate('not-a-date'));
    assert.throws(() => validatePaymentDate(12345));
    assert.throws(() => validatePaymentDate(null));
  });
});

test('Report month validation', async (t) => {
  await t.test('accepts valid YYYY-MM months', () => {
    assert.equal(validateReportMonth('2026-01'), '2026-01');
    assert.equal(validateReportMonth('2026-10'), '2026-10');
    assert.equal(validateReportMonth('2026-12'), '2026-12');
  });

  await t.test('rejects invalid month numbers', () => {
    assert.throws(() => validateReportMonth('2026-00'), /YYYY-MM/);
    assert.throws(() => validateReportMonth('2026-13'), /YYYY-MM/);
  });

  await t.test('rejects non-canonical formats', () => {
    assert.throws(() => validateReportMonth('2026-1'), /YYYY-MM/);
    assert.throws(() => validateReportMonth('2026/10'), /YYYY-MM/);
    assert.throws(() => validateReportMonth('2026-10-01'), /YYYY-MM/);
    assert.throws(() => validateReportMonth('2026'), /YYYY-MM/);
    assert.throws(() => validateReportMonth(''));
    assert.throws(() => validateReportMonth(null));
  });

  await t.test('calculates correct month date range boundaries', () => {
    const r1 = getMonthDateRange('2026-10');
    assert.equal(r1.startOfMonth, '2026-10-01');
    assert.equal(r1.startOfNextMonth, '2026-11-01');

    const r2 = getMonthDateRange('2026-12');
    assert.equal(r2.startOfMonth, '2026-12-01');
    assert.equal(r2.startOfNextMonth, '2027-01-01');

    const r3 = getMonthDateRange('2024-02');
    assert.equal(r3.startOfMonth, '2024-02-01');
    assert.equal(r3.startOfNextMonth, '2024-03-01');
  });
});

test('Billing month validation (billingMonthSchema)', async (t) => {
  await t.test('accepts valid YYYY-MM months with trim', () => {
    assert.equal(validateBillingMonth('2026-01'), '2026-01');
    assert.equal(validateBillingMonth('2026-09'), '2026-09');
    assert.equal(validateBillingMonth('2026-10'), '2026-10');
    assert.equal(validateBillingMonth('2026-12'), '2026-12');
    assert.equal(validateBillingMonth('  2026-10  '), '2026-10');
  });

  await t.test('rejects invalid month numbers with Billing month error message', () => {
    assert.throws(() => validateBillingMonth('2026-00'), /Billing month must be in exact YYYY-MM format/);
    assert.throws(() => validateBillingMonth('2026-13'), /Billing month must be in exact YYYY-MM format/);
  });

  await t.test('rejects non-canonical formats and non-strings', () => {
    assert.throws(() => validateBillingMonth('2026-9'), /Billing month/);
    assert.throws(() => validateBillingMonth('2026/10'), /Billing month/);
    assert.throws(() => validateBillingMonth('2026-10-01'), /Billing month/);
    assert.throws(() => validateBillingMonth('2026'), /Billing month/);
    assert.throws(() => validateBillingMonth(''), /Billing month/);
    assert.throws(() => validateBillingMonth(null), /Billing month must be a string/);
    assert.throws(() => validateBillingMonth(12345), /Billing month must be a string/);
  });
});

test('Compound schemas: createStudentSchema, updateStudentSchema, and createPaymentSchema', async (t) => {
  await t.test('validateStudentInput accepts valid input and rejects extra or invalid fields', () => {
    const student = validateStudentInput({ full_name: '  Dilshod  ', monthly_fee: 1000000 });
    assert.equal(student.full_name, 'Dilshod');
    assert.equal(student.monthly_fee, 1000000);
    assert.equal(student.phone, undefined);

    const withPhone = validateStudentInput({
      full_name: 'Dilshod',
      phone: '  +998 90 123 45 67  ',
      monthly_fee: 1000000
    });
    assert.equal(withPhone.phone, '+998 90 123 45 67');

    // Blank and null phone normalize to null
    assert.equal(validateStudentInput({ full_name: 'Dilshod', phone: '', monthly_fee: 1000000 }).phone, null);
    assert.equal(validateStudentInput({ full_name: 'Dilshod', phone: '   ', monthly_fee: 1000000 }).phone, null);
    assert.equal(validateStudentInput({ full_name: 'Dilshod', phone: null, monthly_fee: 1000000 }).phone, null);

    // Non-string phone rejected without coercion
    assert.throws(() => validateStudentInput({ full_name: 'Dilshod', phone: 998901234567, monthly_fee: 1000000 }));
    assert.throws(() => validateStudentInput({ full_name: 'Dilshod', phone: true, monthly_fee: 1000000 }));
    assert.throws(() => validateStudentInput({ full_name: 'Dilshod', phone: '9'.repeat(51), monthly_fee: 1000000 }));

    // Extra unknown fields rejected by strict schema
    assert.throws(() => validateStudentInput({ full_name: 'Dilshod', monthly_fee: 1000000, extra: true }));
    assert.throws(() => validateStudentInput({ full_name: 'Dilshod', monthly_fee: 1000000, phone_number: '+99890' }));
  });

  await t.test('validatePaymentInput accepts valid input and rejects extra or invalid fields', () => {
    const payment = validatePaymentInput({ student_id: 1, amount: 500000, payment_date: '2026-10-15' });
    assert.equal(payment.student_id, 1);
    assert.equal(payment.amount, 500000);
    assert.equal(payment.payment_date, '2026-10-15');
    assert.equal(payment.billing_month, undefined);

    const withMonth = validatePaymentInput({
      student_id: 1,
      amount: 500000,
      payment_date: '2026-10-28',
      billing_month: '2026-09'
    });
    assert.equal(withMonth.billing_month, '2026-09');

    assert.throws(() => validatePaymentInput({ student_id: -1, amount: 500000, payment_date: '2026-10-15' }));
    assert.throws(() => validatePaymentInput({ student_id: 1, amount: 0, payment_date: '2026-10-15' }));
    assert.throws(() => validatePaymentInput({ student_id: 1, amount: 500000, payment_date: '2026-02-30' }));
    assert.throws(
      () => validatePaymentInput({ student_id: 1, amount: 500000, payment_date: '2026-10-15', billing_month: '2026-13' }),
      /Billing month must be in exact YYYY-MM format/
    );
  });
});
