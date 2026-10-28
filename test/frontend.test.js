import test from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db/connection.js';
import { initDatabase } from '../src/db/init.js';

function createTestContext() {
  const db = createDatabase(':memory:');
  initDatabase(db);
  const app = createApp(db);
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    db,
    app,
    server,
    baseUrl,
    close: () => server.close()
  };
}

test('Frontend Static File Serving and SPA Integration', async (t) => {
  const ctx = createTestContext();
  t.after(() => ctx.close());

  await t.test('GET / returns index.html with text/html content type', async () => {
    const res = await fetch(`${ctx.baseUrl}/`);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type')?.includes('text/html'));
    const body = await res.text();
    assert.ok(body.includes('<!DOCTYPE html>'));
    assert.ok(body.includes('Project Pay'));
    assert.ok(body.includes('id="main-content"'));
    assert.ok(body.includes('id="app-sidebar"'));
  });

  await t.test('GET /css/variables.css and /css/base.css serve CSS stylesheets', async () => {
    const resVars = await fetch(`${ctx.baseUrl}/css/variables.css`);
    assert.equal(resVars.status, 200);
    assert.ok(resVars.headers.get('content-type')?.includes('text/css'));
    const varsBody = await resVars.text();
    assert.ok(varsBody.includes('--accent-primary'));

    const resBase = await fetch(`${ctx.baseUrl}/css/base.css`);
    assert.equal(resBase.status, 200);
    assert.ok(resBase.headers.get('content-type')?.includes('text/css'));
  });

  await t.test('GET /js/app.js and ES modules serve JavaScript files', async () => {
    const resApp = await fetch(`${ctx.baseUrl}/js/app.js`);
    assert.equal(resApp.status, 200);
    assert.ok(resApp.headers.get('content-type')?.includes('javascript'));
    const appBody = await resApp.text();
    assert.ok(appBody.includes('Router'));

    const resDom = await fetch(`${ctx.baseUrl}/js/dom.js`);
    assert.equal(resDom.status, 200);
    assert.ok(resDom.headers.get('content-type')?.includes('javascript'));

    const resFormatters = await fetch(`${ctx.baseUrl}/js/formatters.js`);
    assert.equal(resFormatters.status, 200);
    assert.ok(resFormatters.headers.get('content-type')?.includes('javascript'));
  });

  await t.test('non-API routes fall back to index.html for SPA routing', async () => {
    const res = await fetch(`${ctx.baseUrl}/students`);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type')?.includes('text/html'));
    const body = await res.text();
    assert.ok(body.includes('<!DOCTYPE html>'));
  });

  await t.test('unmatched /api routes return JSON 404 and NOT HTML', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/nonexistent-route`);
    assert.equal(res.status, 404);
    assert.ok(res.headers.get('content-type')?.includes('application/json'));
    const data = await res.json();
    assert.equal(data.error, 'Not Found');
    assert.ok(data.message.includes('/api/nonexistent-route'));
  });
});
