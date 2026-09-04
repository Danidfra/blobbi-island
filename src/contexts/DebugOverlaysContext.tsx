import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

/**
 * DebugOverlaysContext: a single shared switch for developer-only VISUAL debug
 * overlays (red boundaries, movement-blocker outlines, Blobbi position text,
 * multiplayer/session debug box, location debug, etc.).
 *
 * Design goals:
 *   - One shared flag instead of scattered `process.env.NODE_ENV` checks across
 *     many components.
 *   - The control (and the overlays) only exist in development builds. In
 *     production `isDevMode` is false, the toggle is never rendered, and overlays
 *     never show: regardless of any persisted localStorage value.
 *   - Off by default, even in development, so the world looks clean on load.
 *
 * `isDevMode` uses Vite's `import.meta.env.DEV`, which is statically `false` in
 * production builds (so the overlay code can be tree-shaken / short-circuited).
 */

const STORAGE_KEY = "blobbi-debug-overlays";

/** True only in dev/local builds. Statically false in production. */
export const isDevMode = import.meta.env.DEV;

interface DebugOverlaysContextType {
  /** Whether the app is running in a dev/local build (gates the toggle UI). */
  isDevMode: boolean;
  /**
   * Whether visual debug overlays should be shown right now. Always `false` in
   * production, regardless of stored state.
   */
  showDebugOverlays: boolean;
  /** Turn overlays on/off (no-op in production). */
  setShowDebugOverlays: (show: boolean) => void;
  /** Convenience toggle (no-op in production). */
  toggleDebugOverlays: () => void;
}

const DebugOverlaysContext = createContext<DebugOverlaysContextType | undefined>(
  undefined,
);

function readInitial(): boolean {
  if (!isDevMode) return false;
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(STORAGE_KEY) === "1";
}

export const DebugOverlaysProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [enabled, setEnabled] = useState<boolean>(readInitial);

  const setShowDebugOverlays = useCallback((show: boolean) => {
    // In production this is effectively dead code (the toggle is never rendered),
    // but guard anyway so overlays can never be force-enabled.
    if (!isDevMode) return;
    setEnabled(show);
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(STORAGE_KEY, show ? "1" : "0");
      }
    } catch {
      // Ignore storage failures (private mode, etc.).
    }
  }, []);

  const toggleDebugOverlays = useCallback(() => {
    setShowDebugOverlays(!enabled);
  }, [enabled, setShowDebugOverlays]);

  const value = useMemo<DebugOverlaysContextType>(
    () => ({
      isDevMode,
      // Hard gate: overlays are impossible in production.
      showDebugOverlays: isDevMode && enabled,
      setShowDebugOverlays,
      toggleDebugOverlays,
    }),
    [enabled, setShowDebugOverlays, toggleDebugOverlays],
  );

  return (
    <DebugOverlaysContext.Provider value={value}>
      {children}
    </DebugOverlaysContext.Provider>
  );
};

/**
 * useDebugOverlays: read/control the shared visual-debug-overlay switch.
 *
 * Safe to call outside the provider (e.g. in tests): it falls back to a
 * production-like state where everything is off and the toggle is hidden.
 */
export function useDebugOverlays(): DebugOverlaysContextType {
  const context = useContext(DebugOverlaysContext);
  if (!context) {
    return {
      isDevMode: false,
      showDebugOverlays: false,
      setShowDebugOverlays: () => {},
      toggleDebugOverlays: () => {},
    };
  }
  return context;
}
