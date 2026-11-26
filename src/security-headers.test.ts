/**
 * The HTTP security headers Vercel sends (`vercel.json`) and the `<meta>` CSP
 * in `index.html` are one policy.
 *
 * Both are enforced when both are present (the browser applies each one), so
 * a directive widened in only one of them does nothing except mislead the
 * next reader. The header is therefore the meta policy, directive for
 * directive, plus only what a `<meta>` cannot carry or does not need to:
 * `frame-ancestors` (ignored in a meta tag) and `form-action`.
 *
 * The meta tag stays because it is what protects a static host that cannot
 * send headers (the GitHub Pages workflow, `npm run deploy`).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

type HeaderRule = { source: string; headers: { key: string; value: string }[] };
type VercelConfig = { headers?: HeaderRule[]; rewrites?: unknown; redirects?: unknown; routes?: unknown };

const root = process.cwd();
const vercel = JSON.parse(readFileSync(path.resolve(root, 'vercel.json'), 'utf8')) as VercelConfig;
const indexHtml = readFileSync(path.resolve(root, 'index.html'), 'utf8');

function header(key: string): string | undefined {
  const all = vercel.headers?.find((rule) => rule.source === '/(.*)');
  return all?.headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;
}

function parsePolicy(policy: string): Map<string, string> {
  const directives = new Map<string, string>();
  for (const raw of policy.split(';')) {
    const parts = raw.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) continue;
    const [name, ...values] = parts;
    expect(directives.has(name), `duplicate directive ${name}`).toBe(false);
    directives.set(name, values.join(' '));
  }
  return directives;
}

function metaPolicy(): string {
  const match = indexHtml.match(/<meta\s+http-equiv="content-security-policy"\s+content="([^"]*)"/i);
  expect(match, 'index.html carries a meta CSP').not.toBeNull();
  return match![1];
}

/** Directives the header may add on top of the meta policy, with their only allowed value. */
const HEADER_ONLY = new Map([
  ['frame-ancestors', "'none'"],
  ['form-action', "'self'"],
]);

describe('security headers', () => {
  it('the header CSP is the meta CSP plus frame-ancestors and form-action only', () => {
    const meta = parsePolicy(metaPolicy());
    const sent = parsePolicy(header('Content-Security-Policy') ?? '');

    expect(meta.has('frame-ancestors'), 'a meta tag cannot carry frame-ancestors').toBe(false);
    for (const [name, value] of meta) {
      expect(sent.get(name), `header ${name} must equal the meta ${name}`).toBe(value);
    }
    for (const [name, value] of sent) {
      if (meta.has(name)) continue;
      expect(HEADER_ONLY.get(name), `header-only directive ${name}`).toBe(value);
    }
    for (const [name, value] of HEADER_ONLY) expect(sent.get(name)).toBe(value);
  });

  it('stays strict where it matters: no eval, no inline script, nothing loads by default', () => {
    const sent = parsePolicy(header('Content-Security-Policy') ?? '');
    expect(sent.get('default-src')).toBe("'none'");
    expect(sent.get('base-uri')).toBe("'self'");
    const script = sent.get('script-src') ?? '';
    expect(script).not.toMatch(/unsafe-inline|unsafe-eval|wasm-unsafe-eval|\bhttps:(\s|$)|\*/);
  });

  it('sends the other security headers', () => {
    expect(header('X-Content-Type-Options')).toBe('nosniff');
    expect(header('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(header('X-Frame-Options')).toBe('DENY');
    expect(header('Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    expect(header('Cross-Origin-Opener-Policy')).toBe('same-origin');
  });

  it('changes headers only, never routing (unknown paths keep serving 404.html)', () => {
    expect(vercel.rewrites).toBeUndefined();
    expect(vercel.redirects).toBeUndefined();
    expect(vercel.routes).toBeUndefined();
  });
});
