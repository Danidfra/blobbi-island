/**
 * The REUSABLE half of the accessory vocabulary: everything the renderer needs
 * to paint an accessory, and nothing about how one is stored, bought, equipped
 * or edited.
 *
 * The dividing line is deliberate. A consumer that wants to draw a Blobbi
 * wearing a hat has to tell this package four things, which slot the hat
 * occupies, where it sits, how big it is, and where its picture lives. It must
 * NOT have to speak Nostr, own an inventory, or mirror another application's
 * `public/` tree. So the protocol-shaped types (`EquipTag`, `InvTag`,
 * `AccessoryItem`, `EquipmentConfig`, form/version fields, tag parsers and the
 * error hierarchy) stay in the consuming application; only the shapes below
 * cross the boundary.
 *
 * {@link AccessoryPlacementInput} is intentionally a STRUCTURAL SUBSET of
 * Blobbi Island's `EquipmentConfig`, so Island passes its parsed equipment
 * straight through with no adapter object and no second normalization pass.
 */

/**
 * Where on the body an accessory sits.
 *
 * `unknown` is the documented fallback for a code this vocabulary does not
 * recognize: it is rendered (in front, see `ACCESSORY_SLOT_RANK`) rather than
 * dropped, so an unrecognized accessory is never silently invisible.
 */
export type AccessorySlot =
  | 'headwear'
  | 'eyewear'
  | 'back'
  | 'neckwear'
  | 'handheld'
  | 'face-mark'
  | 'aura'
  | 'color-overlay'
  | 'unknown';

/**
 * Accessory slots that are not drawn when a Blobbi faces away from the camera.
 *
 * The rule is "would you still see it from behind?":
 *  - `eyewear` / `face-mark` sit on the face, gone.
 *  - `handheld` is held in front of the body; a mirrored placement would need
 *    per-accessory art, so it is hidden rather than misplaced.
 *
 * Everything else stays: `headwear` (hats read fine from behind), `back`
 * (wings/capes are back-mounted and MORE visible), `neckwear` (wraps the neck),
 * `aura` (radial, view-independent) and `color-overlay` (a tint).
 */
export const REAR_VIEW_HIDDEN_SLOTS: ReadonlySet<AccessorySlot> = new Set<AccessorySlot>([
  'eyewear',
  'face-mark',
  'handheld',
]);

/**
 * The plain, serializable description of one worn accessory.
 *
 * Coordinates are percentages (0-100) of the canonical renderer box, measured
 * to the accessory's center; `scale` multiplies the box-relative base size
 * (see `blobbi-render-size.ts`). Every numeric field is treated as UNTRUSTED,
 * `normalizeAccessoryPlacements` hardens them before they reach CSS.
 */
export interface AccessoryPlacementInput {
  /** Stable identity of the accessory (e.g. `headwear-8`). */
  code: string;
  slot: AccessorySlot;
  /** Center x, as a percentage (0-100) of the renderer box. */
  x: number;
  /** Center y, as a percentage (0-100) of the renderer box. */
  y: number;
  /** Multiplier on the box-relative base size. Must be > 0 to be honored. */
  scale: number;
  /** Rotation in degrees. */
  rot: number;
  flipX?: boolean;
  /**
   * Where the artwork lives, if the consumer already knows. Passed verbatim to
   * the {@link AccessorySourceResolver}, which has the final say.
   */
  url?: string;
}

/** Everything a resolver may use to locate an accessory's artwork. */
export interface AccessorySourceRequest {
  code: string;
  slot: AccessorySlot;
  /** The URL carried on the placement, if any. */
  url?: string;
}

/**
 * Maps an accessory to an ordered list of candidate image URLs: the first is
 * painted, each later entry is tried in order if the previous one fails to
 * load. An empty list renders no image.
 *
 * This is the package's entire asset contract for accessories. There is no
 * default that knows a directory layout; see `DEFAULT_ACCESSORY_SOURCES`.
 */
export type AccessorySourceResolver = (
  request: AccessorySourceRequest,
) => readonly string[];

/**
 * The package's neutral resolver: trust the URL on the placement, and nothing
 * else.
 *
 * A consumer with its own asset layout (fallback extensions, a CDN, a bundler
 * asset map) supplies its own resolver instead. Blobbi Island does exactly
 * that: see its `island-accessory-sources.ts`.
 */
export const DEFAULT_ACCESSORY_SOURCES: AccessorySourceResolver = ({ url }) =>
  url ? [url] : [];
