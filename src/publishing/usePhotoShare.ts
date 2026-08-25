/**
 * The canonical writer for a public polaroid share.
 *
 * ShareModal used to own this: convert the data URL, upload to Blossom, build a
 * kind 1 note, publish it. That made the component the boundary, and a component
 * is a bad boundary — a second share surface, or a caller that reaches the
 * hooks directly, would have had its own copy of the sequence and none of the
 * checks.
 *
 * Now the sequence lives here and the component asks for an outcome.
 *
 * ## Order, and why the decision comes first
 *
 * ```
 *   permitPhotoShare(policy)     ← no network yet
 *          ↓ allowed
 *   data URL → Blob → File
 *          ↓
 *   upload (Blossom)             ← irreversible: content-addressed and public
 *          ↓
 *   publish (kind 1)
 * ```
 *
 * The upload is not undoable, so nothing may reach it until the whole operation
 * is known to be permitted. `useUploadFile` refuses independently as well — that
 * is the guard against a future second caller, not the primary check.
 *
 * ## Denial is not failure
 *
 * `denied` and `failed` are different outcomes with different messages. An
 * experience that does not permit public sharing has not suffered a network
 * error, and telling a player "Upload failed" when nothing was attempted is a
 * lie that also invites them to retry something that will never work.
 */

import { useCallback } from 'react';

import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useUploadFile } from '@/hooks/useUploadFile';
import { useIslandSafetyPolicy } from '@/safety';

import { buildPhotoShareEvent, permitPhotoShare, type PhotoShareDenial } from './photo-share';

export type PhotoShareOutcome =
  | { readonly status: 'published' }
  /** Refused by the experience. Not a failure, and not retryable. */
  | { readonly status: 'denied'; readonly reason: PhotoShareDenial }
  /** Something genuinely went wrong. `stage` says which half. */
  | { readonly status: 'failed'; readonly stage: 'capture' | 'upload' | 'publish' };

export interface SharePhotoInput {
  /** The composed polaroid, as a data URL. */
  readonly polaroidSrc: string;
  /** Whatever the player typed. */
  readonly caption: string;
}

export interface PhotoShareApi {
  /** Whether the surface should be offered at all. Presentation, not enforcement. */
  readonly canShare: boolean;
  sharePhoto(input: SharePhotoInput): Promise<PhotoShareOutcome>;
}

export function usePhotoShare(): PhotoShareApi {
  const policy = useIslandSafetyPolicy();
  const { mutateAsync: uploadFile } = useUploadFile();
  const { mutateAsync: publishEvent } = useNostrPublish();

  const sharePhoto = useCallback(
    async ({ polaroidSrc, caption }: SharePhotoInput): Promise<PhotoShareOutcome> => {
      const permission = permitPhotoShare(policy);
      if (!permission.allowed) return { status: 'denied', reason: permission.reason };

      let file: File;
      try {
        const blob = await (await fetch(polaroidSrc)).blob();
        file = new File([blob], 'blobbi-polaroid.png', { type: 'image/png' });
      } catch {
        return { status: 'failed', stage: 'capture' };
      }

      let imageUrl: string;
      try {
        const tags = await uploadFile(file);
        // The uploader returns NIP-94 tags; the first one carries the URL.
        imageUrl = tags[0]?.[1] ?? '';
        if (!imageUrl) return { status: 'failed', stage: 'upload' };
      } catch {
        return { status: 'failed', stage: 'upload' };
      }

      try {
        await publishEvent(buildPhotoShareEvent({ caption, imageUrl }));
        return { status: 'published' };
      } catch {
        return { status: 'failed', stage: 'publish' };
      }
    },
    [policy, uploadFile, publishEvent],
  );

  return { canShare: permitPhotoShare(policy).allowed, sharePhoto };
}
