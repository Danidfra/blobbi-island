/**
 * The My Blobbi window's SIZE contract after the containment pass.
 *
 * The window used to be `size="full"` alone — `calc(100% - 1.5rem)` of the
 * stage host in both axes — so it grew with the game frame and, on a large
 * desktop, swallowed almost the whole game window. These tests pin the new
 * deal:
 *
 *   1. the window has an EXPLICIT ideal desktop size (58 × 36 rem), derived
 *      from the Blobbi tab's content, and stops growing there;
 *   2. below the ideal it still shrinks responsively (`min()` against the
 *      host), and the mobile sheet keeps its own sizing (`md:` scoping);
 *   3. all three tabs share the ONE outer contract — nothing sizes per tab;
 *   4. the stage has its own stop (`max-h-[25rem]`) so a taller frame no
 *      longer stretches the 2:3 portrait down indefinitely.
 *
 * jsdom has no layout, so — like the rest of this window's shape tests —
 * these are source contracts.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const modal = read('src/components/blobbi/BlobbiInfoModal.tsx');
const blobbiModal = read('src/components/ui/blobbi-modal.tsx');

describe('the window has an ideal size, and stops there', () => {
  it('caps the desktop window at 58 × 36 rem, min()-ed against the host', () => {
    expect(modal).toMatch(/md:w-\[min\(calc\(100%-1\.5rem\),58rem\)\]/);
    expect(modal).toMatch(/md:h-\[min\(calc\(100%-1\.5rem\),36rem\)\]/);
  });

  it('is no longer unrestricted full sizing on desktop', () => {
    // `size="full"` remains the base (it carries the height model and the
    // small-frame fallback), but the caps above must override BOTH axes.
    // Guard the base contract too, so a change to `full` itself is noticed.
    expect(blobbiModal).toMatch(/full: "w-\[calc\(100%-1\.5rem\)\] h-\[calc\(100%-1\.5rem\)\]"/);
  });

  it('scopes the caps to the desktop dialog, leaving the phone sheet alone', () => {
    // `md:` is useIsMobile's own 768px boundary: below it this window is a
    // bottom sheet whose 92dvh sizing must stay untouched.
    expect(read('src/hooks/useIsMobile.tsx')).toMatch(/MOBILE_BREAKPOINT = 768/);
    expect(blobbiModal).toMatch(/92dvh/);
    // The caps carry the md: prefix — never a bare w-/h- that would leak
    // into the sheet.
    expect(modal).not.toMatch(/className="w-\[min\(calc\(100%-1\.5rem\)/);
  });

  it('shares the one outer contract across Blobbi / Wardrobe / Items', () => {
    // The sizing className is a STATIC literal on the single BlobbiModal that
    // hosts the tabs — no template, no conditional, nothing keyed on the
    // selected tab. Switching tabs cannot move or resize the window.
    const sized = modal.match(/className="md:w-\[min[^"]*"/g) ?? [];
    expect(sized).toHaveLength(1);
    expect(sized[0]).not.toMatch(/\$\{|selectedTab/);
  });
});

describe('the stage has its own stop', () => {
  it('caps the stage height at 25rem while keeping it height-driven', () => {
    // Still `h-full` (grows with the modal, ratio intact) but never past
    // 400px — 1.5 × the width the stable `lg:w-[30%]` column gives it at the
    // window's 58rem ideal, so at full size the 2:3 portrait is exactly as
    // wide as its column.
    expect(modal).toMatch(
      /data-testid="blobbi-stage"[\s\S]{0,400}h-full max-w-full max-h-\[25rem\]/,
    );
  });

  it('centers spare height instead of stretching the artwork', () => {
    // The column centers its child; the stage is aspect-locked. Nothing
    // `flex-grow`s the stage box and nothing sizes it per tab.
    const column = modal.match(
      /data-testid="blobbi-stage-column"[\s\S]{0,1600}?className=("[^"]*")/,
    )![1];
    expect(column).toMatch(/items-center justify-center/);
    expect(column).not.toMatch(/selectedTab/);
  });

  it('keeps the stable width ratio and the large Blobbi', () => {
    // The width contract predates this pass and is deliberately unchanged…
    expect(modal).toMatch(/sm:w-\[32%\] lg:w-\[30%\]/);
    // …and so is the renderer box that makes the Blobbi the protagonist.
    expect(modal).toMatch(/ref=\{stageRef\}\s+className="relative aspect-square h-\[68%\]"/);
  });
});
