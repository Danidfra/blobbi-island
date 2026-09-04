/**
 * Named anchors INSIDE the Blobbi renderer box.
 *
 * The renderer box is a square (`BLOBBI_RENDER_SIZE_PX`, see
 * `@blobbi/react`'s `blobbi-render-size.ts`) that the body SVG fills exactly,
 * so a point in the body is best expressed the way saved accessory placements
 * already are: as a percentage of that box, measured from its top-left. A
 * value here is therefore valid at every size token, every depth scale and
 * every viewport, because the actor's scale rig scales the whole box
 * (`BlobbiActor`), and it holds for every body variant that keeps its face in
 * the same region of the artwork.
 *
 * The numbers are measured on the artwork itself (the 200 × 200 adult
 * viewBoxes and the baby body), not tuned in a room, so nothing in a room
 * may add a viewport coordinate to them.
 */

/**
 * Centre of the eye line for the baby body and for any body not in
 * {@link ADULT_FACE_LINE_PERCENT}, as a percentage of the renderer box.
 * Horizontally every variant is symmetric about the box's centre.
 */
export const BLOBBI_FACE_ANCHOR = { x: 50, y: 46 } as const;

/**
 * Eye-line height per adult form, measured on the artwork: the `cy` of the
 * eye bases in each form's 200 × 200 viewBox, as a percentage of the box.
 * Most forms keep their eyes in a 40–52 % band; the mushroom's cap pushes its
 * face down to 65 %, which is why this is a table and not one number.
 */
export const ADULT_FACE_LINE_PERCENT: Readonly<Record<string, number>> = {
  bloomi: 52.5,
  breezy: 45,
  cacti: 52.5,
  catti: 50,
  cloudi: 50,
  crysti: 47.5,
  droppi: 47.5,
  flammi: 50,
  froggi: 40,
  leafy: 41,
  mushie: 65,
  owli: 50,
  pandi: 41,
  rocky: 47.5,
  rosey: 42.5,
  starri: 47.5,
};

/** The subset of a render visual the anchors depend on. */
export interface BlobbiFaceVisual {
  stage?: 'egg' | 'baby' | 'adult';
  adultType?: string;
}

/**
 * The face anchor for a body: the measured eye line of a known adult form,
 * the baby line otherwise (the egg draws the baby body too, and an unknown
 * adult type is corrected to the default form downstream, whose eyes sit in
 * the common band).
 */
export function blobbiFaceAnchor(visual?: BlobbiFaceVisual | null): { x: number; y: number } {
  if (visual?.stage === 'adult' && visual.adultType) {
    const y = ADULT_FACE_LINE_PERCENT[visual.adultType];
    if (y !== undefined) return { x: BLOBBI_FACE_ANCHOR.x, y };
  }
  return BLOBBI_FACE_ANCHOR;
}

/**
 * How wide the eye region is, as a percentage of the renderer box: adult eyes
 * span x 72–128 of 200 (≈ 28–36 % of the box), the baby's ≈ 30–70 %. A prop
 * that has to cover the eyes without covering the whole Blobbi is sized from
 * this, with room to spare on each side.
 */
export const BLOBBI_FACE_WIDTH_PERCENT = 40;

/**
 * Where the visible body ENDS inside the box, as a percentage from the top.
 *
 * Adult bodies bottom out at y 158–180 of 200 and the baby body at ~88 % of
 * the box: the artwork leaves the lowest ~12 % of the square empty. The pose
 * anchor pins the bottom of the BOX, so anything that has to meet the visible
 * body (a seat cushion) is that much higher than the anchor. Seat
 * configurations derive their contact fraction from this rather than from a
 * guess; see the Nostr Station chairs in `room-seats-config.ts`.
 */
export const BLOBBI_BODY_BOTTOM_PERCENT = 88;

/**
 * Geometry of the VR headset a Blobbi wears in a Nostr Station chair, in the
 * face-anchor space above.
 *
 * The asset (`/assets/locations/nostr-station/vr-headset.svg`) is trimmed to
 * the headset: a 500 × 205 viewBox, so its height follows its width at
 * `VR_HEADSET_ASPECT`. Sixty-two percent of the box is ~1.5 × the face width:
 * the goggles wrap past the eyes to the cheeks, as goggles do, and stop well
 * inside the body's silhouette (the widest adult body spans ~20–80 % of the
 * box).
 */
export const VR_HEADSET_SRC = '/assets/locations/nostr-station/vr-headset.svg';
export const VR_HEADSET_WIDTH_PERCENT = 62;
export const VR_HEADSET_ASPECT = 500 / 205;
export const VR_HEADSET_HEIGHT_PERCENT = VR_HEADSET_WIDTH_PERCENT / VR_HEADSET_ASPECT;
