/**
 * Express router for report endpoints.
 */

import { Router } from 'express';
import { getMonthlyDebtors } from '../services/debtors.js';
import { getAnnualReport } from '../services/reports.js';
import { validateReportMonth, validateReportYear } from '../validators/index.js';

/**
 * Creates a request handler for monthly debtor reports.
 * Reused across GET /debtors and GET /api/reports/debtors.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {import('express').RequestHandler}
 */
export function createDebtorsHandler(db) {
  return (req, res, next) => {
    try {
      const monthParam = req.query.month;
      if (!monthParam || typeof monthParam !== 'string') {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Query parameter "month" is required in YYYY-MM format'
        });
      }

      const validMonth = validateReportMonth(monthParam);
      const debtors = getMonthlyDebtors(db, validMonth);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.status(200).json(debtors);
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Creates a request handler for annual reports.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {import('express').RequestHandler}
 */
export function createAnnualReportHandler(db) {
  return (req, res, next) => {
    try {
      const yearParam = req.query.year;
      if (!yearParam || typeof yearParam !== 'string') {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Query parameter "year" is required in YYYY format'
        });
      }

      const validYear = validateReportYear(yearParam);
      const report = getAnnualReport(db, validYear);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.status(200).json(report);
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Creates and configures the report routes.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {import('express').Router}
 */
export function createReportRouter(db) {
  const router = Router();

  // GET /api/reports/debtors?month=YYYY-MM
  router.get('/debtors', createDebtorsHandler(db));

  // GET /api/reports/annual?year=YYYY
  router.get('/annual', createAnnualReportHandler(db));

  return router;
}
