// Copyright 2026 Vesper contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { env, exports } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';

const TEST_HASH = 'a'.repeat(64);
const OTHER_HASH = 'b'.repeat(64);

afterEach(async () => {
  await Promise.all([
    env.CONFIG.delete('developers'),
    env.CONFIG.delete(`overrides:${TEST_HASH}`),
    env.CONFIG.delete(`overrides:${OTHER_HASH}`),
  ]);
});

describe('Vesper config service', () => {
  it('serves Vesper-owned captcha pages for desktop and Android', async () => {
    for (const route of ['challenge', 'registration']) {
      const response = await exports.default.fetch(
        `https://vsp.asy.st/captcha/${route}/generate.html?scheme=signalcaptcha`
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe(
        'text/html; charset=utf-8'
      );
      expect(response.headers.get('content-security-policy')).toContain(
        "style-src 'unsafe-inline' https://hcaptcha.com https://*.hcaptcha.com"
      );
      const body = await response.text();
      expect(body).toContain('/captcha/vesper-captcha.js');
      expect(body).not.toContain('signalcaptchas.org');
    }

    const script = await exports.default.fetch(
      'https://vsp.asy.st/captcha/vesper-captcha.js'
    );
    expect(script.status).toBe(200);
    const scriptBody = await script.text();
    expect(scriptBody).toContain("'signalcaptcha'");

    const head = await exports.default.fetch(
      'https://vsp.asy.st/captcha/registration/generate.html',
      { method: 'HEAD' }
    );
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });

  it('returns developer hashes and only the requested ACI overrides', async () => {
    await Promise.all([
      env.CONFIG.put('developers', JSON.stringify([OTHER_HASH, TEST_HASH])),
      env.CONFIG.put(
        `overrides:${TEST_HASH}`,
        JSON.stringify({
          'vesper.deletionPill': 'compact',
          'vesper.experimental': true,
        })
      ),
      env.CONFIG.put(
        `overrides:${OTHER_HASH}`,
        JSON.stringify({ 'vesper.experimental': false })
      ),
    ]);

    const response = await exports.default.fetch(
      `https://vsp.asy.st/config/${TEST_HASH}`
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({
      schemaVersion: 1,
      developerAciHashes: [TEST_HASH, OTHER_HASH],
      flagOverrides: [
        { name: 'vesper.deletionPill', value: 'compact' },
        { name: 'vesper.experimental', value: true },
      ],
    });
  });

  it('does not disclose whether an ACI has stored overrides', async () => {
    await env.CONFIG.put('developers', JSON.stringify([TEST_HASH]));

    const response = await exports.default.fetch(
      `https://vsp.asy.st/config/${OTHER_HASH}`
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      schemaVersion: 1,
      developerAciHashes: [TEST_HASH],
      flagOverrides: [],
    });
  });

  it('supports conditional and HEAD requests', async () => {
    const first = await exports.default.fetch(
      `https://vsp.asy.st/config/${TEST_HASH}`
    );
    const etag = first.headers.get('etag');
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/u);

    const notModified = await exports.default.fetch(
      `https://vsp.asy.st/config/${TEST_HASH}`,
      { headers: { 'If-None-Match': etag! } }
    );
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe('');

    const head = await exports.default.fetch(
      `https://vsp.asy.st/config/${TEST_HASH}`,
      {
        method: 'HEAD',
      }
    );
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });

  it('rejects malformed paths and unsupported methods', async () => {
    const malformed = await exports.default.fetch(
      'https://vsp.asy.st/config/not-a-hash'
    );
    expect(malformed.status).toBe(404);

    const uppercase = await exports.default.fetch(
      `https://vsp.asy.st/config/${TEST_HASH.toUpperCase()}`
    );
    expect(uppercase.status).toBe(404);

    const post = await exports.default.fetch(
      `https://vsp.asy.st/config/${TEST_HASH}`,
      {
        method: 'POST',
      }
    );
    expect(post.status).toBe(405);
  });

  it('fails closed when KV configuration is malformed', async () => {
    await env.CONFIG.put('developers', '["not-a-hash"]');

    const response = await exports.default.fetch(
      `https://vsp.asy.st/config/${TEST_HASH}`
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Configuration is temporarily unavailable',
    });
  });
});
