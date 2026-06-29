import * as React from "react";

/**
 * useFullscreen — thin wrapper around the browser Fullscreen API.
 *
 * Targets a specific element (the game shell root). Tracks whether the document
 * is currently in fullscreen and exposes enter/exit/toggle helpers. Degrades
 * gracefully: when the API is unavailable, `isSupported` is false and the
 * actions become no-ops, so callers can simply hide the control.
 *
 * Vendor prefixes (Safari/older WebKit) are handled, since this is a non-typed
 * legacy surface we cast through a small local interface instead of `any`.
 */

interface FullscreenDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  mozFullScreenElement?: Element | null;
  mozCancelFullScreen?: () => Promise<void> | void;
  msFullscreenElement?: Element | null;
  msExitFullscreen?: () => Promise<void> | void;
}

interface FullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
  mozRequestFullScreen?: () => Promise<void> | void;
  msRequestFullscreen?: () => Promise<void> | void;
}

function getFullscreenElement(): Element | null {
  if (typeof document === "undefined") return null;
  const d = document as FullscreenDocument;
  return (
    d.fullscreenElement ??
    d.webkitFullscreenElement ??
    d.mozFullScreenElement ??
    d.msFullscreenElement ??
    null
  );
}

function computeSupported(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.documentElement as FullscreenElement;
  return Boolean(
    el.requestFullscreen ||
      el.webkitRequestFullscreen ||
      el.mozRequestFullScreen ||
      el.msRequestFullscreen,
  );
}

export interface UseFullscreenResult {
  /** Whether the Fullscreen API is usable in this browser. */
  isSupported: boolean;
  /** Whether the document is currently in fullscreen. */
  isFullscreen: boolean;
  enter: () => Promise<void>;
  exit: () => Promise<void>;
  toggle: () => Promise<void>;
}

export function useFullscreen(
  targetRef: React.RefObject<HTMLElement>,
): UseFullscreenResult {
  const isSupported = React.useMemo(computeSupported, []);
  const [isFullscreen, setIsFullscreen] = React.useState<boolean>(
    () => getFullscreenElement() !== null,
  );

  React.useEffect(() => {
    if (!isSupported) return;

    const update = () => setIsFullscreen(getFullscreenElement() !== null);

    const events = [
      "fullscreenchange",
      "webkitfullscreenchange",
      "mozfullscreenchange",
      "MSFullscreenChange",
    ];
    events.forEach((e) => document.addEventListener(e, update));
    update();

    return () => {
      events.forEach((e) => document.removeEventListener(e, update));
    };
  }, [isSupported]);

  const enter = React.useCallback(async () => {
    if (!isSupported) return;
    const el = (targetRef.current ?? document.documentElement) as FullscreenElement;
    try {
      if (el.requestFullscreen) await el.requestFullscreen();
      else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
      else if (el.mozRequestFullScreen) await el.mozRequestFullScreen();
      else if (el.msRequestFullscreen) await el.msRequestFullscreen();
    } catch {
      // User gesture rejected or not allowed — leave state as-is.
    }
  }, [isSupported, targetRef]);

  const exit = React.useCallback(async () => {
    if (!isSupported) return;
    const d = document as FullscreenDocument;
    try {
      if (d.exitFullscreen) await d.exitFullscreen();
      else if (d.webkitExitFullscreen) await d.webkitExitFullscreen();
      else if (d.mozCancelFullScreen) await d.mozCancelFullScreen();
      else if (d.msExitFullscreen) await d.msExitFullscreen();
    } catch {
      // Ignore — escape/native exit will still work.
    }
  }, [isSupported]);

  const toggle = React.useCallback(async () => {
    if (getFullscreenElement()) await exit();
    else await enter();
  }, [enter, exit]);

  return { isSupported, isFullscreen, enter, exit, toggle };
}
