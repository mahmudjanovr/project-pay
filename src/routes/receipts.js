/**
 * Express router for receipt endpoints.
 */

import { Router } from 'express';
import { getReceiptById, generateReceiptPdfBuffer } from '../services/receipts.js';
import { parseRouteId } from '../validators/index.js';

export function createReceiptRouter(db) {
  const router = Router();

  // GET /api/receipts/:id - Get receipt metadata
  router.get('/:id', (req, res, next) => {
    try {
      const receiptId = parseRouteId(req.params.id);
      const receipt = getReceiptById(db, receiptId);
      if (!receipt) {
        return res.status(404).json({
          error: 'Not Found',
          message: `Receipt with ID ${receiptId} not found`
        });
      }
      res.status(200).json(receipt);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/receipts/:id/pdf - Stream downloadable PDF
  router.get('/:id/pdf', async (req, res, next) => {
    try {
      const receiptId = parseRouteId(req.params.id);
      const receipt = getReceiptById(db, receiptId);
      if (!receipt) {
        return res.status(404).json({
          error: 'Not Found',
          message: `Receipt with ID ${receiptId} not found`
        });
      }

      const pdfBuffer = await generateReceiptPdfBuffer(receipt);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="receipt-${receipt.receipt_number || receiptId}.pdf"`
      );
      res.setHeader('Content-Length', pdfBuffer.length);
      res.status(200).send(pdfBuffer);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
