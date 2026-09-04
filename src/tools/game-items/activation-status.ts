/**
 * Blobbi Island: is this published cosmetic actually WEARABLE yet?
 *
 * ## The gap this closes
 *
 * Publishing a kind:31632 definition and making it wearable are two different
 * things. Since the kind:31634 migration the gap is no longer a source-code
 * mapping: it is the DEFINITION'S OWN CONTENT. A cosmetic becomes wearable
 * when it is registered as an official identity, signed by the official issuer,
 * and declares a `content.visual.slot` this renderer supports. Nothing infers a
 * slot from an id or a code prefix any more, so an issuer who omits it has
 * published an item nothing can wear, and this module says so.
 *
 * It answers the question as DATA. Pure: no React, no Nostr, no clipboard, no
 * fetching. It compares a published record against this repository's trusted
 * identity registry and against what the definition itself declares.
 *
 * ## What it deliberately cannot do
 *
 * It cannot activate anything. The official identity list lives in source code
 * and is changed by a human editing `OFFICIAL_COSMETIC_DEFINITIONS` and
 * committing it; the browser only ever COPIES a snippet for that person to
 * paste. Letting a web UI write the trust list would defeat the point of it.
 *
 * It never infers ownership. "Wearable" means "if a player owned this, Island
 * could equip and draw it": not that anybody owns or is wearing one.
 */

import { officialCosmeticByD } from '@/protocol/event-registry';
import { EQUIPPABLE_SLOTS } from '@/placement/policy';
import { itemImageByMarker, primaryItemImageUrl } from '@/inventory/item-image-resolution';
import type { ItemImageCandidate } from '@/inventory/item-image-resolution';
import { OFFICIAL_ITEM_ISSUER_PUBKEY } from '@/inventory/constants';

/** The subset of a published record this analysis needs. */
export interface ActivationSubject {
  /** Full `31632:<pubkey>:<d>` address. */
  address: string;
  /** The signing pubkey. */
  issuer: string;
  /** The `d` tag. */
  d: string;
  /** The `type` tag, when present. */
  type?: string;
  /** The parsed `image` collection. */
  images?: readonly { readonly url: string; readonly marker?: string }[];
  /** The flattened legacy primary image. */
  image?: string;
  /** `content.visual.slot`, when the definition declares one. */
  visualSlot?: string;
}

/** One thing that is true, or wrong, about this definition's activation. */
export type ActivationFindingLevel = 'ok' | 'todo' | 'warn';

export interface ActivationFinding {
  level: ActivationFindingLevel;
  label: string;
  /** Extra context, e.g. the mapped code or the mismatching slots. */
  detail?: string;
}

export interface ActivationStatus {
  /** False for anything that is not an official cosmetic-shaped definition. */
  applicable: boolean;
  /** Signed by the official issuer? */
  isOfficialIssuer: boolean;
  /** Is this `d` in the official cosmetic identity registry? */
  isRegistered: boolean;
  /**
   * The supported slot this definition declares, or `null`.
   *
   * `null` covers "declared nothing" and "declared something this renderer does
   * not support" alike; both mean nothing can wear it.
   */
  declaredSlot: string | null;
  /**
   * True when the definition is registered, officially signed, and declares a
   * supported slot: everything the client controls is in place, and only
   * ownership (kind:31633) stands between a player and wearing it.
   */
  wearable: boolean;
  findings: readonly ActivationFinding[];
}

/**
 * Read `content.visual.slot` out of a parsed definition's content JSON.
 *
 * The slot is a Blobbi-specific rendering hint the spec leaves to `content`, so
 * the package hands it over as opaque JSON and this is where Island interprets
 * it. Tolerant by design: a definition with no content, non-object content, or
 * no `visual` block simply has no declared slot, which is a fact to report and
 * not an error to throw inside a diagnostics panel.
 */
export function readVisualSlot(contentJson: unknown): string | undefined {
  if (!contentJson || typeof contentJson !== 'object') return undefined;
  const visual = (contentJson as { visual?: unknown }).visual;
  if (!visual || typeof visual !== 'object') return undefined;
  const slot = (visual as { slot?: unknown }).slot;
  return typeof slot === 'string' && slot.trim() ? slot : undefined;
}

/** Project a parsed kind:31632 definition onto the subject this module reads. */
export function activationSubject(definition: {
  address: string;
  issuer: string;
  id: string;
  type?: string;
  image?: string;
  images?: readonly { readonly url: string; readonly marker?: string }[];
  contentJson?: unknown;
}): ActivationSubject {
  return {
    address: definition.address,
    issuer: definition.issuer,
    d: definition.id,
    type: definition.type,
    image: definition.image,
    images: definition.images,
    visualSlot: readVisualSlot(definition.contentJson),
  };
}

/** Only cosmetics have an activation story; a consumable is never "worn". */
function looksCosmetic(subject: ActivationSubject): boolean {
  return subject.type === 'cosmetic' || subject.d.startsWith('blobbi:cosmetic:');
}


/**
 * Everything the Item Studio can say about whether this definition is live.
 *
 * The findings are ordered from identity outwards: who signed it, whether a
 * code points at it, whether that code agrees with the artwork, and whether the
 * artwork a posed Blobbi needs is actually there.
 */
export function activationStatus(subject: ActivationSubject): ActivationStatus {
  const isOfficialIssuer = subject.issuer === OFFICIAL_ITEM_ISSUER_PUBKEY;

  if (!looksCosmetic(subject)) {
    return {
      applicable: false,
      isOfficialIssuer,
      isRegistered: false,
      declaredSlot: null,
      wearable: false,
      findings: [],
    };
  }

  const findings: ActivationFinding[] = [];
  findings.push({ level: 'ok', label: 'Published' });

  findings.push(
    isOfficialIssuer
      ? { level: 'ok', label: 'Official issuer' }
      : {
          level: 'warn',
          label: 'Not the official issuer',
          // Stated plainly because it is the whole trust story: a third party's
          // definition is a real event that this client will never render.
          detail: 'Only the official issuer’s definitions are ever resolved.',
        },
  );

  // Registered identity. Being signed by the official issuer is necessary but
  // not sufficient: Island only resolves cosmetics whose `d` it has declared
  // official, so an unregistered one is invisible no matter who signed it.
  const registered = officialCosmeticByD(subject.d);
  const isRegistered = registered !== null && registered.address === subject.address;

  if (!isRegistered) {
    findings.push({
      level: 'todo',
      label: 'Not registered as an official cosmetic',
      detail: 'Add it to OFFICIAL_COSMETIC_DEFINITIONS; nothing resolves it yet.',
    });
  } else {
    findings.push({ level: 'ok', label: 'Registered official cosmetic' });
  }

  // The declared slot IS the activation switch now. There is no fallback: a
  // definition that does not say where it is worn cannot be worn, because
  // Island refuses to guess placement from an id.
  const declared = subject.visualSlot?.trim();
  const declaredSlot =
    declared && (EQUIPPABLE_SLOTS as readonly string[]).includes(declared)
      ? declared
      : null;

  if (!declared) {
    findings.push({
      level: 'todo',
      label: 'No content.visual.slot',
      detail: 'Nothing can wear this: Island never infers a slot from the item id.',
    });
  } else if (declaredSlot === null) {
    findings.push({
      level: 'warn',
      label: 'Declares an unsupported slot',
      detail: `${declared} is not one of: ${EQUIPPABLE_SLOTS.join(', ')}`,
    });
  } else {
    findings.push({
      level: 'ok',
      label: 'Declares a supported slot',
      detail: declaredSlot,
    });
  }

  const wearable = isRegistered && isOfficialIssuer && declaredSlot !== null;
  if (wearable) {
    findings.push({
      level: 'ok',
      label: 'Wearable once owned',
      detail: 'Only a kind:31633 quantity is missing.',
    });
  }

  // Artwork. `primary` is what compact UI shows; `front`/`back` are what a posed
  // Blobbi asks for. A missing pose is not fatal, the resolver falls back, so
  // it is reported as work to do, not as breakage.
  const candidate: ItemImageCandidate = {
    images: subject.images as ItemImageCandidate['images'],
    image: subject.image,
  };

  if (!primaryItemImageUrl(candidate)) {
    findings.push({
      level: 'warn',
      label: 'Missing primary image',
      detail: 'Compact UI has nothing to draw.',
    });
  }
  if (!itemImageByMarker(candidate, 'front')) {
    findings.push({
      level: 'todo',
      label: 'No front view',
      detail: 'Front-facing Blobbis fall back to the primary image.',
    });
  }
  if (!itemImageByMarker(candidate, 'back')) {
    findings.push({
      level: 'todo',
      label: 'No back view',
      detail: 'Back-facing Blobbis fall back to the front/primary image.',
    });
  }

  return {
    applicable: true,
    isOfficialIssuer,
    isRegistered,
    declaredSlot,
    wearable,
    findings,
  };
}

/**
 * The entry a developer pastes into `OFFICIAL_COSMETIC_DEFINITIONS`.
 *
 * A REGISTRY ENTRY, not a code mapping: registration is what makes a `d`
 * official, and the slot comes from the published definition rather than from
 * anything written here.
 */
export function registrySnippet(subject: ActivationSubject): string {
  const primary = primaryItemImageUrl({
    images: subject.images as ItemImageCandidate['images'],
    image: subject.image,
  });
  return [
    '{',
    `  d: '${subject.d}',`,
    '  name: ‹display name›,',
    '  symbol: ‹emoji›,',
    `  primaryImage: ${primary ? `'${primary}'` : 'null'},`,
    "  status: 'active',",
    '},',
  ].join('\n');
}
