/**
 * The writer, and the guarantee that a denied share produces no network at all.
 *
 * These assert on the uploader and the publisher being CALLED, not on which
 * buttons exist. Hiding the composer is presentation; the claim here is that a
 * caller holding `sharePhoto` directly still gets nothing.
 *
 * The independence cases matter more than they look. `mediaUploads` and
 * `publicNotePublishing` are separate capabilities, and a future policy could
 * set them apart, so the behaviour is pinned for all four combinations rather
 * than only the two the shipped profiles use.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';

import { IslandSafetyProvider, type ExperienceProfile } from '@/safety';

import { usePhotoShare } from './usePhotoShare';

const uploadFile = vi.fn();
const publishEvent = vi.fn();

vi.mock('@/hooks/useUploadFile', () => ({
  useUploadFile: () => ({ mutateAsync: uploadFile }),
}));
vi.mock('@/hooks/useNostrPublish', () => ({
  useNostrPublish: () => ({ mutateAsync: publishEvent }),
}));

const POLAROID = 'data:image/png;base64,aaaa';
const IMAGE_URL = 'https://blossom.primal.net/abc.png';

/** A policy override that is not one of the two shipped profiles. */
function wrapper(profile: ExperienceProfile) {
  return ({ children }: { children: ReactNode }) => (
    <IslandSafetyProvider profile={profile}>{children}</IslandSafetyProvider>
  );
}

beforeEach(() => {
  uploadFile.mockReset().mockResolvedValue([['url', IMAGE_URL]]);
  publishEvent.mockReset().mockResolvedValue({ id: 'evt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ blob: async () => new Blob(['x'], { type: 'image/png' }) })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function share(profile: ExperienceProfile, caption = 'hello') {
  const { result } = renderHook(() => usePhotoShare(), { wrapper: wrapper(profile) });
  let outcome: Awaited<ReturnType<typeof result.current.sharePhoto>> | undefined;
  await act(async () => {
    outcome = await result.current.sharePhoto({ polaroidSrc: POLAROID, caption });
  });
  return { outcome: outcome!, canShare: result.current.canShare };
}

describe('Standard', () => {
  it('uploads and publishes', async () => {
    const { outcome, canShare } = await share('standard');

    expect(outcome).toEqual({ status: 'published' });
    expect(canShare).toBe(true);
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(publishEvent).toHaveBeenCalledTimes(1);
  });

  it('publishes the unchanged kind 1 note referencing the uploaded image', async () => {
    await share('standard', 'my blobbi!');

    const event = publishEvent.mock.calls[0][0];
    expect(event.kind).toBe(1);
    expect(event.content).toContain(IMAGE_URL);
    expect(event.content).toContain('my blobbi!');
    expect(event.tags).toContainEqual(['t', 'Blobbi']);
  });

  it('reports a publish failure as a failure, naming the stage', async () => {
    publishEvent.mockRejectedValueOnce(new Error('relay down'));
    const { outcome } = await share('standard');

    expect(outcome).toEqual({ status: 'failed', stage: 'publish' });
  });

  it('reports an upload failure without attempting to publish', async () => {
    uploadFile.mockRejectedValueOnce(new Error('blossom down'));
    const { outcome } = await share('standard');

    expect(outcome).toEqual({ status: 'failed', stage: 'upload' });
    expect(publishEvent).not.toHaveBeenCalled();
  });
});

describe('Family', () => {
  it('does not upload and does not publish', async () => {
    const { outcome, canShare } = await share('family');

    expect(outcome).toEqual({ status: 'denied', reason: 'media-uploads-not-permitted' });
    expect(canShare).toBe(false);
    expect(uploadFile).not.toHaveBeenCalled();
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it('does not even read the photo', async () => {
    // The decision comes before the data URL is fetched, so a refused share
    // costs nothing and touches nothing.
    await share('family');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports denial as denial, never as a failure', async () => {
    // "Upload failed" would be a lie, nothing was attempted, and it would
    // invite a retry of something that can never work.
    const { outcome } = await share('family');
    expect(outcome.status).toBe('denied');
    expect(outcome.status === 'denied' && outcome.reason).toBeTruthy();
  });
});

describe('capability independence', () => {
  /** Render with a hand-built policy so combinations the profiles never use can be exercised. */
  async function shareWithCapabilities(overrides: {
    mediaUploads: boolean;
    publicNotePublishing: boolean;
  }) {
    vi.resetModules();
    const { STANDARD_POLICY } = await import('@/safety');
    const { permitPhotoShare } = await import('./photo-share');
    return permitPhotoShare({ ...STANDARD_POLICY, ...overrides });
  }

  it('uploads allowed, notes refused → refused, before any upload', async () => {
    // The case that matters: uploading first and discovering the refusal later
    // would leave a permanent public blob behind for a post that never happened.
    expect(await shareWithCapabilities({ mediaUploads: true, publicNotePublishing: false })).toEqual(
      { allowed: false, reason: 'public-notes-not-permitted' },
    );
  });

  it('uploads refused, notes allowed → refused', async () => {
    // `assertPolicyInvariants` rejects this combination as an authored policy,
    // because a note with nothing to reference is half an action. The
    // enforcement layer still refuses it coherently rather than relying on that.
    expect(await shareWithCapabilities({ mediaUploads: false, publicNotePublishing: true })).toEqual(
      { allowed: false, reason: 'media-uploads-not-permitted' },
    );
  });

  it('both allowed → allowed', async () => {
    expect(
      await shareWithCapabilities({ mediaUploads: true, publicNotePublishing: true }),
    ).toEqual({ allowed: true });
  });

  it('neither allowed → refused', async () => {
    expect(
      (await shareWithCapabilities({ mediaUploads: false, publicNotePublishing: false })).allowed,
    ).toBe(false);
  });
});
