/**
 * The generated-account backup, proven against the real dialog.
 *
 * What a tester downloads must be the bare nsec, as UTF-8 text, under the
 * shared Blobbi backup name, handed over through an object URL that is revoked
 * again, and the key must never travel through the page's own URL.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { TestApp } from '@/test/TestApp';
import SignupDialog from './SignupDialog';

let createdBlobs: Blob[] = [];

/** jsdom's Blob has no `.text()`; FileReader is the portable way to read it. */
function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}
let revoked: string[] = [];
let clickedAnchors: HTMLAnchorElement[] = [];

beforeEach(() => {
  createdBlobs = [];
  revoked = [];
  clickedAnchors = [];
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: (blob: Blob) => {
      createdBlobs.push(blob);
      return 'blob:test-object-url';
    },
    revokeObjectURL: (url: string) => {
      revoked.push(url);
    },
  }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clickedAnchors.push(this);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function generateAndDownload() {
  const hrefBefore = window.location.href;
  render(
    <TestApp>
      <SignupDialog isOpen onClose={() => {}} />
    </TestApp>,
  );
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: /create account/i }));
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: /download secret key/i }));
  await act(async () => {});
  return { hrefBefore };
}

describe('downloading the generated secret key', () => {
  it('writes only the nsec, as UTF-8 plain text', async () => {
    await generateAndDownload();
    expect(createdBlobs).toHaveLength(1);
    const [blob] = createdBlobs;
    expect(blob.type).toBe('text/plain; charset=utf-8');
    const text = await readBlobText(blob);
    expect(text).toMatch(/^nsec1[a-z0-9]{58}$/);
  });

  it('uses the shared Blobbi backup filename', async () => {
    await generateAndDownload();
    expect(clickedAnchors).toHaveLength(1);
    const [anchor] = clickedAnchors;
    expect(anchor.download).toMatch(/^blobbi-nostr-key-backup-[a-z0-9]{8}\.txt$/);
    expect(anchor.href).toBe('blob:test-object-url');
  });

  it('revokes the object URL and removes the anchor', async () => {
    await generateAndDownload();
    expect(revoked).toEqual(['blob:test-object-url']);
    expect(document.body.contains(clickedAnchors[0])).toBe(false);
  });

  it('never puts the key into the page URL', async () => {
    const { hrefBefore } = await generateAndDownload();
    expect(window.location.href).toBe(hrefBefore);
    expect(window.location.href).not.toMatch(/nsec1/);
    const [blob] = createdBlobs;
    const nsec = await readBlobText(blob);
    expect(clickedAnchors[0].download).not.toContain(nsec.slice(5, 20));
  });
});
