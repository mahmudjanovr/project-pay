/**
 * Express router for student endpoints.
 */

import { Router } from 'express';
import {
  listStudents,
  getStudentById,
  createStudent,
  updateStudent,
  deleteStudent
} from '../services/students.js';
import { getPaymentsByStudent } from '../services/payments.js';
import { parseRouteId } from '../validators/index.js';

/**
 * Creates and configures the student routes.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {import('express').Router}
 */
export function createStudentRouter(db) {
  const router = Router();

  // GET /api/students - List all students
  router.get('/', (req, res, next) => {
    try {
      const students = listStudents(db);
      res.status(200).json(students);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/students - Create a student
  router.post('/', (req, res, next) => {
    try {
      const student = createStudent(db, req.body);
      res.status(201).json(student);
    } catch (err) {
      if (err.message && err.message.includes('FOREIGN KEY constraint failed')) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Referenced group does not exist'
        });
      }
      next(err);
    }
  });

  // GET /api/students/:id - Get a single student
  router.get('/:id', (req, res, next) => {
    try {
      const studentId = parseRouteId(req.params.id);
      const student = getStudentById(db, studentId);
      if (!student) {
        return res.status(404).json({
          error: 'Not Found',
          message: `Student with ID ${studentId} not found`
        });
      }
      res.status(200).json(student);
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/students/:id - Partial update of a student
  router.patch('/:id', (req, res, next) => {
    try {
      const studentId = parseRouteId(req.params.id);
      const updated = updateStudent(db, studentId, req.body);
      if (!updated) {
        return res.status(404).json({
          error: 'Not Found',
          message: `Student with ID ${studentId} not found`
        });
      }
      res.status(200).json(updated);
    } catch (err) {
      if (err.message && err.message.includes('FOREIGN KEY constraint failed')) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Referenced group does not exist'
        });
      }
      next(err);
    }
  });

  // DELETE /api/students/:id - Delete a student
  router.delete('/:id', (req, res, next) => {
    try {
      const studentId = parseRouteId(req.params.id);
      const existing = getStudentById(db, studentId);
      if (!existing) {
        return res.status(404).json({
          error: 'Not Found',
          message: `Student with ID ${studentId} not found`
        });
      }

      deleteStudent(db, studentId);
      res.status(200).json({
        success: true,
        message: `Student with ID ${studentId} deleted successfully`
      });
    } catch (err) {
      if (err.message && err.message.includes('FOREIGN KEY constraint failed')) {
        return res.status(409).json({
          error: 'Conflict',
          message: 'Cannot delete student with existing payment history'
        });
      }
      next(err);
    }
  });

  // GET /api/students/:id/payments - Get payments for a student
  router.get('/:id/payments', (req, res, next) => {
    try {
      const studentId = parseRouteId(req.params.id);
      const student = getStudentById(db, studentId);
      if (!student) {
        return res.status(404).json({
          error: 'Not Found',
          message: `Student with ID ${studentId} not found`
        });
      }

      const payments = getPaymentsByStudent(db, studentId);
      res.status(200).json(payments);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
