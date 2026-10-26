/**
 * Server entry point for Project Pay.
 * Starts the HTTP listener using PORT environment variable (default: 3000).
 */

import { fileURLToPath } from 'node:url';
import { createDatabase } from './db/connection.js';
import { initDatabase } from './db/init.js';
import { createApp } from './app.js';

export const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
export const DB_PATH = process.env.DATABASE_PATH || 'project_pay.db';

/**
 * Starts the Project Pay server and listener.
 *
 * @param {number} [port=PORT]
 * @param {string} [dbPath=DB_PATH]
 * @returns {{ app: import('express').Application, server: import('node:http').Server, db: import('better-sqlite3').Database }}
 */
export function startServer(port = PORT, dbPath = DB_PATH) {
  const db = createDatabase(dbPath);
  initDatabase(db);

  const app = createApp(db);

  const server = app.listen(port, () => {
    const addr = server.address();
    const boundPort = typeof addr === 'object' && addr ? addr.port : port;
    console.log(`Project Pay server running on port ${boundPort}`);
  });

  return { app, server, db };
}

// Automatically start listener only when executed directly via node src/server.js
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  startServer();
}
