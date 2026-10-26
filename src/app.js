/**
 * Express application factory for Project Pay.
 * Configures middleware, API routes, static frontend serving, 404 fallback, and secure error handling.
 */

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { createDatabase } from './db/connection.js';
import { initDatabase } from './db/init.js';
import { createStudentRouter } from './routes/students.js';
import { createGroupRouter } from './routes/groups.js';
import { createPaymentRouter } from './routes/payments.js';
import { createReportRouter, createDebtorsHandler } from './routes/reports.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, '..', 'public');

/**
 * Creates and configures the Express application.
 *
 * @param {import('better-sqlite3').Database} [database] - Optional database instance.
 * @returns {import('express').Application}
 */
export function createApp(database) {
  const db = database || initDatabase(createDatabase());

  const app = express();

  // Attach database connection to req for convenience
  app.use((req, res, next) => {
    req.db = db;
    next();
  });

  // Safe JSON body parser with 100kb payload limit
  app.use(express.json({ limit: '100kb' }));

  // API Routes
  app.use('/api/students', createStudentRouter(db));
  app.use('/api/groups', createGroupRouter(db));
  app.use('/api/payments', createPaymentRouter(db));
  app.use('/api/reports', createReportRouter(db));

  // Required top-level debtor report endpoint: GET /debtors?month=YYYY-MM
  app.get('/debtors', createDebtorsHandler(db));

  // Serve frontend static assets (HTML, CSS, client ES Modules)
  app.use(express.static(publicDir));

  // Consistent JSON 404 for unknown /api routes
  app.use('/api', (req, res) => {
    res.status(404).json({
      error: 'Not Found',
      message: `Cannot ${req.method} ${req.originalUrl}`
    });
  });

  // SPA Navigation fallback for non-API GET requests without file extensions
  app.use((req, res) => {
    const hasFileExtension = path.extname(req.path) !== '' && req.path !== '/index.html';
    if ((req.method === 'GET' || req.method === 'HEAD') && !req.originalUrl.startsWith('/api') && !hasFileExtension) {
      return res.sendFile(path.join(publicDir, 'index.html'));
    }
    res.status(404).json({
      error: 'Not Found',
      message: `Cannot ${req.method} ${req.originalUrl}`
    });
  });

  // Central error handling middleware
  app.use((err, req, res, next) => {
    // Malformed JSON body from express.json()
    if (err.type === 'entity.parse.failed' || (err instanceof SyntaxError && 'body' in err)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Malformed JSON in request body'
      });
    }

    // Payload size exceeded limit
    if (err.type === 'entity.too.large') {
      return res.status(413).json({
        error: 'Payload Too Large',
        message: 'Request payload too large'
      });
    }

    // Zod validation errors
    if (err instanceof ZodError) {
      const messages = err.issues.map((i) => i.message).filter(Boolean);
      return res.status(400).json({
        error: 'Bad Request',
        message: messages.join('; ') || 'Validation failed',
        details: err.issues
      });
    }

    // Financial / integer range errors
    if (err instanceof RangeError) {
      return res.status(400).json({
        error: 'Bad Request',
        message: err.message
      });
    }

    // SQLite foreign key conflicts caught unexpectedly
    if (err.message && err.message.includes('FOREIGN KEY constraint failed')) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Foreign key constraint violation'
      });
    }

    // Default 500 error: sanitize completely to never leak SQL, paths, or secrets
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'An unexpected error occurred'
    });
  });

  return app;
}
