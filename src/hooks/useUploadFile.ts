import { useMutation } from "@tanstack/react-query";
import { BlossomUploader } from '@nostrify/nostrify/uploaders';

import { useIslandSafetyPolicy } from "@/safety";

import { useCurrentUser } from "./useCurrentUser";

/**
 * Thrown when the experience does not permit uploading media.
 *
 * A distinct type because a refusal is not a failure. Blossom did not go down,
 * the signer did not misbehave, the file was not malformed; nothing was
 * attempted. A caller that showed "Upload failed" here would be lying and would
 * also be inviting a retry of something that will never work.
 */
export class MediaUploadNotPermittedError extends Error {
  readonly code = 'media-uploads-not-permitted' as const;

  constructor() {
    super('Media uploads are not available in this experience.');
    this.name = 'MediaUploadNotPermittedError';
  }
}

/** Narrow an unknown error to a policy refusal. */
export function isMediaUploadNotPermitted(error: unknown): error is MediaUploadNotPermittedError {
  return error instanceof MediaUploadNotPermittedError;
}

/**
 * The application's one Blossom uploader, and the enforcement point for
 * `mediaUploads`.
 *
 * ## Why the gate is here rather than only at the callers
 *
 * Every consumer of this hook is user-controlled media publication, which is
 * exactly what the capability governs. There are three, and the audit for this
 * phase checked each one:
 *
 *  - the PhotoBooth share (`ShareModal` → `usePhotoShare`);
 *  - the Game Item authoring tools (`tools/game-items/image-upload.ts`), whose
 *    route is separately gated on `authoringTools`;
 *  - `EditProfileForm`, which has no importer anywhere in `src/`: dead code.
 *
 * Nothing internal or trusted uploads through this hook: official item artwork
 * is published by the issuer through those same authoring tools, not by the
 * game. So gating here does not contaminate generic infrastructure serving
 * unrelated required operations; it puts the check on the narrowest thing that
 * every upload must pass through.
 *
 * `usePhotoShare` also decides up front, before it converts a blob, because
 * that is where the whole operation is judged. This gate is the guard against a
 * future caller that forgets to ask.
 */
export function useUploadFile() {
  const { user } = useCurrentUser();
  const policy = useIslandSafetyPolicy();

  return useMutation({
    mutationFn: async (file: File) => {
      // Before the signer, before the network: a refusal must not depend on
      // being logged in, and must not reach Blossom at all.
      if (!policy.mediaUploads) {
        throw new MediaUploadNotPermittedError();
      }

      if (!user) {
        throw new Error('Must be logged in to upload files');
      }

      const uploader = new BlossomUploader({
        servers: [
          'https://blossom.primal.net/',
        ],
        signer: user.signer,
      });

      const tags = await uploader.upload(file);
      return tags;
    },
  });
}
