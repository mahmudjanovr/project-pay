/**
 * Express router for groups endpoints.
 */

import { Router } from 'express';
import {
  listGroups,
  getGroupById,
  createGroup,
  updateGroup,
  deleteGroup
} from '../services/groups.js';
import { parseRouteId } from '../validators/index.js';

/**
 * Creates and configures the groups routes.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {import('express').Router}
 */
export function createGroupRouter(db) {
  const router = Router();

  // GET /api/groups - List all groups with student count
  router.get('/', (req, res, next) => {
    try {
      const groups = listGroups(db);
      res.status(200).json(groups);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/groups - Create a new group
  router.post('/', (req, res, next) => {
    try {
      const group = createGroup(db, req.body);
      res.status(201).json(group);
    } catch (err) {
      if (err.message && err.message.includes('UNIQUE constraint failed: groups.name')) {
        return res.status(409).json({
          error: 'Conflict',
          message: 'Group with this name already exists'
        });
      }
      next(err);
    }
  });

  // PATCH /api/groups/:id - Rename a group
  router.patch('/:id', (req, res, next) => {
    try {
      const groupId = parseRouteId(req.params.id);
      const existing = getGroupById(db, groupId);
      if (!existing) {
        return res.status(404).json({
          error: 'Not Found',
          message: `Group with ID ${groupId} not found`
        });
      }

      const updated = updateGroup(db, groupId, req.body);
      res.status(200).json(updated);
    } catch (err) {
      if (err.message && err.message.includes('UNIQUE constraint failed: groups.name')) {
        return res.status(409).json({
          error: 'Conflict',
          message: 'Group with this name already exists'
        });
      }
      next(err);
    }
  });

  // DELETE /api/groups/:id - Delete an empty group
  router.delete('/:id', (req, res, next) => {
    try {
      const groupId = parseRouteId(req.params.id);
      const result = deleteGroup(db, groupId);

      if (!result.found) {
        return res.status(404).json({
          error: 'Not Found',
          message: `Group with ID ${groupId} not found`
        });
      }

      if (result.hasStudents) {
        return res.status(409).json({
          error: 'Conflict',
          message: `Cannot delete group with assigned students (${result.student_count} student(s) assigned)`
        });
      }

      res.status(200).json({
        success: true,
        message: `Group with ID ${groupId} deleted successfully`
      });
    } catch (err) {
      if (err.message && err.message.includes('FOREIGN KEY constraint failed')) {
        return res.status(409).json({
          error: 'Conflict',
          message: 'Cannot delete group with assigned students'
        });
      }
      next(err);
    }
  });

  return router;
}
