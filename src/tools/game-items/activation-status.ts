/**
 * Blobbi Island — is this published cosmetic actually WEARABLE yet?
 *
 * ## The gap this closes
 *
 * Publishing a kind:31632 definition and activating an accessory are two
 * different events separated by a source-code change. Between them the item is
 * real on relays and invisible in the game: nothing wears it, because no legacy
 * `equip` code maps to it. That gap is silent — the Published Items browser
 * shows a perfectly healthy row either way — and it is exactly where a person
 * publishing a batch of accessories loses track of which ones still need work.
 *
 * This module answers the question as DATA. It is pure: no React, no Nostr, no
 * clipboard, no fetching. It compares a published record against this
 * repository's mapping tables and reports what it finds.
 *
 * ## What it deliberately cannot do
 *
 * It cannot activate anything. The mapping lives in source code and is changed
 * by a human editing `OFFICIAL_COSMETIC_DEFINITIONS` and committing it; the
 * browser only ever COPIES a snippet for that person to paste. Letting a web UI
 * write the trust mapping would defeat the point of having one.
 *
 * It also never infers ownership. "Active in renderer" means "a worn accessory
 * with this code would be drawn from this definition" — not that anybody owns
 * or is wearing one.
 */

import {
  ACCESSORY_CODE_TO_OFFICIAL_ITEM_D,
  accessoryItemAddress,
} from '@/inventory/accessory-item-identity';
import { inferSlotFromCode } from '@/components/blobbi/lib/accessory-utils';
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

/** One thing that is true — or wrong — about this definition's activation. */
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
  /** The legacy accessory code mapped to this `d`, or `null`. */
  mappedCode: string | null;
  /** True when mapped AND the mapping resolves to THIS address. */
  activeInRenderer: boolean;
  findings: readonly ActivationFinding[];
  /** `'headwear-x': 'blobbi:cosmetic:y',` — for the mapping snippet. */
  suggestedCode: string | null;
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
 * A transitional code proposal for an unmapped cosmetic.
 *
 * Derived from the definition's own `visual.slot` plus the `d`'s last segment,
 * which is what the Block Builder Cap's code was chosen as by hand. It is a
 * SUGGESTION printed into a snippet for a human to review — the tool never
 * writes it anywhere.
 */
export function suggestLegacyCode(subject: ActivationSubject): string | null {
  const slug = subject.d.split(':').pop();
  if (!slug) return null;
  const slot = subject.visualSlot?.trim();
  if (!slot) return null;
  return `${slot}-${slug}`;
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
      mappedCode: null,
      activeInRenderer: false,
      findings: [],
      suggestedCode: null,
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

  const mappedCode =
    Object.entries(ACCESSORY_CODE_TO_OFFICIAL_ITEM_D).find(
      ([, d]) => d === subject.d,
    )?.[0] ?? null;

  // Mapped by `d` is not the same as mapped to THIS event: a third party can
  // publish the same `d`, and the mapping resolves only the official address.
  const mappedAddress = mappedCode ? accessoryItemAddress(mappedCode) : null;
  const activeInRenderer = Boolean(
    mappedCode && mappedAddress === subject.address,
  );

  if (!mappedCode) {
    findings.push({
      level: 'todo',
      label: 'Not mapped to a legacy accessory code',
      detail: 'Nothing can wear this item yet.',
    });
  } else if (!activeInRenderer) {
    findings.push({
      level: 'warn',
      label: 'Mapped, but to a different address',
      detail: `${mappedCode} → ${mappedAddress ?? 'unresolved'}`,
    });
  } else {
    findings.push({
      level: 'ok',
      label: 'Mapped to legacy accessory code',
      detail: mappedCode,
    });
    findings.push({ level: 'ok', label: 'Active in renderer' });
  }

  // Slot agreement. The mapping stores no slot — the code's prefix IS the slot —
  // so a mismatch means the item would be drawn in the wrong place on the body.
  if (mappedCode && subject.visualSlot) {
    const codeSlot = inferSlotFromCode(mappedCode);
    if (codeSlot !== subject.visualSlot) {
      findings.push({
        level: 'warn',
        label: 'Slot mismatch between definition and mapping',
        detail: `definition says ${subject.visualSlot}, code implies ${codeSlot}`,
      });
    }
  }

  // Artwork. `primary` is what compact UI shows; `front`/`back` are what a posed
  // Blobbi asks for. A missing pose is not fatal — the resolver falls back — so
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
    mappedCode,
    activeInRenderer,
    findings,
    suggestedCode: mappedCode ?? suggestLegacyCode(subject),
  };
}

/**
 * The line a developer pastes into `OFFICIAL_COSMETIC_DEFINITIONS`.
 *
 * Deliberately a REGISTRY ENTRY rather than a bare `code: d` pair: the mapping
 * is derived from that list, so the entry is the real edit and a lone pair would
 * point at a file nobody should be editing by hand.
 */
export function mappingSnippet(
  subject: ActivationSubject,
  status: ActivationStatus,
): string | null {
  const code = status.suggestedCode;
  if (!code) return null;
  return [
    '{',
    `  d: '${subject.d}',`,
    `  legacyCode: '${code}',`,
    '  name: ‹display name›,',
    '  symbol: ‹emoji›,',
    `  primaryImage: ${
      primaryItemImageUrl({
        images: subject.images as ItemImageCandidate['images'],
        image: subject.image,
      })
        ? `'${primaryItemImageUrl({
            images: subject.images as ItemImageCandidate['images'],
            image: subject.image,
          })}'`
        : 'null'
    },`,
    "  status: 'active',",
    '},',
  ].join('\n');
}
