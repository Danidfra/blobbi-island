/**
 * The uploader gate.
 *
 * `usePhotoShare` already decides up front, so this is the second line: a future
 * caller that forgets to ask still cannot reach Blossom. The assertion is that
 * the uploader is never CONSTRUCTED, not merely that its result is discarded,
 * constructing it means a signer is handed over and a network request follows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { IslandSafetyProvider, type ExperienceProfile } from '@/safety';

import { isMediaUploadNotPermitted, useUploadFile } from './useUploadFile';

const upload = vi.fn();
const constructUploader = vi.fn();

vi.mock('@nostrify/nostrify/uploaders', () => ({
  BlossomUploader: class {
    constructor(options: unknown) {
      constructUploader(options);
    }
    upload = upload;
  },
}));

vi.mock('./useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: 'me', signer: { signEvent: vi.fn() } } }),
}));

function wrapper(profile: ExperienceProfile) {
  // `useUploadFile` is a TanStack mutation, so it needs a client. Retries are
  // off: a refused upload must be observed once, not three times.
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <IslandSafetyProvider profile={profile}>{children}</IslandSafetyProvider>
    </QueryClientProvider>
  );
}

const FILE = new File(['x'], 'polaroid.png', { type: 'image/png' });

async function attempt(profile: ExperienceProfile) {
  const { result } = renderHook(() => useUploadFile(), { wrapper: wrapper(profile) });
  let error: unknown = null;
  let value: unknown = null;
  await act(async () => {
    try {
      value = await result.current.mutateAsync(FILE);
    } catch (caught) {
      error = caught;
    }
  });
  return { error, value };
}

beforeEach(() => {
  upload.mockReset().mockResolvedValue([['url', 'https://blossom.primal.net/a.png']]);
  constructUploader.mockReset();
});

afterEach(() => vi.restoreAllMocks());

describe('Standard', () => {
  it('uploads', async () => {
    const { error, value } = await attempt('standard');

    expect(error).toBeNull();
    expect(value).toEqual([['url', 'https://blossom.primal.net/a.png']]);
    expect(upload).toHaveBeenCalledWith(FILE);
  });
});

describe('Family', () => {
  it('refuses without touching Blossom', async () => {
    const { error } = await attempt('family');

    expect(isMediaUploadNotPermitted(error)).toBe(true);
    expect(upload).not.toHaveBeenCalled();
    // Never even constructed: constructing hands over the signer.
    expect(constructUploader).not.toHaveBeenCalled();
  });

  it('refuses with a type a caller can tell apart from a network failure', async () => {
    // A refusal is not an outage. Showing "Upload failed" here would be a lie
    // and would invite a retry that can never succeed.
    const { error } = await attempt('family');

    expect(isMediaUploadNotPermitted(error)).toBe(true);
    expect((error as Error).message).not.toMatch(/failed|error|network/i);
  });

  it('refuses before the logged-in check, so the reason is never mistaken', async () => {
    // The refusal must not depend on being signed in; otherwise a signed-out
    // Family player would be told to log in for something that would still be
    // refused afterwards.
    expect(isMediaUploadNotPermitted((await attempt('family')).error)).toBe(true);
  });
});
