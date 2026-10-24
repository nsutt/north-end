import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import express from 'express';
import { shareRouter } from '../src/routes/share';
import { closeDatabase, createLifeScore, createUser, resetDatabase } from './helpers';

const XSS = '"><script>alert(1)</script>';

let server: Server;
let baseUrl: string;

before(async () => {
  const app = express();
  app.use('/vibe-check/share', shareRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/vibe-check/share`;
});
beforeEach(resetDatabase);
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeDatabase();
});

async function getSharePage(scoreId: string, query = '') {
  const response = await fetch(`${baseUrl}/score/${encodeURIComponent(scoreId)}${query}`);
  return { status: response.status, body: await response.text() };
}

describe('share page', () => {
  test('renders OG tags for a vibe', async () => {
    const user = await createUser({ displayName: 'Sam' });
    const vibe = await createLifeScore(user, [], { score: 8, statusText: 'Friday energy' });

    const { status, body } = await getSharePage(vibe.id);
    assert.equal(status, 200);
    assert.ok(body.includes(`<title>Sam&#39;s Vibe Check</title>`));
    assert.ok(body.includes('content="8 • Friday energy"'));
  });

  test('HTML-escapes displayName and statusText', async () => {
    const user = await createUser({ displayName: `Eve${XSS}` });
    const vibe = await createLifeScore(user, [], { score: 3, statusText: `status${XSS}` });

    const { status, body } = await getSharePage(vibe.id);
    assert.equal(status, 200);
    assert.ok(!body.includes(XSS), 'raw payload must not appear');
    assert.ok(!body.includes('<script>alert'), 'no injected script tag');
    assert.ok(body.includes('Eve&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(body.includes('status&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;'));
    // The only script tag is the page's own redirect
    assert.equal(body.match(/<script>/g)?.length, 1);
  });

  test('a malicious groupId does not appear unescaped', async () => {
    const user = await createUser();
    const vibe = await createLifeScore(user);

    for (const groupId of [XSS, '</script><script>alert(1)</script>', 'abc";alert(1);//']) {
      const { status, body } = await getSharePage(vibe.id, `?groupId=${encodeURIComponent(groupId)}`);
      assert.equal(status, 200);
      assert.ok(!body.includes(groupId), `groupId ${groupId} reflected`);
      assert.ok(!body.includes('alert(1)'));
      assert.equal(body.match(/<script>/g)?.length, 1);
    }
  });

  test('a valid groupId links to the vibe in that group', async () => {
    const user = await createUser();
    const vibe = await createLifeScore(user);
    const groupId = '0b9a6f3e-1111-4222-8333-944455556666';

    const { body } = await getSharePage(vibe.id, `?groupId=${groupId}`);
    assert.ok(body.includes(`https://vibecheck.test/group/${groupId}/score/${vibe.id}`));
  });

  test('returns 404 for an unknown vibe', async () => {
    const { status } = await getSharePage('00000000-0000-4000-8000-000000000000');
    assert.equal(status, 404);
  });
});
