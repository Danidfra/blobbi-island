/**
 * The effect system's CSS, owned by the package as text.
 *
 * WHY A STRING AND NOT A STYLESHEET. The package builds with plain `tsc`, which
 * emits `.js` and `.d.ts` and copies nothing else, a `.css` import would never
 * reach `dist/`. It also ships no Tailwind config, and no arrangement of
 * Tailwind utilities can express an `@keyframes`. So the CSS lives here, is
 * rendered into a `<style>` element next to the effect layers, and needs
 * exactly zero configuration from whoever consumes the package. The full
 * reasoning, including the two options rejected, is in
 * `docs/blobbi-visual-effects-audit.md` §7.
 *
 * ## Every name is namespaced
 *
 * Classes are `blobbi-fx-*` and keyframes are `blobbi-fx-*`. A keyframe called
 * `float`, `pulse` or `sparkle` would be a global name in the consumer's
 * document and would silently win or lose against theirs; this repository
 * already defines a global `@keyframes float`, which is precisely the collision
 * being avoided.
 *
 * ## The opacity protocol
 *
 * Exactly one custom property carries "how visible is this piece": `--fx-o`,
 * set inline on the piece and already multiplied by the caller's `intensity`.
 *
 *   - the PIECE's resting `opacity` is `var(--fx-o)`;
 *   - every piece keyframe expresses opacity as `var(--fx-o)` or a fraction of
 *     it, so an animation never overrides the caller's intensity;
 *   - the TRACK's keyframes use raw 0/1 opacity, which multiplies with the
 *     piece rather than replacing it.
 *
 * This is what makes reduced motion work with no JavaScript at all: switch
 * every animation off and each piece falls back to `opacity: var(--fx-o)` at
 * its authored position, a still, legible version of the effect rather than an
 * invisible one.
 */

/**
 * Structural rules. Always emitted whenever any effect renders.
 *
 * The three things asserted elsewhere in the suite all live here: layers never
 * take pointer events, layers are absolutely positioned so they cannot
 * influence layout, and the reduced-motion block removes every animation the
 * system can produce.
 *
 * REDUCED MOTION removes `animation` and nothing else. Motion is what the
 * preference is about; a STATIC transform is placement, not motion, a
 * lightning segment's fixed tilt, a radially arranged arc, and stripping it
 * would bend the resting composition into something never designed. Animated
 * transforms need no separate kill switch: with `animation: none` they simply
 * stop existing, and the element falls back to its inline (static) transform.
 */
const BASE_RULES = `
.blobbi-fx-layer{position:absolute;pointer-events:none;overflow:visible;}
.blobbi-fx-track{position:absolute;inset:0;pointer-events:none;transform-origin:50% 50%;will-change:transform;}
.blobbi-fx-piece{position:absolute;pointer-events:none;transform-origin:50% 50%;will-change:transform,opacity;opacity:var(--fx-o,1);}
.blobbi-fx-bolt{fill:none;stroke-linecap:round;stroke-linejoin:round;pointer-events:none;stroke-dasharray:100;opacity:var(--fx-o,1);}
.blobbi-fx-impact{pointer-events:none;opacity:calc(var(--fx-o,1) * 0.55);}
@media (prefers-reduced-motion: reduce){
.blobbi-fx-track,.blobbi-fx-piece,.blobbi-fx-bolt,.blobbi-fx-impact{animation:none !important;}
}
`;

/**
 * TRACK keyframes: where a particle travels.
 *
 * The track is a full-box element, so its `translate` percentages are
 * percentages OF THE RENDERER BOX rather than of the particle. That is the only
 * reason a 3 % mote can drift 45 % of the way up the body: without the
 * full-size wrapper, `translateY(-45%)` on the mote itself would move it by
 * 45 % of 3 %.
 */
const TRACK_KEYFRAMES: Record<string, string> = {
  // Upward travel with a lateral sway, fading in at the start and out at the
  // top. `--fx-sway` reverses sign at the two quarter marks, which is what
  // makes the path an S rather than a diagonal.
  'blobbi-fx-rise': `@keyframes blobbi-fx-rise{
0%{transform:translate(0%,0%);opacity:0}
12%{opacity:1}
25%{transform:translate(var(--fx-sway,0%),calc(var(--fx-dy,0%) * 0.25))}
50%{transform:translate(0%,calc(var(--fx-dy,0%) * 0.5))}
75%{transform:translate(calc(var(--fx-sway,0%) * -1),calc(var(--fx-dy,0%) * 0.75))}
88%{opacity:1}
100%{transform:translate(0%,var(--fx-dy,0%));opacity:0}}`,

  // Settling downward. Fewer waypoints than `rise` on purpose: falling crystals
  // read as heavier when they wander less.
  'blobbi-fx-fall': `@keyframes blobbi-fx-fall{
0%{transform:translate(0%,0%);opacity:0}
14%{opacity:1}
50%{transform:translate(var(--fx-sway,0%),calc(var(--fx-dy,0%) * 0.5))}
84%{opacity:1}
100%{transform:translate(0%,var(--fx-dy,0%));opacity:0}}`,

  // A there-and-back wander with no fade, for atmosphere that is always
  // present (fog banks) rather than emitted.
  'blobbi-fx-drift': `@keyframes blobbi-fx-drift{
0%,100%{transform:translate(0%,0%)}
50%{transform:translate(var(--fx-dx,0%),var(--fx-dy,0%))}}`,

  // Rotating the full-box track carries whatever is pinned inside it around the
  // box centre: an orbit with one animated property and no trigonometry.
  'blobbi-fx-orbit': `@keyframes blobbi-fx-orbit{
from{transform:rotate(0deg)}
to{transform:rotate(360deg)}}`,

  // Drawn inward and extinguished, for the void's motes and rings.
  'blobbi-fx-inhale': `@keyframes blobbi-fx-inhale{
0%{transform:scale(1.18);opacity:0}
22%{opacity:1}
78%{opacity:1}
100%{transform:scale(0.72);opacity:0}}`,
};

/** PIECE keyframes: what a particle does in place, while the track carries it. */
const PIECE_KEYFRAMES: Record<string, string> = {
  'blobbi-fx-twinkle': `@keyframes blobbi-fx-twinkle{
0%,100%{transform:scale(0.6);opacity:calc(var(--fx-o,1) * 0.25)}
50%{transform:scale(1);opacity:var(--fx-o,1)}}`,

  // Long dim stretches with a short lit plateau, a firefly, not a strobe. One
  // light-dark cycle per period, and the fastest preset that uses it runs at
  // 1.6 s, so the effective rate stays under 1 Hz. The dim state is a fifth of
  // full rather than off: a firefly that vanished completely would leave the
  // effect invisible on a bright background for most of its cycle.
  'blobbi-fx-blink': `@keyframes blobbi-fx-blink{
0%,40%{opacity:calc(var(--fx-o,1) * 0.22)}
54%,70%{opacity:var(--fx-o,1)}
84%,100%{opacity:calc(var(--fx-o,1) * 0.22)}}`,

  'blobbi-fx-bob': `@keyframes blobbi-fx-bob{
0%,100%{transform:scale(1)}
50%{transform:scale(1.09)}}`,

  'blobbi-fx-pulse': `@keyframes blobbi-fx-pulse{
0%,100%{transform:scale(0.95);opacity:calc(var(--fx-o,1) * 0.68)}
50%{transform:scale(1.05);opacity:var(--fx-o,1)}}`,

  'blobbi-fx-spin': `@keyframes blobbi-fx-spin{
from{transform:rotate(0deg)}
to{transform:rotate(360deg)}}`,

  'blobbi-fx-shimmer': `@keyframes blobbi-fx-shimmer{
0%,100%{opacity:calc(var(--fx-o,1) * 0.6)}
50%{opacity:var(--fx-o,1)}}`,

  // Digital displacement. Paired with `steps(1,end)` timing at the call site so
  // the fragment JUMPS between five discrete states instead of sliding, an
  // interpolated glitch reads as a wobble.
  'blobbi-fx-glitch': `@keyframes blobbi-fx-glitch{
0%,100%{transform:translate(0,0);opacity:calc(var(--fx-o,1) * 0.18)}
20%{transform:translate(var(--fx-gx,6%),0);opacity:var(--fx-o,1)}
40%{transform:translate(calc(var(--fx-gx,6%) * -1),var(--fx-gy,4%));opacity:calc(var(--fx-o,1) * 0.7)}
60%{transform:translate(var(--fx-gx,6%),calc(var(--fx-gy,4%) * -1));opacity:var(--fx-o,1)}
80%{transform:translate(0,0);opacity:calc(var(--fx-o,1) * 0.32)}}`,

  // ── The lightning strike ──────────────────────────────────────────────
  //
  // Three keyframes, one shared 2.8 s cycle, exact per-element delays:
  //
  //  bolt-draw     the channel itself. Every strike path carries
  //                `pathLength="100"` and `stroke-dasharray:100`, so driving
  //                stroke-dashoffset 100→0 DRAWS the path from its `M` (the
  //                origin at the Blobbi's feet) to its tip in 0→6.5% of the
  //                cycle: 182 ms, fast enough to feel instant, slow enough to
  //                see the bolt travel. Then the flicker of a real strike:
  //                full → 0.3 → full → out across ~320 ms, one restrike only
  //                (more would head toward strobe territory).
  //  impact-flash  the strike-point glow at the origin: snaps on with the
  //                draw, decays with the flicker.
  //  bolt-seg      the tip/origin sparks (ordinary catalog pieces): a sharp
  //                pop timed into the same cycle.
  'blobbi-fx-bolt-draw': `@keyframes blobbi-fx-bolt-draw{
0%{stroke-dashoffset:100;opacity:0}
0.5%{opacity:var(--fx-o,1)}
6.5%{stroke-dashoffset:0;opacity:var(--fx-o,1)}
8.5%{opacity:calc(var(--fx-o,1) * 0.3)}
10.5%{opacity:var(--fx-o,1)}
13%{opacity:calc(var(--fx-o,1) * 0.75)}
16%{opacity:calc(var(--fx-o,1) * 0.9)}
18%,100%{stroke-dashoffset:0;opacity:0}}`,

  'blobbi-fx-impact-flash': `@keyframes blobbi-fx-impact-flash{
0%{opacity:0}
1%{opacity:var(--fx-o,1)}
8%{opacity:calc(var(--fx-o,1) * 0.5)}
11%{opacity:calc(var(--fx-o,1) * 0.85)}
20%,100%{opacity:0}}`,

  'blobbi-fx-bolt-seg': `@keyframes blobbi-fx-bolt-seg{
0%{opacity:0}
1.5%{opacity:var(--fx-o,1)}
6%{opacity:calc(var(--fx-o,1) * 0.92)}
8.5%{opacity:calc(var(--fx-o,1) * 0.48)}
11%{opacity:var(--fx-o,1)}
16%{opacity:calc(var(--fx-o,1) * 0.85)}
19%,100%{opacity:0}}`,
};

const ALL_KEYFRAMES: Record<string, string> = {
  ...TRACK_KEYFRAMES,
  ...PIECE_KEYFRAMES,
};

/** Every animation name the effect system can emit. */
export const EFFECT_ANIMATION_NAMES: readonly string[] =
  Object.keys(ALL_KEYFRAMES).sort();

/** Is this a keyframe the package defines? Guards the presets against typos. */
export function isKnownEffectAnimation(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(ALL_KEYFRAMES, name);
}

/**
 * The stylesheet for a specific set of animations.
 *
 * Only the keyframes actually in use are emitted, so a Blobbi wearing one
 * effect carries one effect's worth of CSS rather than twelve. Names are sorted
 * so the same set always produces byte-identical text, the markup has to be
 * comparable between renders for the determinism tests to mean anything.
 */
export function effectStylesheetFor(
  animationNames: Iterable<string>,
): string {
  const used = [...new Set(animationNames)].filter(isKnownEffectAnimation).sort();
  return [BASE_RULES.trim(), ...used.map((name) => ALL_KEYFRAMES[name])].join('\n');
}

/**
 * The complete effect stylesheet.
 *
 * Exported for consumers that render many effect-bearing Blobbis at once and
 * would rather mount the rules once themselves than carry a `<style>` element
 * per character. Mounting it is optional and additive: the rules are identical,
 * so a page with both loses nothing but a few hundred bytes.
 */
export const BLOBBI_EFFECT_STYLESHEET: string = effectStylesheetFor(
  EFFECT_ANIMATION_NAMES,
);
