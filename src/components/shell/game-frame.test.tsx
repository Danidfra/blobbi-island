/**
 * The game-frame containment contract after the edge-correction pass.
 *
 * Three claims, each of which a careless containment change could reverse:
 *
 *   1. Blobbi Island is still a GAME WINDOW, an aspect-locked, centered,
 *      ideal-capped frame: and was NOT converted into a generic
 *      100vw × 100vh fullscreen web app;
 *   2. the INTERNAL gap is gone at its actual mechanism: the wood border's
 *      padding matches the world's aspect ratio, so the bezel interior is
 *      exactly world-shaped and the contain-scaled world meets the bezel
 *      flush instead of letterboxing a sliver at the left and right;
 *   3. the EXTERNAL gap is a kept minimum: the desktop frame stays fully
 *      visible and centered, never touching or bleeding past the viewport
 *      edges while in desktop mode.
 *
 * jsdom has no layout, so these are source contracts, like the My Blobbi
 * window's own shape tests.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { WORLD_ASPECT, WORLD_WIDTH, WORLD_HEIGHT } from '@/lib/world-coordinates';

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const frame = read('src/components/shell/BlobbiFrame.tsx');
const shell = read('src/components/shell/BlobbiAppShell.tsx');
const stage = read('src/components/shell/BlobbiStage.tsx');
const world = read('src/components/shell/VirtualWorld.tsx');

describe('the game window keeps its format', () => {
  it('locks the frame to the canonical world aspect ratio', () => {
    expect(WORLD_ASPECT).toBeCloseTo(WORLD_WIDTH / WORLD_HEIGHT, 10);
    // The desktop frame derives its shape from the world's own ratio…
    expect(frame).toMatch(/aspectRatio: `\$\{WORLD_ASPECT\}`/);
    // …and so does the stage inside it.
    expect(stage).toMatch(/aspectRatio: `\$\{WORLD_ASPECT\}`/);
  });

  it('keeps the ideal-size cap: the frame never grows past the art width', () => {
    // The centered browser-game window: pinned near the world art's native
    // 1046px on big monitors, shrinking responsively below that. Removing this
    // cap is exactly the "stretch across the monitor" regression this pass
    // was told not to introduce.
    expect(frame).toMatch(/maxWidth: "min\(100%, 1040px\)"/);
    expect(frame).toMatch(/maxHeight: "100%"/);
  });

  it('was NOT turned into a fullscreen viewport rectangle', () => {
    // No variant of "the frame is the whole browser" anywhere in the shell.
    expect(frame).not.toMatch(/w-screen|h-screen|100vw|100vh|100dvw|100dvh/);
    expect(stage).not.toMatch(/w-screen|h-screen|100vw|100vh/);
    // The shell root's `fixed inset-0` predates this pass (it is the app's
    // own root and the clipping shell): but the FRAME must not gain one.
    // Comments stripped: the frame's own docs may NAME the root's classes.
    const code = frame.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/fixed inset-0/);
  });
});

describe('the INTERNAL gap: the wallpaper meets the bezel flush', () => {
  it('gives the wood border aspect-matched padding, not a uniform one', () => {
    /*
      THE mechanism of the old sliver. The aspect lock sits on the OUTER box,
      wood border included: so a uniform border (`p-2 sm:p-3`) left the bezel
      interior slightly WIDER than the world's 1046:697. VirtualWorld
      contain-scales the fixed world into that box, so height bound and a
      ~4–6px strip of blurred letterbox showed between bezel and wallpaper at
      the left and right. Side padding must stay ≈ WORLD_ASPECT × vertical
      padding for the interior to be exactly world-shaped.
    */
    expect(frame).toMatch(/py-2 px-3 sm:py-3 sm:px-\[1\.125rem\]/);
    expect(frame).not.toMatch(/"p-2 sm:p-3"/);
    // The arithmetic behind those numbers: 12/8 and 18/12 (=1.125rem) match
    // the world ratio to well under a hundredth of a pixel per side.
    expect(12 / 8).toBeCloseTo(WORLD_ASPECT, 2);
    expect(18 / 12).toBeCloseTo(WORLD_ASPECT, 2);
  });

  it('fills the bezel interior with the world host, edge to edge', () => {
    // No inset, margin or second aspect lock between bezel and world: the
    // stage wrapper is `absolute inset-0`, and the framed stage takes the full
    // box (its aspectRatio is inert while both dimensions are 100%).
    expect(frame).toMatch(/\{\/\* World stage \*\/\}\s*<div className="absolute inset-0">/);
    expect(stage).toMatch(/"w-full h-full max-w-full max-h-full mx-auto"/);
  });

  it('contain-scales the world: never cover, crop or stretch', () => {
    // The flush fit comes from shaping the BOX, not from scaling the world
    // differently: the uniform-scale contract that keeps every world
    // coordinate aligned is untouched.
    expect(world).toMatch(/Math\.min\(width \/ WORLD_WIDTH, height \/ WORLD_HEIGHT\)/);
    expect(world).toMatch(/translate\(-50%, -50%\) scale\(\$\{scale\}\)/);
  });

  it('keeps the frame decoration: wood, corners, bezel, shadow', () => {
    expect(frame).toMatch(/rounded-\[1\.75rem\]/);
    expect(frame).toMatch(/bg-island-wood/);
    expect(frame).toMatch(/shadow-cozy-frame/);
    expect(frame).toMatch(/rounded-\[1\.25rem\] bg-island-cream/);
  });
});

describe('the EXTERNAL gap: a kept minimum, never a bleed', () => {
  it('floors the desktop side margins at the shell padding', () => {
    // 16px (24px from `sm`) of page stays visible around the whole decorated
    // frame at every desktop width: the frame shrinks responsively inside
    // `100% minus this padding` and can never touch the viewport edge before
    // the immersive mode takes over.
    expect(frame).toMatch(/"flex h-full w-full items-center justify-center p-4 sm:p-6"/);
  });

  it('never intentionally bleeds past the viewport', () => {
    // The corrected regression: no oversized container, no negative-margin
    // centering trick, nothing for the shell root to clip horizontally. The
    // full wood frame, rounded flanks included, stays visible.
    expect(frame).not.toMatch(/calc\(100%\s*\+/);
    expect(frame).not.toMatch(/-mx-|-ml-|-mr-/);
  });

  it('spans the three width regimes without collapsing them', () => {
    // A. Wide desktop: the 1040px cap + flex centering = large natural
    //    margins (asserted above). B. Narrow desktop: `w-full` inside the
    //    padded band = responsive shrink down to the minimum gutter. C.
    //    Immersive keeps its own edge-to-edge box, untouched by the gutter.
    expect(frame).toMatch(/items-center justify-center/);
    expect(frame).toMatch(/"relative h-full w-full overflow-hidden bg-island-ink"/);
    // The desktop/immersive split stays the existing device heuristic; no
    // new breakpoint was invented for the gutter.
    expect(read('src/components/shell/BlobbiAppShell.tsx')).toMatch(/useImmersive\(\)/);
  });

  it('cannot produce horizontal document scroll', () => {
    // The frame fits inside viewport-minus-gutters, and the shell root is a
    // `fixed inset-0 overflow-hidden` box besides, belt and suspenders.
    expect(shell).toMatch(/"fixed inset-0 overflow-hidden"/);
    expect(frame).toMatch(/data-stage-overlay-host/);
  });

  it('leaves mobile safe areas where they were', () => {
    expect(read('src/components/shell/BlobbiHUD.tsx')).toMatch(/safe-area-inset-top/);
    expect(read('src/components/shell/BlobbiActionDock.tsx')).toMatch(/safe-area-inset-bottom/);
  });
});
