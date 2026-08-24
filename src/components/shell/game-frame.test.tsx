/**
 * The game-frame containment contract after the desktop edge-polish pass.
 *
 * Two claims, each of which a careless "make it flush" change could reverse:
 *
 *   1. Blobbi Island is still a GAME WINDOW — an aspect-locked, centered,
 *      ideal-capped frame — and was NOT converted into a generic
 *      100vw × 100vh fullscreen web app;
 *   2. the desktop left/right gutters are gone by CONTAINMENT — vertical-only
 *      padding plus a small centered horizontal bleed that the shell root
 *      clips — never by stretching the world.
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
    // own root and the clipping shell) — but the FRAME must not gain one.
    // Comments stripped: the frame's own docs may NAME the root's classes.
    const code = frame.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/fixed inset-0/);
  });
});

describe('the desktop side gutters are gone by clipping, not stretching', () => {
  it('pads the frame band vertically only', () => {
    // The old `p-4 sm:p-6` horizontal padding was the gutter: a thin strip of
    // page background at the left/right edges whenever width was the binding
    // constraint.
    expect(frame).toMatch(/py-4 sm:py-6/);
    expect(frame).not.toMatch(/"flex h-full w-full items-center justify-center p-4 sm:p-6"/);
  });

  it('bleeds a width-bound frame past the edges, centered, for the root to clip', () => {
    // A small symmetric overshoot — wider container, matching negative
    // margins — so the frame meets (slightly exceeds) the viewport edges and
    // the excess is clipped. Cover, not stretch: the aspect lock above is
    // untouched, so the world is never distorted.
    expect(frame).toMatch(/w-\[calc\(100%\+1\.5rem\)\] -mx-3/);
  });

  it('clips at the shell root, so the document never scrolls horizontally', () => {
    // The clipping boundary is the app root (`fixed inset-0 overflow-hidden`),
    // NOT the world or the overlay host — in-frame dialogs and the HUD keep
    // anchoring to the logical game frame inside it.
    expect(shell).toMatch(/"fixed inset-0 overflow-hidden"/);
    expect(frame).toMatch(/data-stage-overlay-host/);
  });

  it('leaves the immersive (mobile / fullscreen) presentation untouched', () => {
    // The gutter fix is a desktop-frame concern. Immersive keeps its
    // edge-to-edge box and its safe-area handling lives in the HUD/dock.
    expect(frame).toMatch(/"relative h-full w-full overflow-hidden bg-island-ink"/);
    expect(read('src/components/shell/BlobbiHUD.tsx')).toMatch(/safe-area-inset-top/);
    expect(read('src/components/shell/BlobbiActionDock.tsx')).toMatch(/safe-area-inset-bottom/);
  });
});
