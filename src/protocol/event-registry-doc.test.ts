/**
 * Staleness guard for the generated protocol document.
 *
 * The document is a pure function of the canonical registry, so "is it stale?"
 * is answerable by re-rendering and comparing. Running with
 * `UPDATE_REGISTRY_DOC=1` rewrites it instead of failing — that is the
 * generator (`npm run docs:registry`); there is no separate build step to
 * forget to run.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  REGISTRY_DOC_PATH,
  REGISTRY_SOURCE_PATH,
  renderRegistryMarkdown,
} from './registry-markdown';

const docAbsolutePath = resolve(process.cwd(), REGISTRY_DOC_PATH);
const nipAbsolutePath = resolve(process.cwd(), 'NIP.md');

describe('generated protocol registry document', () => {
  it('matches the canonical registry (regenerate with `npm run docs:registry`)', () => {
    const rendered = renderRegistryMarkdown();

    if (process.env.UPDATE_REGISTRY_DOC) {
      mkdirSync(dirname(docAbsolutePath), { recursive: true });
      writeFileSync(docAbsolutePath, rendered, 'utf8');
    }

    const onDisk = readFileSync(docAbsolutePath, 'utf8');
    expect(onDisk).toBe(rendered);
  });

  it('is deterministic — rendering twice produces identical bytes', () => {
    expect(renderRegistryMarkdown()).toBe(renderRegistryMarkdown());
  });

  it('marks itself as generated and names its source', () => {
    const rendered = renderRegistryMarkdown();
    expect(rendered).toContain('Generated file — do not edit by hand');
    expect(rendered).toContain(REGISTRY_SOURCE_PATH);
  });
});

describe('NIP.md', () => {
  const nip = readFileSync(nipAbsolutePath, 'utf8');

  it('points at the generated registry instead of duplicating it', () => {
    expect(nip).toContain(REGISTRY_DOC_PATH);
  });

  it('still carries prose explanation rather than being a generated dump', () => {
    // The high-level sections that explain WHY, which the generated document
    // deliberately does not reproduce.
    expect(nip).toContain('## Kind 31950 — Island Presence');
    expect(nip).toContain('Absolute positions only');
  });
});
