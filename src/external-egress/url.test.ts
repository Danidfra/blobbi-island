/**
 * What counts as a destination.
 *
 * The scheme rejections are the security-relevant half: a `javascript:` URL
 * reaching `window.open` executes in this origin, and a `data:` URL renders
 * attacker-controlled content that the address bar presents as a page. Both used
 * to be reachable, the authoring tool rendered an author-typed URL straight
 * into an `<a href>`.
 */
import { describe, expect, it } from 'vitest';

import { classifyDestination, isExternalDestination } from './url';

const ORIGIN = 'https://island.example';

describe('external destinations', () => {
  it('accepts an https URL', () => {
    expect(classifyDestination('https://t.me/share/url?url=x', ORIGIN)).toEqual({
      kind: 'external',
      url: 'https://t.me/share/url?url=x',
      host: 't.me',
    });
  });

  it('strips www from the displayed host', () => {
    // `www.` carries no information for someone deciding whether to continue.
    const result = classifyDestination('https://www.facebook.com/sharer/sharer.php?u=x', ORIGIN);
    expect(result.kind === 'external' && result.host).toBe('facebook.com');
  });

  it('lowercases the host', () => {
    const result = classifyDestination('https://GitHub.COM/blobbi', ORIGIN);
    expect(result.kind === 'external' && result.host).toBe('github.com');
  });

  it('keeps the full URL for opening, and the host only for showing', () => {
    // The player sees a host; the browser gets the query string. Showing a
    // 300-character share URL would be noise nobody reads.
    const long = 'https://twitter.com/intent/tweet?text=hello%20world&url=https%3A%2F%2Fx.example';
    const result = classifyDestination(long, ORIGIN);
    expect(result.kind === 'external' && result.url).toBe(long);
    expect(result.kind === 'external' && result.host).toBe('twitter.com');
  });
});

describe('rejected schemes', () => {
  it.each([
    ['javascript', 'javascript:alert(1)'],
    ['javascript with padding', '  javascript:alert(1)  '],
    ['mixed-case javascript', 'JaVaScRiPt:alert(1)'],
    ['data', 'data:text/html,<script>alert(1)</script>'],
    ['blob', 'blob:https://island.example/abc'],
    ['file', 'file:///etc/passwd'],
    ['http', 'http://insecure.example'],
    ['mailto', 'mailto:someone@example.com'],
  ])('refuses %s', (_label, raw) => {
    const result = classifyDestination(raw, ORIGIN);
    expect(result.kind).toBe('invalid');
    expect(result.kind === 'invalid' && result.reason).toBe('forbidden-scheme');
  });

  it('refuses a relay address with a reason that names it', () => {
    // Relay URLs are the one non-HTTP string the app routinely handles, so
    // confusing them with a navigation is the mistake worth naming specifically.
    expect(classifyDestination('wss://relay.ditto.pub', ORIGIN)).toEqual({
      kind: 'invalid',
      reason: 'relay-url',
    });
    expect(classifyDestination('ws://relay.local', ORIGIN)).toEqual({
      kind: 'invalid',
      reason: 'relay-url',
    });
  });
});

describe('malformed input', () => {
  it.each([
    ['an empty string', '', 'empty'],
    ['whitespace', '   ', 'empty'],
  ])('refuses %s', (_label, raw, reason) => {
    expect(classifyDestination(raw, ORIGIN)).toEqual({ kind: 'invalid', reason });
  });

  it('refuses something unparseable even without an origin to resolve against', () => {
    expect(classifyDestination('http://', null).kind).toBe('invalid');
    expect(classifyDestination('not a url', null)).toEqual({
      kind: 'invalid',
      reason: 'unparseable',
    });
  });

  it('never throws', () => {
    for (const raw of ['', '://', 'https://', '%%%', 'https://[', '\\\\evil']) {
      expect(() => classifyDestination(raw, ORIGIN)).not.toThrow();
    }
  });
});

describe('internal navigation is not egress', () => {
  it('classifies a same-origin absolute URL as internal', () => {
    expect(classifyDestination('https://island.example/settings', ORIGIN)).toEqual({
      kind: 'internal',
      url: 'https://island.example/settings',
    });
  });

  it('classifies a relative route as internal', () => {
    // Routing a React route through "are you sure you want to leave?" would be
    // both wrong and quickly ignored.
    expect(classifyDestination('/settings', ORIGIN).kind).toBe('internal');
    expect(classifyDestination('/tools/game-items', ORIGIN).kind).toBe('internal');
  });

  it('treats a different port as external', () => {
    expect(classifyDestination('https://island.example:8443/x', ORIGIN).kind).toBe('external');
  });

  it('treats a subdomain as external', () => {
    expect(classifyDestination('https://cdn.island.example/x', ORIGIN).kind).toBe('external');
  });

  it('is not fooled by a host that merely starts with the origin host', () => {
    const result = classifyDestination('https://island.example.evil.test/x', ORIGIN);
    expect(result.kind).toBe('external');
    expect(result.kind === 'external' && result.host).toBe('island.example.evil.test');
  });
});

describe('isExternalDestination', () => {
  it('answers the yes/no directly', () => {
    expect(isExternalDestination('https://github.com', ORIGIN)).toBe(true);
    expect(isExternalDestination('/settings', ORIGIN)).toBe(false);
    expect(isExternalDestination('javascript:alert(1)', ORIGIN)).toBe(false);
  });
});
