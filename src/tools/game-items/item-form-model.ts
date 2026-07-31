/**
 * The Item Studio's FORM MODEL — the shape a human edits, as opposed to the
 * shape a relay stores.
 *
 * Everything here is plain, serializable data with no React and no Nostr: the
 * same object is what the editor mutates, what autosave writes to localStorage,
 * and what `form-event-conversion.ts` turns into an unsigned kind:31632 event.
 * Keeping it free of both frameworks is what lets the conversion round-trip be
 * tested as pure functions.
 *
 * WHY A SEPARATE MODEL AT ALL. A kind:31632 event is a tag list: repeated
 * `image` tags, repeated `context`/`t` tags, a JSON `content` blob. A form needs
 * stable row identities so React can key a list through reordering, needs to
 * remember an empty row the user just added (which serializes to nothing), and
 * needs to remember which content fields it does NOT understand so republishing
 * cannot silently delete them. None of that survives a round trip through tags,
 * so the form owns it.
 *
 * The one naming decision worth stating: a row whose `marker` is the empty
 * string IS the primary image. The literal string `"primary"` is a UI label and
 * never reaches the wire — see {@link PRIMARY_MARKER}.
 */

import { GAME_ITEM_IMAGE_MARKERS } from '@/inventory/package';

// --- Row identity ----------------------------------------------------------

let rowCounter = 0;

/**
 * A process-unique id for a repeatable row.
 *
 * Only ever used as a React key and as a handle for edit/remove/reorder — it is
 * never serialized into an event, so a counter is enough and is deterministic
 * in tests, unlike a random id.
 */
export function nextRowId(prefix = 'row'): string {
  rowCounter += 1;
  return `${prefix}-${rowCounter}`;
}

/**
 * Advance the counter past ids that already exist, so a RESTORED draft cannot
 * collide with freshly minted rows.
 *
 * The bug this fixes: the counter lives in module scope, so it restarts at 0 on
 * every page load — but draft rows are persisted to localStorage and come back
 * still carrying `image-1`, `image-2`, … Adding a row after a reload therefore
 * minted `image-1` a second time. React reported it ("two children with the same
 * key, `image-2`") and the same collision applies to DRAFT ids, where two drafts
 * sharing an id is a data problem rather than a rendering one.
 *
 * Seeding the counter rather than randomizing the id keeps the documented
 * property above: ids stay a deterministic sequence within a run, which is what
 * makes them readable in tests and in the DOM.
 *
 * Only the numeric suffix matters, and only when it parses — an id from some
 * other scheme is ignored rather than guessed at.
 */
export function reserveRowIds(ids: Iterable<string>): void {
  for (const id of ids) {
    const suffix = Number.parseInt(id.slice(id.lastIndexOf('-') + 1), 10);
    if (Number.isFinite(suffix) && suffix > rowCounter) rowCounter = suffix;
  }
}

// --- Rows ------------------------------------------------------------------

/**
 * The marker value that means "this is the primary/default image".
 *
 * The wire format for a primary image is an `["image", "<url>"]` tag with NO
 * third element, so the form models it as the absence of a marker rather than
 * as a marker named `primary`. `form-event-conversion.ts` asserts the literal
 * `"primary"` never leaves the form.
 */
export const PRIMARY_MARKER = '';

/** One `image` tag being edited. */
export interface ImageRow {
  id: string;
  url: string;
  /** `''` for the primary image; otherwise the raw marker written to the tag. */
  marker: string;
}

export type EffectValueType = 'number' | 'string' | 'boolean';

/** One entry inside `content.effects[<context>]`. */
export interface EffectRow {
  id: string;
  /** The effect context key, e.g. `game:blobbi`. */
  context: string;
  /** The effect name, e.g. `hunger`. */
  key: string;
  /** Always held as text; coerced on serialization per {@link valueType}. */
  value: string;
  valueType: EffectValueType;
}

export type MetadataValueType = 'string' | 'number' | 'boolean' | 'json';

/** One entry inside `content.metadata`. */
export interface MetadataRow {
  id: string;
  key: string;
  value: string;
  valueType: MetadataValueType;
}

/** One `a` tag carrying the `based_on` marker. */
export interface DerivationRow {
  id: string;
  address: string;
  relay: string;
}

// --- Content ---------------------------------------------------------------

export type ContentMode = 'structured' | 'json';

/**
 * The `content.visual` object, split into managed fields and the rest.
 *
 * TWO SHAPES, ONE OBJECT. A `visual` describes either a **wearable accessory**
 * (`slot` — where it sits on the body) or a **visual effect** (`kind`, `effect`,
 * `effectSlot` — which locally-implemented effect it grants). They are modelled
 * as sibling fields rather than a discriminated union because that is what the
 * wire format is: one JSON object whose keys a reader picks from. A union here
 * would force the editor to throw away one side's fields whenever the author
 * changed their mind, and losing typed input to a mode switch is exactly the
 * class of bug this form's `extra` machinery exists to avoid.
 *
 * `kind` is the discriminator a reader uses: {@link BLOBBI_EFFECT_VISUAL_KIND}
 * means "this is a visual effect". Absent means "a wearable, read `slot`".
 */
export interface VisualFormState {
  /** `visual.slot` — where a WEARABLE sits. Not used by effect items. */
  slot: string;
  /** `visual.kind` — the discriminator; {@link BLOBBI_EFFECT_VISUAL_KIND}. */
  kind: string;
  /** `visual.effect` — the effect id this item grants. */
  effect: string;
  /** `visual.effectSlot` — which effect slot it competes for. */
  effectSlot: string;
  forms: string[];
  /** `visual` keys the structured editor does not manage, preserved verbatim. */
  extra: Record<string, unknown>;
}

/**
 * The `content` field being edited.
 *
 * `mode` decides which half is authoritative: in `structured` mode the typed
 * fields build the JSON, in `json` mode `raw` IS the content. `extra` holds
 * top-level content keys the structured editor does not model, so a definition
 * published by a newer client survives an edit here.
 */
export interface ContentFormState {
  mode: ContentMode;
  description: string;
  effects: EffectRow[];
  metadata: MetadataRow[];
  visual: VisualFormState;
  /** Raw JSON text. Authoritative in `json` mode. */
  raw: string;
  /** Unmanaged top-level content keys, preserved verbatim. */
  extra: Record<string, unknown>;
  /**
   * The loaded content was not a JSON object (a bare string, an array, or
   * invalid JSON). Structured mode cannot represent it, so the editor stays in
   * JSON mode and preserves the text exactly.
   */
  rawOnly: boolean;
}

// --- Provenance ------------------------------------------------------------

/** What is known about the published event a form was loaded from. */
export interface LoadedItemMeta {
  eventId: string;
  /** The author of the loaded event — NOT necessarily the current signer. */
  pubkey: string;
  createdAt: number;
  address: string;
  /** Relays the event was actually seen on, when known. */
  relays: string[];
  /**
   * Whether this is the newest event this client has seen for the address.
   * Goes false when a newer replaceable event arrives while editing.
   */
  isLatestKnown: boolean;
}

// --- The form --------------------------------------------------------------

/**
 * The complete Item Studio form.
 *
 * `extraTags` is the unknown-tag preservation store: every tag on a loaded
 * event that no form field manages, kept in original order and re-emitted on
 * publish. See `form-event-conversion.ts` for the managed/unmanaged split.
 */
export interface ItemFormState {
  d: string;
  name: string;
  type: string;
  category: string;
  symbol: string;
  rarity: string;
  /** Numeric text; serialized as a string tag per the spec. */
  maxStack: string;
  version: string;
  alt: string;
  images: ImageRow[];
  contexts: string[];
  topics: string[];
  model3d: string;
  audio: string;
  basedOn: DerivationRow[];
  content: ContentFormState;
  /** Tags no form field manages, preserved verbatim across an edit. */
  extraTags: string[][];
  /** Provenance of the loaded event, or `null` for a fresh draft. */
  loaded: LoadedItemMeta | null;
}

/** An empty content editor in structured mode. */
export function blankContent(): ContentFormState {
  return {
    mode: 'structured',
    description: '',
    effects: [],
    metadata: [],
    visual: blankVisual(),
    raw: '',
    extra: {},
    rawOnly: false,
  };
}

/** An empty `visual`, in neither shape until the author picks one. */
export function blankVisual(): VisualFormState {
  return { slot: '', kind: '', effect: '', effectSlot: '', forms: [], extra: {} };
}

/** A brand-new, empty item form. */
export function blankItemForm(): ItemFormState {
  return {
    d: '',
    name: '',
    type: '',
    category: '',
    symbol: '',
    rarity: '',
    maxStack: '',
    version: '',
    alt: '',
    images: [],
    contexts: [],
    topics: [],
    model3d: '',
    audio: '',
    basedOn: [],
    content: blankContent(),
    extraTags: [],
    loaded: null,
  };
}

/** A fresh, empty image row. */
export function blankImageRow(marker = PRIMARY_MARKER): ImageRow {
  return { id: nextRowId('image'), url: '', marker };
}

/** A fresh, empty derivation row. */
export function blankDerivationRow(): DerivationRow {
  return { id: nextRowId('based-on'), address: '', relay: '' };
}

// --- Authoring vocabulary --------------------------------------------------

/**
 * `type` values the spec recommends. The select also accepts a custom
 * lowercase value, because `type` is a free string on the wire.
 */
export const ITEM_TYPE_OPTIONS: readonly string[] = [
  'consumable',
  'cosmetic',
  'material',
  'currency',
  'quest',
  'container',
  'tool',
  'weapon',
  'armor',
  'misc',
];

/**
 * Category suggestions. Deliberately NOT an enum: `category` is an open string
 * and a closed list here would block a category invented next week.
 */
export const CATEGORY_SUGGESTIONS: readonly string[] = [
  'headwear',
  'eyewear',
  'back',
  'neckwear',
  'handheld',
  // Not a place on the body: an `effect` item grants a visual effect that
  // surrounds the character. Picking it seeds the effect visual shape — see
  // `contentPatchForCategory`.
  'effect',
  'food',
  'toy',
  'medicine',
  'hygiene',
  'currency',
];

/** Rarity values the spec recommends. Display metadata only. */
export const RARITY_OPTIONS: readonly string[] = [
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
  'mythic',
  'unique',
];

export const CONTEXT_SUGGESTIONS: readonly string[] = [
  'game:blobbi',
  'game:blobbi-island',
  'cross-game',
  'collection:nostr-games',
];

/** Topic suggestions aimed at wearable accessories and visual effects. */
export const TOPIC_SUGGESTIONS: readonly string[] = [
  'equipable',
  'wearable',
  'headwear',
  'eyewear',
  'back',
  'neckwear',
  'handheld',
  'face-mark',
  'aura',
  'cosmetic',
  'visual-effect',
  'particles',
  'arcade-prize',
];

/**
 * `visual.slot` suggestions — the accessory slots `@blobbi/react` can draw.
 *
 * A slot describes where an accessory WOULD sit if worn. It is not a claim
 * that anyone has equipped it; that is inventory/equipment data and is out of
 * scope for an item definition.
 */
export const SLOT_SUGGESTIONS: readonly string[] = [
  'headwear',
  'eyewear',
  'back',
  'neckwear',
  'handheld',
  'face-mark',
  'aura',
  'color-overlay',
];

/** `visual.forms` suggestions — the Blobbi life stages. */
export const FORM_SUGGESTIONS: readonly string[] = ['egg', 'baby', 'adult'];

// --- Visual effects --------------------------------------------------------
//
// An effect item is an ordinary kind:31632 definition. What makes it an effect
// is `content.visual.kind === 'blobbi-effect'` plus an `effect` id — and that
// id is a NAME, never an implementation. No animation, CSS or markup is ever
// carried in an event or read out of one; the effect code lives in
// `@blobbi/react` and Island resolves a TRUSTED item address to a local effect
// (`src/effects/official-visual-effect-items.ts`). Publishing an item with
// `effect: "celestial-aura"` from another key therefore grants nothing.
// See docs/blobbi-visual-effects.md §§1–3.

/** The `visual.kind` value that marks a definition as a Blobbi visual effect. */
export const BLOBBI_EFFECT_VISUAL_KIND = 'blobbi-effect';

/** The `category` tag value that means "this item is a visual effect". */
export const EFFECT_CATEGORY = 'effect';

/**
 * The four slots an effect may occupy.
 *
 * WRITTEN OUT rather than imported from `@blobbi/react`, because this module is
 * the tools' pure domain layer and importing the renderer here would put React
 * in the middle of event building — a boundary `boundaries.test.ts` enforces.
 * Four short strings are a fair price for that; a twelve-entry EFFECT ID list
 * would not be, which is why the ids live in the component layer instead
 * (`effect-vocabulary.ts`).
 *
 * Drift is prevented by a test, not by hope: `effect-item-authoring.test.ts`
 * imports the renderer's own `EFFECT_SLOT_ORDER` and asserts the two are equal.
 * A test may import anything; production code here may not.
 */
export const EFFECT_SLOT_SUGGESTIONS: readonly string[] = [
  'aura',
  'ground-local',
  'ambient-particles',
  'body-overlay',
];

/** Is this visual authored as a Blobbi visual effect? */
export function isEffectVisual(visual: VisualFormState): boolean {
  return visual.kind.trim() === BLOBBI_EFFECT_VISUAL_KIND;
}

/**
 * Is this form an effect item?
 *
 * Either signal counts, deliberately. `visual.kind` is the authoritative one a
 * reader uses, but an author who has only set `category: "effect"` so far is
 * clearly authoring an effect and should not be told their wearable is missing
 * a slot.
 */
export function isEffectItemForm(form: ItemFormState): boolean {
  return (
    isEffectVisual(form.content.visual) ||
    form.category.trim().toLowerCase() === EFFECT_CATEGORY
  );
}

/**
 * The content patch implied by choosing a `category`, or `null` for none.
 *
 * SEEDS, NEVER CLEARS. Choosing `effect` fills in the one field that makes the
 * effect shape serialize at all (`visual.kind`) so the structured editor stops
 * silently producing a `visual` with only `forms` in it — the exact failure
 * this helper exists to fix. It does so ONLY when the visual is still
 * unclaimed: an item that already declares a `slot`, a `kind`, or any effect
 * field keeps whatever the author typed, because a category chip is not consent
 * to rewrite the content.
 */
export function contentPatchForCategory(
  content: ContentFormState,
  category: string,
): ContentFormState | null {
  if (category.trim().toLowerCase() !== EFFECT_CATEGORY) return null;
  if (content.mode !== 'structured' || content.rawOnly) return null;
  const { visual } = content;
  const claimed =
    visual.slot.trim() !== '' ||
    visual.kind.trim() !== '' ||
    visual.effect.trim() !== '' ||
    visual.effectSlot.trim() !== '';
  if (claimed) return null;
  return {
    ...content,
    visual: { ...visual, kind: BLOBBI_EFFECT_VISUAL_KIND },
  };
}

/** Effect key suggestions. Blobbi's stats, offered but never enforced. */
export const EFFECT_KEY_SUGGESTIONS: readonly string[] = [
  'hunger',
  'happiness',
  'health',
  'hygiene',
  'energy',
];

/** Common `content.metadata` keys. */
export const METADATA_KEY_SUGGESTIONS: readonly string[] = [
  'stackable',
  'craftingGroup',
  'itemId',
  'action',
  'emoji',
];

/** Every marker the installed package defines, plus the primary sentinel. */
export const IMAGE_MARKER_OPTIONS: readonly string[] = [
  PRIMARY_MARKER,
  ...GAME_ITEM_IMAGE_MARKERS,
];

/**
 * The artwork size Blobbi accessories are authored at.
 *
 * A different size is a WARNING, never a rejection: the protocol places no
 * constraint on image dimensions and an item that ships 512×512 art is valid.
 */
export const RECOMMENDED_IMAGE_SIZE = { width: 1024, height: 1024 } as const;

// --- Small helpers ---------------------------------------------------------

/**
 * Normalize one segment of a `d` tag: lowercase, spaces and punctuation to
 * single hyphens, no leading/trailing hyphen. Colons survive because the
 * recommended `d` shape is `<namespace>:<category>:<slug>`.
 */
export function slugifyDTag(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/(^-|-$)/g, '')
    .replace(/:-/g, ':')
    .replace(/-:/g, ':');
}

/** Is `value` a positive decimal integer, as `max_stack` requires? */
export function isPositiveIntegerText(value: string): boolean {
  return /^[1-9][0-9]*$/.test(value.trim());
}

/** Best-effort hostname for display, or the raw string when unparseable. */
export function urlHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Split a typed or pasted chunk into individual tag values.
 *
 * Commas, newlines and tabs all separate, so pasting `equipable, wearable`
 * yields two topics rather than one topic containing a comma.
 */
export function splitTagInput(raw: string): string[] {
  return raw
    .split(/[,\n\t]/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/** Does this string look like an absolute http(s) URL? */
export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
