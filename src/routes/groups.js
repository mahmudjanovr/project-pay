/**
 * Express router for groups endpoints.
 */

import { Router } from 'express';
import {
  listGroups,
  getGroupById,
  createGroup,
  updateGroup,
  deleteGroup,
  getStudentsByGroupId,
  assignStudentsToGroup
} from '../services/groups.js';
import { parseRouteId, validateAssignStudentsInput } from '../validators/index.js';

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

  // GET /api/groups/:id - Get a single group
  router.get('/:id', (req, res, next) => {
    try {
      const groupId = parseRouteId(req.params.id);
      const group = getGroupById(db, groupId);
      if (!group) {
        return res.status(404).json({
          error: 'Not Found',
          message: `Group with ID ${groupId} not found`
        });
      }
      res.status(200).json(group);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/groups/:id/students - List students belonging to a group
  router.get('/:id/students', (req, res, next) => {
    try {
      const groupId = parseRouteId(req.params.id);
      const group = getGroupById(db, groupId);
      if (!group) {
        return res.status(404).json({
          error: 'Not Found',
          message: `Group with ID ${groupId} not found`
        });
      }

      const students = getStudentsByGroupId(db, groupId);
      res.status(200).json(students);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/groups/:id/assign-students - Assign existing students to group
  router.post('/:id/assign-students', (req, res, next) => {
    try {
      const groupId = parseRouteId(req.params.id);
      const group = getGroupById(db, groupId);
      if (!group) {
        return res.status(404).json({
          error: 'Not Found',
          message: `Group with ID ${groupId} not found`
        });
      }

      const validated = validateAssignStudentsInput(req.body);
      const result = assignStudentsToGroup(db, groupId, validated.student_ids);
      res.status(200).json(result);
    } catch (err) {
      if (err.statusCode === 404) {
        return res.status(404).json({
          error: 'Not Found',
          message: err.message
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
