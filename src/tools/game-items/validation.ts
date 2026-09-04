/**
 * FOUR LAYERS OF FEEDBACK, and a hard rule about which of them can stop a
 * publication.
 *
 *   blocking   the event cannot be built or would be rejected as a definition
 *   protocol   the package parsed it, with warnings about what it ignored
 *   image      authoring concerns about the artwork itself
 *   authoring  Blobbi-specific and stylistic suggestions
 *
 * ONLY the first layer disables Publish. The spec expresses almost everything
 * else as SHOULD, and a tool that refuses to publish a valid-but-unusual
 * definition is a tool that lies about the protocol. A missing `alt`, a missing
 * primary image, an unknown marker, a 512×512 asset; all publishable, all
 * worth saying out loud.
 *
 * Blocking issues are never invented here. They come from
 * `validateGameItemDefinition`, from the builder throwing, or from content that
 * is not valid JSON, the three places the protocol actually says no. The one
 * judgement call is documented at {@link AMBIGUOUS_PRIMARY_CODE}.
 */

import type { NostrEvent } from '@nostrify/nostrify';

import {
  isGameItemImageMarker,
  parseGameItemAddress,
  parseGameItemDefinitionResult,
  validateGameItemDefinition,
} from '@/inventory/package';

import {
  BLOBBI_EFFECT_VISUAL_KIND,
  EFFECT_SLOT_SUGGESTIONS,
  type ItemFormState,
  PRIMARY_MARKER,
  RECOMMENDED_IMAGE_SIZE,
  isEffectItemForm,
  isHttpUrl,
  isPositiveIntegerText,
} from './item-form-model';

export type IssueGroup = 'blocking' | 'protocol' | 'image' | 'authoring';
export type IssueSeverity = 'error' | 'warning' | 'suggestion';

/** One line of feedback about the item being authored. */
export interface StudioIssue {
  /** Stable within a validation pass; used as a React key. */
  id: string;
  group: IssueGroup;
  severity: IssueSeverity;
  /** Machine-readable, for tests and for grouping. */
  code: string;
  message: string;
  /** The form field this attaches to, when it can be shown inline. */
  field?: string;
}

/** What the browser learned by actually loading an image URL. */
export interface ImageProbe {
  status: 'pending' | 'loaded' | 'error';
  width?: number;
  height?: number;
}

export interface ValidationInput {
  form: ItemFormState;
  /** The unsigned event, or `null` when it could not be built. */
  previewEvent: NostrEvent | null;
  /** The builder's rejection message, when the event could not be built. */
  buildError: string | null;
  /** url → load status, populated by the image manager as previews resolve. */
  probes: ReadonlyMap<string, ImageProbe>;
}

export interface StudioValidation {
  blocking: StudioIssue[];
  protocol: StudioIssue[];
  image: StudioIssue[];
  authoring: StudioIssue[];
  /** True when nothing in the blocking layer is outstanding. */
  isPublishable: boolean;
  /** field name → first blocking message, for inline display. */
  fieldErrors: Readonly<Record<string, string>>;
}

/**
 * Two DIFFERENT unmarked image URLs.
 *
 * The spec calls multiple primary images a SHOULD-level authoring mistake and
 * the parser reports it as a warning, an event carrying two is still a valid
 * definition, and this tool says so in the image layer. But
 * `buildGameItemDefinitionEvent` refuses to serialize an ambiguous primary, and
 * reimplementing the builder to get around that would violate the one rule this
 * integration is built on. So the condition appears twice: as an image warning
 * (what the protocol thinks) and as a blocking build error (what our builder
 * can actually emit).
 *
 * Two IDENTICAL unmarked URLs are not ambiguous, the builder de-duplicates
 * them: so those produce the warning alone and publish fine.
 */
export const AMBIGUOUS_PRIMARY_CODE = 'ambiguous-primary-image';

function issue(
  group: IssueGroup,
  severity: IssueSeverity,
  code: string,
  message: string,
  field?: string,
): StudioIssue {
  return { id: `${group}:${code}:${field ?? ''}:${message}`, group, severity, code, message, field };
}

// --- Blocking --------------------------------------------------------------

function blockingIssues(input: ValidationInput): StudioIssue[] {
  const { form, previewEvent, buildError } = input;
  const out: StudioIssue[] = [];

  // Required fields, checked on the form so the message lands on the field even
  // when the builder threw before producing an event.
  if (form.d.trim() === '') {
    out.push(issue('blocking', 'error', 'empty-d', 'The `d` identifier is required.', 'd'));
  }
  if (form.name.trim() === '') {
    out.push(issue('blocking', 'error', 'empty-name', 'A `name` is required.', 'name'));
  }
  if (form.type.trim() === '') {
    out.push(issue('blocking', 'error', 'empty-type', 'A `type` is required.', 'type'));
  }

  if (form.maxStack.trim() !== '' && !isPositiveIntegerText(form.maxStack)) {
    out.push(
      issue(
        'blocking',
        'error',
        'invalid-max-stack',
        '`max_stack` must be a positive whole number (no zero, no decimals, no negatives).',
        'maxStack',
      ),
    );
  }

  for (const row of form.basedOn) {
    const address = row.address.trim();
    if (address === '') continue;
    if (!parseGameItemAddress(address)) {
      out.push(
        issue(
          'blocking',
          'error',
          'malformed-based-on',
          `Derivation address is not a kind:31632 coordinate: ${address}`,
          `basedOn:${row.id}`,
        ),
      );
    }
  }

  if (buildError && out.length === 0) {
    // The builder's own message is the most precise thing available, so it is
    // surfaced verbatim rather than paraphrased, but ONLY when nothing above
    // already explains the failure. An empty form fails every required-field
    // check AND makes the builder throw; reporting both would tell the user
    // four things about three empty fields.
    out.push(issue('blocking', 'error', 'build-failed', buildError));
  }

  if (previewEvent) {
    const result = validateGameItemDefinition(previewEvent, {
      requireJsonContent: true,
    });
    for (const packageIssue of result.issues) {
      // Required-field issues are already reported against their fields above;
      // re-emitting them would double every message in the panel.
      if (
        packageIssue.code === 'empty-d' ||
        packageIssue.code === 'missing-d' ||
        packageIssue.code === 'empty-name' ||
        packageIssue.code === 'missing-name' ||
        packageIssue.code === 'empty-type' ||
        packageIssue.code === 'missing-type'
      ) {
        continue;
      }
      out.push(
        issue('blocking', 'error', packageIssue.code, packageIssue.message, 'content'),
      );
    }
  }

  return out;
}

// --- Protocol warnings (the package's own) ---------------------------------

function protocolIssues(previewEvent: NostrEvent | null): StudioIssue[] {
  if (!previewEvent) return [];
  // A SIGNED-OUT preview event has an empty pubkey, and an addressable event
  // with no author has no address: `parseGameItemDefinitionResult` THROWS
  // ("Cannot build address with empty pubkey") rather than reporting a warning,
  // which took the whole studio down as soon as a signed-out author filled in
  // `d`, `name` and `type`. Signing out is not an error state here, the page
  // says every part of it works signed out, so the parse is skipped until
  // there is an author to parse for.
  //
  // Nothing is lost by waiting: these are the package's own warnings about a
  // stored event, and no warning depends on the pubkey. They reappear intact
  // the moment a signer is present.
  if (previewEvent.pubkey.trim() === '') return [];
  const result = parseGameItemDefinitionResult(previewEvent, { mode: 'permissive' });
  return result.warnings.map((warning, index) =>
    issue(
      'protocol',
      'warning',
      warning.code,
      warning.tag ? `${warning.message} (tag: ${JSON.stringify(warning.tag)})` : warning.message,
      `warning-${index}`,
    ),
  );
}

// --- Image warnings --------------------------------------------------------

function imageIssues(input: ValidationInput): StudioIssue[] {
  const { form, probes } = input;
  const out: StudioIssue[] = [];
  const rows = form.images;

  const filled = rows.filter((row) => row.url.trim() !== '');
  const unmarked = filled.filter((row) => row.marker.trim() === PRIMARY_MARKER);

  for (const [index, row] of rows.entries()) {
    if (row.url.trim() === '') {
      out.push(
        issue(
          'image',
          'warning',
          'empty-image-url',
          `Image ${index + 1} has no URL and will not be published.`,
          `image:${row.id}`,
        ),
      );
      continue;
    }
    if (!isHttpUrl(row.url.trim())) {
      out.push(
        issue(
          'image',
          'warning',
          'non-http-image-url',
          `Image ${index + 1} is not an http(s) URL; most clients will not load it.`,
          `image:${row.id}`,
        ),
      );
    }
    const marker = row.marker.trim();
    if (marker !== PRIMARY_MARKER && !isGameItemImageMarker(marker)) {
      out.push(
        issue(
          'image',
          'warning',
          'unknown-marker',
          `"${marker}" is not a marker this spec version defines. It will be published verbatim and other clients must tolerate it.`,
          `image:${row.id}`,
        ),
      );
    }
    const probe = probes.get(row.url.trim());
    if (probe?.status === 'error') {
      out.push(
        issue(
          'image',
          'warning',
          'image-load-failed',
          `Image ${index + 1} could not be loaded in the browser.`,
          `image:${row.id}`,
        ),
      );
    }
  }

  if (filled.length === 0) {
    out.push(
      issue('image', 'warning', 'no-images', 'This item has no images. Lists will fall back to an emoji or placeholder.'),
    );
  } else if (unmarked.length === 0) {
    out.push(
      issue(
        'image',
        'warning',
        'missing-primary-image',
        'No unmarked image. The spec recommends publishing an unmarked primary image; clients will fall back to the first marked view.',
      ),
    );
  } else if (unmarked.length > 1) {
    const distinct = new Set(unmarked.map((row) => row.url.trim()));
    out.push(
      issue(
        'image',
        'warning',
        'multiple-primary-images',
        distinct.size > 1
          ? 'More than one unmarked image with different URLs. The primary image is ambiguous.'
          : 'The same unmarked image is listed more than once. Duplicates are published only once.',
      ),
    );
  }

  const markerCounts = new Map<string, number>();
  for (const row of filled) {
    const marker = row.marker.trim();
    if (marker === PRIMARY_MARKER) continue;
    markerCounts.set(marker, (markerCounts.get(marker) ?? 0) + 1);
  }
  for (const [marker, count] of markerCounts) {
    if (count > 1) {
      out.push(
        issue(
          'image',
          'warning',
          'duplicate-marker',
          `${count} images share the marker "${marker}". Clients that ask for that view will use the first one.`,
        ),
      );
    }
  }

  const urlCounts = new Map<string, number>();
  for (const row of filled) {
    const url = row.url.trim();
    urlCounts.set(url, (urlCounts.get(url) ?? 0) + 1);
  }
  for (const [url, count] of urlCounts) {
    if (count > 1) {
      out.push(
        issue(
          'image',
          'warning',
          'duplicate-image-url',
          `${count} image entries point at the same URL (${url}).`,
        ),
      );
    }
  }

  // Dimension checks, only against what the browser actually measured.
  const measured = filled
    .map((row) => ({ row, probe: probes.get(row.url.trim()) }))
    .filter(
      (entry): entry is { row: (typeof filled)[number]; probe: ImageProbe } =>
        entry.probe?.status === 'loaded' &&
        typeof entry.probe.width === 'number' &&
        typeof entry.probe.height === 'number',
    );

  for (const { row, probe } of measured) {
    if (
      probe.width !== RECOMMENDED_IMAGE_SIZE.width ||
      probe.height !== RECOMMENDED_IMAGE_SIZE.height
    ) {
      out.push(
        issue(
          'image',
          'warning',
          'unexpected-dimensions',
          `${probe.width}×${probe.height} differs from the recommended ${RECOMMENDED_IMAGE_SIZE.width}×${RECOMMENDED_IMAGE_SIZE.height}. This is a house convention, not a protocol rule.`,
          `image:${row.id}`,
        ),
      );
    }
  }

  const canvases = new Set(measured.map(({ probe }) => `${probe.width}×${probe.height}`));
  if (canvases.size > 1) {
    out.push(
      issue(
        'image',
        'warning',
        'inconsistent-canvas',
        `Views use different canvas sizes (${[...canvases].join(', ')}). Accessory views should share one canvas so they line up on the Blobbi.`,
      ),
    );
  }

  return out;
}

// --- Authoring suggestions -------------------------------------------------

const COSMETIC_TYPES = new Set(['cosmetic']);

/**
 * Guidance specific to a VISUAL EFFECT item.
 *
 * All suggestions, never blocking, and all decidable from the ITEM FORMAT
 * alone. Whether an effect id is one this client can actually draw is a
 * question about the renderer, and this module is the studio's pure domain
 * layer: it cannot import `@blobbi/react` without putting React in the middle
 * of event building. That check lives in the preview panel
 * (`BlobbiEffectPreview`), which is also where an author naturally looks to see
 * whether anything is drawn.
 *
 * Nothing here implies that publishing an id makes it run: activation requires
 * a TRUSTED item address, which is Island's decision and not this event's
 * (docs/blobbi-visual-effects.md §3).
 */
function effectAuthoringIssues(form: ItemFormState): StudioIssue[] {
  const out: StudioIssue[] = [];
  const { visual } = form.content;
  const effect = visual.effect.trim();
  const effectSlot = visual.effectSlot.trim();

  if (visual.kind.trim() === '') {
    out.push(
      issue(
        'authoring',
        'suggestion',
        'effect-no-kind',
        `No \`visual.kind\`. Without \`"${BLOBBI_EFFECT_VISUAL_KIND}"\` a reader has nothing telling it this is an effect rather than a wearable.`,
        'visual.kind',
      ),
    );
  }

  if (effect === '') {
    out.push(
      issue(
        'authoring',
        'suggestion',
        'effect-no-id',
        'No `visual.effect`. Nothing names which effect this item grants.',
        'visual.effect',
      ),
    );
  }

  if (effectSlot === '') {
    out.push(
      issue(
        'authoring',
        'suggestion',
        'effect-no-slot',
        'No `visual.effectSlot`. It states which slot the effect competes for, so two effects cannot silently stack.',
        'visual.effectSlot',
      ),
    );
  } else if (!EFFECT_SLOT_SUGGESTIONS.includes(effectSlot)) {
    out.push(
      issue(
        'authoring',
        'suggestion',
        'effect-unknown-slot',
        `\`${effectSlot}\` is not one of the effect slots: ${EFFECT_SLOT_SUGGESTIONS.join(', ')}.`,
        'visual.effectSlot',
      ),
    );
  }

  if (visual.slot.trim() !== '') {
    out.push(
      issue(
        'authoring',
        'suggestion',
        'effect-has-wearable-slot',
        'This effect item also declares `visual.slot`, which is where a WEARABLE sits. An effect surrounds the character and needs no body slot.',
        'visual.slot',
      ),
    );
  }

  return out;
}

function authoringIssues(form: ItemFormState): StudioIssue[] {
  const out: StudioIssue[] = [];
  const type = form.type.trim();
  const topics = form.topics.map((t) => t.trim());

  if (form.alt.trim() === '') {
    out.push(
      issue(
        'authoring',
        'suggestion',
        'missing-alt',
        'No `alt` tag. Generic Nostr clients show it instead of an unrenderable event.',
        'alt',
      ),
    );
  }

  if (form.contexts.filter((c) => c.trim() !== '').length === 0) {
    out.push(
      issue(
        'authoring',
        'suggestion',
        'no-context',
        'No `context` tag. Without one, nothing says which game this item belongs to.',
        'contexts',
      ),
    );
  }

  if (COSMETIC_TYPES.has(type) && !topics.includes('equipable')) {
    out.push(
      issue(
        'authoring',
        'suggestion',
        'cosmetic-not-equipable',
        'A cosmetic item usually carries the `equipable` topic so clients know it can be worn.',
        'topics',
      ),
    );
  }

  if (COSMETIC_TYPES.has(type) && form.maxStack.trim() !== '' && form.maxStack.trim() !== '1') {
    out.push(
      issue(
        'authoring',
        'suggestion',
        'cosmetic-stacked',
        `\`max_stack\` is ${form.maxStack.trim()} on a cosmetic item. Wearables are usually not stackable.`,
        'maxStack',
      ),
    );
  }

  // A VISUAL EFFECT is a cosmetic without a place on the body: it surrounds the
  // character rather than sitting on it, so `visual.slot` is meaningless for one
  // and asking for it would be advice that produces a wrong definition.
  const isEffect = isEffectItemForm(form);

  if (
    COSMETIC_TYPES.has(type) &&
    !isEffect &&
    form.content.mode === 'structured' &&
    form.content.visual.slot === ''
  ) {
    out.push(
      issue(
        'authoring',
        'suggestion',
        'cosmetic-no-slot',
        'No `visual.slot`. Blobbi Island uses it to decide where a wearable sits.',
        'visual.slot',
      ),
    );
  }

  if (isEffect && form.content.mode === 'structured') {
    out.push(...effectAuthoringIssues(form));
  }

  const d = form.d.trim();
  if (d !== '' && d.split(':').length < 3) {
    out.push(
      issue(
        'authoring',
        'suggestion',
        'unconventional-d',
        'The recommended `d` shape is `<namespace>:<category>:<slug>`, e.g. `blobbi:accessory:party-hat`.',
        'd',
      ),
    );
  }

  return out;
}

// --- Entry point -----------------------------------------------------------

/** Run every layer and report what may block a publication. */
export function validateItemForm(input: ValidationInput): StudioValidation {
  const blocking = blockingIssues(input);
  const fieldErrors: Record<string, string> = {};
  for (const item of blocking) {
    if (item.field && !(item.field in fieldErrors)) {
      fieldErrors[item.field] = item.message;
    }
  }
  return {
    blocking,
    protocol: protocolIssues(input.previewEvent),
    image: imageIssues(input),
    authoring: authoringIssues(input.form),
    isPublishable: blocking.length === 0,
    fieldErrors,
  };
}
