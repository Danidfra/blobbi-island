import * as React from "react";

/**
 * useImmersive — decides whether the game should render in near-fullscreen
 * "immersive" mode (real phones / tablets) vs the cozy centered "framed" mode
 * (desktops & laptops).
 *
 * Why not just `width < 768`?
 *   Modern phones in landscape are often WIDER than 768px (e.g. 844×390,
 *   926×428), so a width-only check renders them as desktop. Conversely a small
 *   desktop browser window narrower than 768px would wrongly become immersive.
 *
 * Heuristic (user-agent-safe, feature based):
 *   A device is treated as immersive when it is a touch-first device — i.e. the
 *   primary pointer is coarse AND the device cannot hover (no mouse) — AND the
 *   shorter side of the viewport is small enough to be a handheld (height in
 *   landscape, or width in portrait). Desktops/laptops have a fine pointer
 *   and/or hover capability, so they stay framed even in small windows.
 */
function computeImmersive(): boolean {
  if (typeof window === "undefined") return false;

  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const noHover = window.matchMedia("(hover: none)").matches;
  const touchFirst = coarse && noHover;

  // The "short side" of the viewport — height in landscape, width in portrait.
  const shortSide = Math.min(window.innerWidth, window.innerHeight);

  // Phones/small tablets in landscape rarely exceed ~600px on the short side.
  // Desktops/laptops, even in a small window, are excluded by `touchFirst`.
  const handheldShortSide = shortSide <= 600;

  return touchFirst && handheldShortSide;
}

export function useImmersive(): boolean {
  const [immersive, setImmersive] = React.useState<boolean>(() => computeImmersive());

  React.useEffect(() => {
    const update = () => setImmersive(computeImmersive());

    const queries = [
      window.matchMedia("(pointer: coarse)"),
      window.matchMedia("(hover: none)"),
      window.matchMedia("(orientation: landscape)"),
    ];

    queries.forEach((mql) => mql.addEventListener("change", update));
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);

    update();

    return () => {
      queries.forEach((mql) => mql.removeEventListener("change", update));
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return immersive;
}
