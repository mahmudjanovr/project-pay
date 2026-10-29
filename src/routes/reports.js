/**
 * Express router for report endpoints.
 */

import { Router } from 'express';
import { getMonthlyDebtors } from '../services/debtors.js';
import { getMonthlyOverview, getGroupReports, getAnnualOverview } from '../services/reports.js';
import { validateReportMonth, validateReportYear } from '../validators/index.js';

function getReferenceDateFromReq(req) {
  if (typeof req.query.reference_date === 'string') {
    return req.query.reference_date;
  }
  if (typeof req.headers['x-reference-date'] === 'string') {
    return req.headers['x-reference-date'];
  }
  return undefined;
}

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
      const referenceDate = getReferenceDateFromReq(req);
      const debtors = getMonthlyDebtors(db, validMonth, referenceDate);
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
      const referenceDate = getReferenceDateFromReq(req);
      const overview = getMonthlyOverview(db, validMonth, referenceDate);
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
      const referenceDate = getReferenceDateFromReq(req);
      const groupReports = getGroupReports(db, validMonth, referenceDate);
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
      const referenceDate = getReferenceDateFromReq(req);
      const annualReport = getAnnualOverview(db, validYear, referenceDate);
      res.status(200).json(annualReport);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
