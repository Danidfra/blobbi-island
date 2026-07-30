/**
 * FORM ⇄ EVENT. The only place the Item Studio crosses between "what a human
 * typed" and "what a relay stores".
 *
 * Both directions delegate the protocol itself to `@nostr-games/inventory`:
 * `buildGameItemDefinitionEvent` decides tag order, image-tag emission and
 * required-field enforcement; `parseGameItemDefinitionResult` decides what a
 * stored event means. This module owns exactly two things the package cannot
 * know about — how a form's rows map onto repeatable tags, and which tags the
 * form does NOT manage.
 *
 * ## Unknown-tag preservation
 *
 * The merge policy, stated once:
 *
 *   a tag whose name is in {@link MANAGED_TAG_NAMES}  → regenerated from the form
 *   an `a` tag carrying the `based_on` marker         → regenerated from the form
 *   everything else                                   → preserved verbatim
 *
 * That is the whole rule. It is deliberately name-based rather than
 * value-based: if a future spec version adds `["durability", "40"]`, this form
 * has no field for it, so it lands in `extraTags`, survives an edit, and is
 * republished untouched. The alternative — dropping what we don't recognize —
 * would make this tool destructive to anything published by a newer client.
 *
 * The same policy applies inside `content`: keys the structured editor models
 * are rebuilt, and every other key rides along in `ContentFormState.extra`.
 *
 * ## The primary image
 *
 * A primary image is an `image` tag with no third element. The form models it
 * as `marker === ''` and this module asserts the literal string `"primary"`
 * never reaches a tag — that string is a UI label for "unmarked", nothing more.
 *
 * ## One thing the round trip normalizes, on purpose
 *
 * `buildGameItemDefinitionEvent` emits the unmarked primary image FIRST and the
 * marked views after it. A definition that published its primary in the middle
 * of the list therefore comes back with the primary hoisted. That is the
 * library's documented tag ordering, not information the form dropped: the
 * form itself holds the event's original order (so the image manager shows you
 * what was published), and the relative order of the MARKED views — the part
 * clients actually read in sequence — survives untouched. Reproducing the
 * original interleaving would mean bypassing the builder, which is the one
 * thing this integration will not do.
 */

import type { NostrEvent } from '@nostrify/nostrify';

import {
  BASED_ON_MARKER,
  KIND_GAME_ITEM_DEFINITION,
  buildGameItemAddress,
  buildGameItemDefinitionEvent,
  parseGameItemAddress,
  parseGameItemDefinitionResult,
  type BuildGameItemDefinitionInput,
  type GameItemImage,
  type ParseWarning,
  type UnsignedEventTemplate,
} from '@/inventory/package';

import {
  type ContentFormState,
  type EffectRow,
  type ImageRow,
  type ItemFormState,
  type MetadataRow,
  PRIMARY_MARKER,
  blankContent,
  blankItemForm,
  nextRowId,
} from './item-form-model';

/**
 * Tag names the form owns and therefore regenerates on every publish.
 *
 * This list mirrors the package builder's own managed set — it has to, because
 * the builder throws when `extraTags` contains one of them. Keeping the two in
 * sync is asserted by `form-event-conversion.test.ts`, which round-trips a
 * definition carrying every managed tag.
 */
export const MANAGED_TAG_NAMES: ReadonlySet<string> = new Set([
  'd',
  'name',
  'type',
  'category',
  'image',
  'model_3d',
  'audio',
  'symbol',
  'rarity',
  'max_stack',
  'version',
  'context',
  't',
  'alt',
]);

/**
 * Is this tag regenerated from form state (rather than preserved verbatim)?
 *
 * An `a` tag counts as managed ONLY when it carries the `based_on` marker;
 * every other `a` usage a future spec might introduce is unmanaged and
 * survives, which is exactly how the package builder treats it too.
 */
export function isManagedTag(tag: readonly string[]): boolean {
  const [name] = tag;
  if (name === 'a') return tag[3] === BASED_ON_MARKER;
  return MANAGED_TAG_NAMES.has(name);
}

/** Split an event's tags into the ones the form regenerates and the rest. */
export function partitionTags(tags: readonly string[][]): {
  managed: string[][];
  unmanaged: string[][];
} {
  const managed: string[][] = [];
  const unmanaged: string[][] = [];
  for (const tag of tags) {
    (isManagedTag(tag) ? managed : unmanaged).push([...tag]);
  }
  return { managed, unmanaged };
}

// --- Content serialization -------------------------------------------------

/** A conversion that can fail with a human-readable reason. */
export type ConversionResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/** Coerce one effect row's text into the JSON value it represents. */
function effectValue(row: EffectRow): ConversionResult<unknown> {
  if (row.valueType === 'number') {
    const n = Number(row.value.trim());
    if (row.value.trim() === '' || !Number.isFinite(n)) {
      return {
        ok: false,
        error: `Effect "${row.key}" is typed as a number but "${row.value}" is not one.`,
      };
    }
    return { ok: true, value: n };
  }
  if (row.valueType === 'boolean') {
    return { ok: true, value: row.value.trim() === 'true' };
  }
  return { ok: true, value: row.value };
}

/** Coerce one metadata row's text into the JSON value it represents. */
function metadataValue(row: MetadataRow): ConversionResult<unknown> {
  switch (row.valueType) {
    case 'number': {
      const n = Number(row.value.trim());
      if (row.value.trim() === '' || !Number.isFinite(n)) {
        return {
          ok: false,
          error: `Metadata "${row.key}" is typed as a number but "${row.value}" is not one.`,
        };
      }
      return { ok: true, value: n };
    }
    case 'boolean':
      return { ok: true, value: row.value.trim() === 'true' };
    case 'json':
      try {
        return { ok: true, value: JSON.parse(row.value) };
      } catch (error) {
        return {
          ok: false,
          error: `Metadata "${row.key}" is not valid JSON: ${(error as Error).message}`,
        };
      }
    default:
      return { ok: true, value: row.value };
  }
}

/**
 * Build the `content` string from the content editor.
 *
 * In `json` mode (and for content that was never a JSON object) the raw text is
 * authoritative and is validated but not reformatted — an issuer who hand-wrote
 * their content gets their bytes back. In `structured` mode the managed fields
 * are assembled and every unmanaged key is appended verbatim.
 *
 * An entirely empty structured form serializes to `""`, not `"{}"`: an empty
 * content field is valid and is what a tag-only definition should publish.
 */
export function buildContentString(
  content: ContentFormState,
): ConversionResult<string> {
  if (content.mode === 'json' || content.rawOnly) {
    const raw = content.raw.trim();
    if (raw === '') return { ok: true, value: '' };
    try {
      JSON.parse(raw);
    } catch (error) {
      return {
        ok: false,
        error: `Content is not valid JSON: ${(error as Error).message}`,
      };
    }
    return { ok: true, value: content.raw };
  }

  const out: Record<string, unknown> = {};

  const description = content.description.trim();
  if (description !== '') out.description = content.description;

  const effects: Record<string, Record<string, unknown>> = {};
  for (const row of content.effects) {
    const context = row.context.trim();
    const key = row.key.trim();
    if (context === '' || key === '') continue;
    const value = effectValue(row);
    if (!value.ok) return value;
    (effects[context] ??= {})[key] = value.value;
  }
  if (Object.keys(effects).length > 0) out.effects = effects;

  const metadata: Record<string, unknown> = {};
  for (const row of content.metadata) {
    const key = row.key.trim();
    if (key === '') continue;
    const value = metadataValue(row);
    if (!value.ok) return value;
    metadata[key] = value.value;
  }
  if (Object.keys(metadata).length > 0) out.metadata = metadata;

  const visual: Record<string, unknown> = {};
  if (content.visual.slot.trim() !== '') visual.slot = content.visual.slot;
  const forms = content.visual.forms.filter((f) => f.trim() !== '');
  if (forms.length > 0) visual.forms = forms;
  for (const [key, value] of Object.entries(content.visual.extra)) {
    if (!(key in visual)) visual[key] = value;
  }
  if (Object.keys(visual).length > 0) out.visual = visual;

  for (const [key, value] of Object.entries(content.extra)) {
    if (!(key in out)) out[key] = value;
  }

  if (Object.keys(out).length === 0) return { ok: true, value: '' };
  return { ok: true, value: JSON.stringify(out) };
}

// --- Form → event ----------------------------------------------------------

/** Image rows reduced to what the package builder accepts. */
export function imageRowsToPackageImages(
  rows: readonly ImageRow[],
): GameItemImage[] {
  const out: GameItemImage[] = [];
  for (const row of rows) {
    const url = row.url.trim();
    if (url === '') continue;
    const marker = row.marker.trim();
    out.push(marker === PRIMARY_MARKER ? { url } : { url, marker });
  }
  return out;
}

/**
 * The image candidate shape the production resolution helpers consume, built
 * from live form rows.
 *
 * This is what lets the preview panel call `primaryItemImageUrl` and
 * `itemImageSourcesForView` — the exact functions inventory rows and the
 * accessory resolver use — against an item that has not been published yet.
 */
export function formImageCandidate(form: ItemFormState): {
  images: GameItemImage[];
  image?: string;
} {
  const images = imageRowsToPackageImages(form.images);
  return { images, image: images.find((image) => !image.marker)?.url };
}

/**
 * Project the form onto the package builder's input.
 *
 * Blank optional values are omitted rather than emitted as empty tags, which is
 * what keeps "the user cleared this field" from publishing `["alt", ""]`.
 */
export function formToBuildInput(
  form: ItemFormState,
): ConversionResult<BuildGameItemDefinitionInput> {
  const content = buildContentString(form.content);
  if (!content.ok) return content;

  const optional = (value: string) =>
    value.trim() === '' ? undefined : value.trim();

  const basedOn = form.basedOn
    .filter((row) => row.address.trim() !== '')
    .map((row) => ({ address: row.address.trim(), relay: row.relay.trim() }));

  return {
    ok: true,
    value: {
      id: form.d.trim(),
      name: form.name.trim(),
      type: form.type.trim(),
      category: optional(form.category),
      images: imageRowsToPackageImages(form.images),
      model3d: optional(form.model3d),
      audio: optional(form.audio),
      symbol: optional(form.symbol),
      rarity: optional(form.rarity),
      maxStack: optional(form.maxStack),
      version: optional(form.version),
      alt: optional(form.alt),
      contexts: form.contexts.filter((c) => c.trim() !== ''),
      topics: form.topics.filter((t) => t.trim() !== ''),
      basedOn,
      content: content.value,
      extraTags: form.extraTags.map((tag) => [...tag]),
    },
  };
}

/**
 * Build the unsigned kind:31632 template for this form.
 *
 * Every rejection comes from the package builder (missing `id`/`name`/`type`,
 * a bad `max_stack`, a malformed `based_on` address, an ambiguous primary
 * image, an `extraTags` conflict) rather than from a second implementation of
 * its rules here — that is the point of routing through it at all.
 */
export function formToUnsignedEvent(
  form: ItemFormState,
): ConversionResult<UnsignedEventTemplate<typeof KIND_GAME_ITEM_DEFINITION>> {
  const input = formToBuildInput(form);
  if (!input.ok) return input;
  try {
    const template = buildGameItemDefinitionEvent(input.value);
    assertNoLiteralPrimaryMarker(template.tags);
    return { ok: true, value: template };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/**
 * The primary image is the ABSENCE of a marker. If the literal string
 * `"primary"` ever appeared in slot 2 of an `image` tag, every other client
 * would read it as an unknown view marker and the item would have no primary
 * image at all — so this is checked rather than assumed.
 */
function assertNoLiteralPrimaryMarker(tags: readonly string[][]): void {
  for (const tag of tags) {
    if (tag[0] === 'image' && tag[2] === 'primary') {
      throw new Error(
        'Refusing to publish an image tag marked "primary": the primary image is an unmarked image tag.',
      );
    }
  }
}

/**
 * The unsigned event as it will be signed, for preview and inspection.
 *
 * `id` and `sig` stay empty because they do not exist until the signer runs,
 * and `created_at` is a preview value — the real one is stamped at signing.
 */
export function toPreviewEvent(
  template: UnsignedEventTemplate<typeof KIND_GAME_ITEM_DEFINITION>,
  pubkey: string,
  createdAt: number,
): NostrEvent {
  return {
    id: '',
    pubkey,
    created_at: createdAt,
    kind: template.kind,
    tags: template.tags,
    content: template.content,
    sig: '',
  };
}

/** The full `31632:<pubkey>:<d>` address a form would publish to. */
export function formAddress(form: ItemFormState, pubkey: string): string | null {
  const d = form.d.trim();
  if (d === '' || pubkey === '') return null;
  try {
    return buildGameItemAddress(pubkey, d);
  } catch {
    return null;
  }
}

// --- Event → form ----------------------------------------------------------

/** Read the content JSON into the structured editor, preserving what it can't model. */
function contentToForm(rawContent: string, contentJson: unknown): ContentFormState {
  const base = blankContent();
  if (rawContent.trim() === '') return base;

  const isPlainObject =
    !!contentJson && typeof contentJson === 'object' && !Array.isArray(contentJson);

  if (!isPlainObject) {
    // A bare string, an array, or invalid JSON. Structured mode cannot express
    // it, so the editor stays raw and gives the bytes back untouched.
    return { ...base, mode: 'json', raw: rawContent, rawOnly: true };
  }

  const obj = contentJson as Record<string, unknown>;
  const managedKeys = new Set(['description', 'effects', 'metadata', 'visual']);

  const description = typeof obj.description === 'string' ? obj.description : '';

  const effects: EffectRow[] = [];
  if (obj.effects && typeof obj.effects === 'object' && !Array.isArray(obj.effects)) {
    for (const [context, bag] of Object.entries(obj.effects as Record<string, unknown>)) {
      if (!bag || typeof bag !== 'object' || Array.isArray(bag)) continue;
      for (const [key, value] of Object.entries(bag as Record<string, unknown>)) {
        effects.push({
          id: nextRowId('effect'),
          context,
          key,
          value: typeof value === 'string' ? value : JSON.stringify(value),
          valueType:
            typeof value === 'number'
              ? 'number'
              : typeof value === 'boolean'
                ? 'boolean'
                : 'string',
        });
      }
    }
  }

  const metadata: MetadataRow[] = [];
  if (obj.metadata && typeof obj.metadata === 'object' && !Array.isArray(obj.metadata)) {
    for (const [key, value] of Object.entries(obj.metadata as Record<string, unknown>)) {
      const valueType =
        typeof value === 'number'
          ? 'number'
          : typeof value === 'boolean'
            ? 'boolean'
            : typeof value === 'string'
              ? 'string'
              : 'json';
      metadata.push({
        id: nextRowId('metadata'),
        key,
        value: typeof value === 'string' ? value : JSON.stringify(value),
        valueType,
      });
    }
  }

  const visual = { slot: '', forms: [] as string[], extra: {} as Record<string, unknown> };
  if (obj.visual && typeof obj.visual === 'object' && !Array.isArray(obj.visual)) {
    for (const [key, value] of Object.entries(obj.visual as Record<string, unknown>)) {
      if (key === 'slot' && typeof value === 'string') visual.slot = value;
      else if (key === 'forms' && Array.isArray(value)) {
        visual.forms = value.filter((f): f is string => typeof f === 'string');
      } else visual.extra[key] = value;
    }
  }

  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!managedKeys.has(key)) extra[key] = value;
  }

  return {
    mode: 'structured',
    description,
    effects,
    metadata,
    visual,
    raw: rawContent,
    extra,
    rawOnly: false,
  };
}

/**
 * Read raw content text into the structured editor.
 *
 * Used when switching from JSON mode back to structured mode, which is allowed
 * ONLY when the text is a JSON object — the structured editor has fields for
 * objects and no way to represent a bare array or string, so the switch is
 * refused with a reason rather than silently discarding the content.
 */
export function contentStringToFormState(
  raw: string,
): ConversionResult<ContentFormState> {
  if (raw.trim() === '') return { ok: true, value: blankContent() };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { ok: false, error: `Content is not valid JSON: ${(error as Error).message}` };
  }
  const state = contentToForm(raw, parsed);
  if (state.rawOnly) {
    return {
      ok: false,
      error:
        'Content is valid JSON but not an object. Structured mode can only edit a JSON object.',
    };
  }
  return { ok: true, value: state };
}

export interface EventToFormOptions {
  /** Relays this event was actually seen on, when known. */
  relays?: readonly string[];
  /** Whether this is the newest event this client knows for the address. */
  isLatestKnown?: boolean;
}

export interface EventToFormSuccess {
  ok: true;
  form: ItemFormState;
  /** Parser warnings for the loaded event, shown non-fatally in the UI. */
  warnings: ParseWarning[];
}

/**
 * Load a published kind:31632 event into the form.
 *
 * Rejection is the package's call, not ours. On success every managed field is
 * populated from the PARSED definition (so image order and unknown markers come
 * through exactly as the package read them) while unmanaged tags are taken from
 * the RAW event, because the parser does not report what it ignored.
 */
export function eventToForm(
  event: NostrEvent,
  options: EventToFormOptions = {},
): EventToFormSuccess | { ok: false; error: string; warnings: ParseWarning[] } {
  const result = parseGameItemDefinitionResult(event, { mode: 'permissive' });
  if (!result.ok) {
    return { ok: false, error: result.error, warnings: result.warnings };
  }
  const def = result.value;
  const { unmanaged } = partitionTags(event.tags);

  const form: ItemFormState = {
    ...blankItemForm(),
    d: def.id,
    name: def.name,
    type: def.type,
    category: def.category ?? '',
    symbol: def.symbol ?? '',
    rarity: def.rarity ?? '',
    maxStack: def.maxStack ?? '',
    version: def.version ?? '',
    alt: def.alt ?? '',
    images: def.images.map((image) => ({
      id: nextRowId('image'),
      url: image.url,
      marker: image.marker ?? PRIMARY_MARKER,
    })),
    contexts: [...def.contexts],
    topics: [...def.topics],
    model3d: def.model3d ?? '',
    audio: def.audio ?? '',
    basedOn: def.basedOn.map((ref) => ({
      id: nextRowId('based-on'),
      address: ref.address,
      relay: ref.relay,
    })),
    content: contentToForm(def.content, def.contentJson),
    extraTags: unmanaged,
    loaded: {
      eventId: event.id,
      pubkey: event.pubkey,
      createdAt: event.created_at,
      address: def.address,
      relays: [...(options.relays ?? [])],
      isLatestKnown: options.isLatestKnown ?? true,
    },
  };

  return { ok: true, form, warnings: result.warnings };
}

/**
 * Turn a loaded form into a NEW item: same content, no provenance, and a `d`
 * the caller must change.
 *
 * Used by "Duplicate as new" and by "Use as template" for another issuer's
 * definition. Optionally records the source as a `based_on` derivation —
 * which asserts lineage only, never ownership or endorsement.
 */
export function asNewItem(
  form: ItemFormState,
  options: { derivedFrom?: string; d?: string } = {},
): ItemFormState {
  const basedOn = options.derivedFrom
    ? [
        ...form.basedOn,
        { id: nextRowId('based-on'), address: options.derivedFrom, relay: '' },
      ]
    : form.basedOn.map((row) => ({ ...row, id: nextRowId('based-on') }));

  return {
    ...form,
    d: options.d ?? form.d,
    images: form.images.map((row) => ({ ...row, id: nextRowId('image') })),
    basedOn,
    loaded: null,
  };
}

/** Is `address` a well-formed kind:31632 coordinate? */
export function isItemDefinitionAddress(address: string): boolean {
  return parseGameItemAddress(address.trim()) !== null;
}
