/**
 * Shared world-input policy (Phase 3).
 *
 * One predicate decides "does this tap start a world walk?" for BOTH the local
 * input adapter and the presence click publisher, and one narrower predicate
 * decides "does this tap cancel a pending walk-to-interact?". These tests pin
 * the cases that historically diverged between the two hand-maintained copies:
 * nested icons inside buttons, interactive world objects, remote sprites, and
 * nested world surfaces.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { shouldTriggerWorldMove, isWithinMoveBlockingUi } from './world-input';

function buildWorld() {
  const container = document.createElement('div');
  container.setAttribute('data-world-surface', '');
  document.body.appendChild(container);
  return container;
}

/**
 * Dispatch a bubbling pointer-style MouseEvent and evaluate the predicate
 * INSIDE the container's listener, exactly where production evaluates it
 * (`composedPath()` is only populated while the event is dispatching).
 */
function moveAllowed(container: HTMLElement, target: Element, init: MouseEventInit = {}): boolean {
  let allowed: boolean | null = null;
  const listener = (ev: Event) => {
    allowed = shouldTriggerWorldMove(ev as MouseEvent, container);
  };
  container.addEventListener('pointerdown', listener);
  target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, ...init }));
  container.removeEventListener('pointerdown', listener);
  if (allowed === null) throw new Error('event never reached the container listener');
  return allowed;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('shouldTriggerWorldMove', () => {
  it('allows a plain tap on the world ground', () => {
    const container = buildWorld();
    const ground = document.createElement('div');
    container.appendChild(ground);
        expect(moveAllowed(container, ground)).toBe(true);
  });

  it('blocks taps on buttons, including nested icon content', () => {
    const container = buildWorld();
    const button = document.createElement('button');
    const icon = document.createElement('span');
    button.appendChild(icon);
    container.appendChild(button);
        expect(moveAllowed(container, icon)).toBe(false);
  });

  it('blocks taps on interactive world objects, including nested images', () => {
    const container = buildWorld();
    const bush = document.createElement('div');
    bush.setAttribute('data-block-move', '');
    const img = document.createElement('img');
    bush.appendChild(img);
    container.appendChild(bush);
        expect(moveAllowed(container, img)).toBe(false);
  });

  it('blocks taps on remote player sprites (data-player-key)', () => {
    const container = buildWorld();
    const remote = document.createElement('div');
    remote.setAttribute('data-player-key', 'pk:session');
    const sprite = document.createElement('div');
    remote.appendChild(sprite);
    container.appendChild(remote);
        expect(moveAllowed(container, sprite)).toBe(false);
  });

  it('blocks taps that belong to a NESTED world surface', () => {
    const container = buildWorld();
    const nested = document.createElement('div');
    nested.setAttribute('data-world-surface', '');
    const inner = document.createElement('div');
    nested.appendChild(inner);
    container.appendChild(nested);
        expect(moveAllowed(container, inner)).toBe(false);
  });

  it('the container itself carrying data-world-surface does not block', () => {
    const container = buildWorld();
        expect(moveAllowed(container, container)).toBe(true);
  });

  it('blocks secondary buttons and modified clicks', () => {
    const container = buildWorld();
    const ground = document.createElement('div');
    container.appendChild(ground);
    expect(moveAllowed(container, ground, { button: 2 })).toBe(false);
    expect(moveAllowed(container, ground, { ctrlKey: true })).toBe(false);
    expect(moveAllowed(container, ground, { metaKey: true })).toBe(false);
  });

  it('blocks events originating outside the container', () => {
    const container = buildWorld();
    const elsewhere = document.createElement('div');
    document.body.appendChild(elsewhere);
    let captured: MouseEvent | null = null;
    document.body.addEventListener('pointerdown', (ev) => {
      captured = ev as MouseEvent;
    });
    elsewhere.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(shouldTriggerWorldMove(captured!, container)).toBe(false);
  });

  it('blocks dialogs / menus / links / form controls', () => {
    const container = buildWorld();
    for (const build of [
      () => {
        const el = document.createElement('div');
        el.setAttribute('role', 'dialog');
        return el;
      },
      () => {
        const el = document.createElement('a');
        el.setAttribute('href', '#');
        return el;
      },
      () => document.createElement('input'),
      () => {
        const el = document.createElement('div');
        el.className = 'map-ui';
        return el;
      },
    ]) {
      const el = build();
      container.appendChild(el);
            expect(moveAllowed(container, el)).toBe(false);
    }
  });
});

describe('isWithinMoveBlockingUi', () => {
  it('is true for content nested inside data-block-move carriers', () => {
    const host = document.createElement('div');
    host.setAttribute('data-block-move', '');
    const icon = document.createElement('span');
    host.appendChild(icon);
    document.body.appendChild(host);
    expect(isWithinMoveBlockingUi(icon)).toBe(true);
    expect(isWithinMoveBlockingUi(host)).toBe(true);
  });

  it('is false for plain ground and non-element targets', () => {
    const ground = document.createElement('div');
    document.body.appendChild(ground);
    expect(isWithinMoveBlockingUi(ground)).toBe(false);
    expect(isWithinMoveBlockingUi(null)).toBe(false);
    expect(isWithinMoveBlockingUi(document)).toBe(false);
  });
});
