import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_COOKIE } from './setup';

async function clearAll() {
  await env.DB.prepare('DELETE FROM articles').run();
  await env.DB.prepare('DELETE FROM sources').run();
}

function authedHeaders() {
  return {
    'content-type': 'application/json',
    cookie: ADMIN_COOKIE,
  };
}

async function createSource(name: string, url: string) {
  const res = await SELF.fetch('https://localhost/api/sources', {
    method: 'POST',
    headers: authedHeaders(),
    body: JSON.stringify({ name, url }),
  });
  return res;
}

describe('sources CRUD', () => {
  beforeEach(async () => {
    await clearAll();
  });

  it('creates a source and returns it with an id', async () => {
    const res = await createSource('My Source', 'https://example.com/feed');
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: number; name: string };
    expect(body.name).toBe('My Source');
    expect(body.id).toBeGreaterThan(0);
  });

  it('rejects an invalid url', async () => {
    const res = await SELF.fetch('https://localhost/api/sources', {
      method: 'POST',
      headers: authedHeaders(),
      body: JSON.stringify({ name: 'Bad', url: 'not-a-url' }),
    });
    expect(res.status).toBe(400);
  });

  it('lists created sources', async () => {
    await createSource('S1', 'https://s1.test/feed');
    const res = await SELF.fetch('https://localhost/api/sources');
    expect(res.status).toBe(200);
    const list = (await res.json()) as Array<{ name: string }>;
    expect(list.some((s) => s.name === 'S1')).toBe(true);
  });

  it('gets, patches and deletes a source', async () => {
    const created = (await (await createSource('S2', 'https://s2.test/feed')).json()) as {
      id: number;
    };
    const id = created.id;

    const getRes = await SELF.fetch(`https://localhost/api/sources/${id}`);
    expect(getRes.status).toBe(200);

    const patchRes = await SELF.fetch(`https://localhost/api/sources/${id}`, {
      method: 'PATCH',
      headers: authedHeaders(),
      body: JSON.stringify({ name: 'S2-renamed' }),
    });
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as { name: string };
    expect(patched.name).toBe('S2-renamed');

    const delRes = await SELF.fetch(`https://localhost/api/sources/${id}`, {
      method: 'DELETE',
      headers: authedHeaders(),
    });
    expect(delRes.status).toBe(200);

    const getAfter = await SELF.fetch(`https://localhost/api/sources/${id}`);
    expect(getAfter.status).toBe(404);
  });

  it('returns 404 for an unknown source', async () => {
    const res = await SELF.fetch('https://localhost/api/sources/999999');
    expect(res.status).toBe(404);
  });
});

describe('sources admin guard', () => {
  it('rejects unauthenticated source creation with 401', async () => {
    const res = await SELF.fetch('https://localhost/api/sources', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'NoAuth', url: 'https://x.test/feed' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects source patch without session with 401', async () => {
    const res = await SELF.fetch('https://localhost/api/sources/1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects source deletion without session with 401', async () => {
    const res = await SELF.fetch('https://localhost/api/sources/1', {
      method: 'DELETE',
    });
    expect(res.status).toBe(401);
  });

  it('rejects fetch-all trigger without session with 401', async () => {
    const res = await SELF.fetch('https://localhost/api/sources/fetch-all', {
      method: 'POST',
    });
    expect(res.status).toBe(401);
  });

  it('rejects single-source fetch trigger without session with 401', async () => {
    const res = await SELF.fetch('https://localhost/api/sources/1/fetch', {
      method: 'POST',
    });
    expect(res.status).toBe(401);
  });
});
