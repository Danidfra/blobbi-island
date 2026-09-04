/**
 * Public publishing: the boundary for putting player-made content onto the
 * wider Nostr network.
 *
 * Deliberately narrow. Game protocol writes (presence, chat, pet state,
 * inventory, equipment, themes) are not public social publication and do not
 * come through here; gating them would break the island while protecting nobody.
 *
 * See `docs/family-safety-policy.md` for the capability model.
 */

export type { PhotoShareDenial, PhotoShareInput, PhotoSharePermission } from './photo-share';
export { PHOTO_SHARE_HASHTAGS, buildPhotoShareEvent, permitPhotoShare } from './photo-share';

export type { PhotoShareApi, PhotoShareOutcome, SharePhotoInput } from './usePhotoShare';
export { usePhotoShare } from './usePhotoShare';
