// Copyright 2026 Vesper contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { CAPTCHA_HTML, CAPTCHA_JAVASCRIPT } from './captcha';

export interface Env {
  CONFIG: KVNamespace;
}

type ConfigValue = boolean | number | string | null;

type FlagOverride = Readonly<{
  name: string;
  value: ConfigValue;
}>;

type ConfigResponse = Readonly<{
  schemaVersion: 1;
  developerAciHashes: ReadonlyArray<string>;
  flagOverrides: ReadonlyArray<FlagOverride>;
}>;

const ACI_HASH_PATTERN = /^[0-9a-f]{64}$/u;
const FLAG_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/u;
const CONFIG_PATH_PATTERN = /^\/config\/([0-9a-f]{64})$/u;
const CAPTCHA_PAGE_PATHS = new Set([
  '/captcha/challenge/generate.html',
  '/captcha/registration/generate.html',
]);
const CAPTCHA_SCRIPT_PATH = '/captcha/vesper-captcha.js';
const DEVELOPERS_KEY = 'developers';
const OVERRIDES_KEY_PREFIX = 'overrides:';

const SECURITY_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Permissions-Policy':
    'accelerometer=(), camera=(), geolocation=(), microphone=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
} as const;

function responseHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(SECURITY_HEADERS);
  if (extra) {
    new Headers(extra).forEach((value, name) => headers.set(name, value));
  }
  return headers;
}

function jsonError(status: number, error: string): Response {
  return Response.json(
    { error },
    {
      status,
      headers: responseHeaders({
        'Cache-Control': 'no-store',
      }),
    }
  );
}

function textResponse(
  request: Request,
  body: string,
  status = 200
): Response {
  return new Response(request.method === 'HEAD' ? null : body, {
    status,
    headers: responseHeaders({
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
    }),
  });
}

function captchaResponse(request: Request, body: string, type: string): Response {
  return new Response(request.method === 'HEAD' ? null : body, {
    status: 200,
    headers: responseHeaders({
      'Cache-Control': 'public, max-age=3600',
      'Content-Security-Policy': [
        "default-src 'none'",
        "script-src 'self' https://hcaptcha.com https://*.hcaptcha.com",
        "connect-src 'self' https://hcaptcha.com https://*.hcaptcha.com",
        "frame-src https://hcaptcha.com https://*.hcaptcha.com",
        "img-src data: https://hcaptcha.com https://*.hcaptcha.com",
        "style-src 'unsafe-inline' https://hcaptcha.com https://*.hcaptcha.com",
        "frame-ancestors 'none'",
      ].join('; '),
      'Content-Type': type,
    }),
  });
}

function parseDeveloperHashes(raw: string | null): ReadonlyArray<string> {
  if (raw == null) {
    return [];
  }

  const value: unknown = JSON.parse(raw);
  if (
    !Array.isArray(value) ||
    value.some(item => typeof item !== 'string' || !ACI_HASH_PATTERN.test(item))
  ) {
    throw new Error('Invalid developer ACI hash configuration');
  }

  return [...new Set(value)].sort();
}

function isConfigValue(value: unknown): value is ConfigValue {
  return (
    value == null ||
    typeof value === 'boolean' ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

function parseFlagOverrides(raw: string | null): ReadonlyArray<FlagOverride> {
  if (raw == null) {
    return [];
  }

  const value: unknown = JSON.parse(raw);
  if (
    value == null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error('Invalid flag override configuration');
  }

  const entries = Object.entries(value);
  if (
    entries.some(
      ([name, flagValue]) =>
        !FLAG_NAME_PATTERN.test(name) || !isConfigValue(flagValue)
    )
  ) {
    throw new Error('Invalid flag override entry');
  }

  return entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, flagValue]) => ({ name, value: flagValue as ConfigValue }));
}

async function getConfig(
  env: Env,
  aciHash: string
): Promise<ConfigResponse> {
  const [developerHashesJson, overridesJson] = await Promise.all([
    env.CONFIG.get(DEVELOPERS_KEY, { cacheTtl: 60 }),
    env.CONFIG.get(`${OVERRIDES_KEY_PREFIX}${aciHash}`, { cacheTtl: 60 }),
  ]);

  return {
    schemaVersion: 1,
    developerAciHashes: parseDeveloperHashes(developerHashesJson),
    flagOverrides: parseFlagOverrides(overridesJson),
  };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function configResponse(
  request: Request,
  env: Env,
  aciHash: string
): Promise<Response> {
  let config: ConfigResponse;
  try {
    config = await getConfig(env, aciHash);
  } catch (error) {
    console.error('Unable to read Vesper configuration', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return jsonError(503, 'Configuration is temporarily unavailable');
  }

  const body = JSON.stringify(config);
  const etag = `"${await sha256Hex(body)}"`;
  const headers = responseHeaders({
    'Cache-Control': 'private, no-store',
    'Content-Type': 'application/json; charset=utf-8',
    ETag: etag,
  });

  if (request.headers.get('If-None-Match') === etag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(request.method === 'HEAD' ? null : body, {
    status: 200,
    headers,
  });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: responseHeaders({
          'Access-Control-Allow-Headers': 'If-None-Match',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Max-Age': '86400',
          'Cache-Control': 'public, max-age=86400',
        }),
      });
    }

    if (url.pathname === '/healthz') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return jsonError(405, 'Method not allowed');
      }
      return new Response(request.method === 'HEAD' ? null : 'ok\n', {
        status: 200,
        headers: responseHeaders({
          'Cache-Control': 'no-store',
          'Content-Type': 'text/plain; charset=utf-8',
        }),
      });
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return jsonError(405, 'Method not allowed');
    }

    if (CAPTCHA_PAGE_PATHS.has(url.pathname)) {
      return captchaResponse(
        request,
        CAPTCHA_HTML,
        'text/html; charset=utf-8'
      );
    }
    if (url.pathname === CAPTCHA_SCRIPT_PATH) {
      return captchaResponse(
        request,
        CAPTCHA_JAVASCRIPT,
        'text/javascript; charset=utf-8'
      );
    }

    const match = CONFIG_PATH_PATTERN.exec(url.pathname);
    if (!match) {
      return jsonError(404, 'Not found');
    }

    return configResponse(request, env, match[1]!);
  },
} satisfies ExportedHandler<Env>;
