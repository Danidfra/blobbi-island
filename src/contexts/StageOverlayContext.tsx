import { createContext, useContext } from 'react';

/**
 * StageOverlayContext: the element in-world overlays portal INTO.
 *
 * ## Why this is not `FullscreenPortalContext`
 *
 * Both hand a Radix `Portal` a container, and that is where the similarity ends.
 *
 * `FullscreenPortalContext` points at the **shell root**, which is
 * `fixed inset-0`: the whole browser viewport. That is correct for what it was
 * built for: the account menu and the auth dialogs are APP chrome, they should
 * float over everything, and the container exists mainly so the browser
 * Fullscreen API does not hide them (anything left in `document.body` renders
 * outside the fullscreened element and appears not to open).
 *
 * This one points at a box INSIDE `BlobbiFrame`, level with the world. It exists
 * for the opposite reason: an arcade cabinet's screen is part of the GAME, and a
 * game surface that blacks out the browser page around the cozy wood frame reads
 * as "the website opened a dialog", not as "you are standing at a machine". On
 * desktop the frame, the header, the footer and the page behind them all stay
 * visible; the overlay dims only the game window.
 *
 * ## The host's pointer-events rule
 *
 * The host is `absolute inset-0` and therefore covers the whole stage at all
 * times, including when nothing is portaled into it. So it is
 * `pointer-events-none`, and its DIRECT CHILDREN re-enable pointer events,
 * which is exactly the set Radix portals in (an overlay and a content element).
 * Without that split, an empty host would silently swallow every click-to-move
 * in the world.
 *
 * ## Absence is not an error
 *
 * `useStageOverlayHost()` returns `undefined` when there is no provider, and
 * Radix then falls back to `document.body`. That is the right behaviour for a
 * unit test rendering a room on its own, and it means no component has to guard.
 */
export const StageOverlayContext = createContext<HTMLElement | null>(null);

/**
 * The element in-world overlays should portal into, or `undefined` to use the
 * Radix default (`document.body`). Safe to call without a provider.
 */
export function useStageOverlayHost(): HTMLElement | undefined {
  return useContext(StageOverlayContext) ?? undefined;
}
