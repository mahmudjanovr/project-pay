/**
 * Express router for report endpoints.
 */

import { Router } from 'express';
import { getMonthlyDebtors } from '../services/debtors.js';
import { getMonthlyOverview, getGroupReports, getAnnualOverview } from '../services/reports.js';
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
      res.status(200).json(debtors);
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

  // GET /api/reports/overview?month=YYYY-MM
  router.get('/overview', (req, res, next) => {
    try {
      const monthParam = req.query.month;
      if (!monthParam || typeof monthParam !== 'string') {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Query parameter "month" is required in YYYY-MM format'
        });
      }

      const validMonth = validateReportMonth(monthParam);
      const overview = getMonthlyOverview(db, validMonth);
      res.status(200).json(overview);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/reports/groups?month=YYYY-MM
  router.get('/groups', (req, res, next) => {
    try {
      const monthParam = req.query.month;
      if (!monthParam || typeof monthParam !== 'string') {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Query parameter "month" is required in YYYY-MM format'
        });
      }

      const validMonth = validateReportMonth(monthParam);
      const groupReports = getGroupReports(db, validMonth);
      res.status(200).json(groupReports);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/reports/annual?year=YYYY
  router.get('/annual', (req, res, next) => {
    try {
      const yearParam = req.query.year;
      if (!yearParam || typeof yearParam !== 'string') {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Query parameter "year" is required in YYYY format'
        });
      }

      const validYear = validateReportYear(yearParam);
      const annualReport = getAnnualOverview(db, validYear);
      res.status(200).json(annualReport);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
