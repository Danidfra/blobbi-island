import { createContext, useContext } from "react";

/**
 * FullscreenPortalContext — exposes the DOM element that overlays (menus,
 * dialogs, sheets) should portal INTO.
 *
 * Why this exists: Radix portals render to `document.body` by default. When the
 * game shell enters the browser Fullscreen API on a specific element (the shell
 * root, not `document.documentElement`), anything rendered into `document.body`
 * is OUTSIDE the fullscreened element and therefore not painted on top of the
 * fullscreen layer — so the account menu / dialogs appear to "not open".
 *
 * The shell sets this to its fullscreen root element while fullscreen is active,
 * and to `null` otherwise. Consumers pass it as the Radix `Portal container`
 * prop. `null`/`undefined` means "use the default" (`document.body`), which is
 * correct outside fullscreen.
 */
export const FullscreenPortalContext = createContext<HTMLElement | null>(null);

/**
 * Returns the element overlays should portal into, or `undefined` to use the
 * Radix default (`document.body`). Safe to call without a provider.
 */
export function useFullscreenPortalContainer(): HTMLElement | undefined {
  return useContext(FullscreenPortalContext) ?? undefined;
}
