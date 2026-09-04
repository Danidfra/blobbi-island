/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Exposes the mutation-capable Inventory & Equipment Lab when the exact
   * string "true". See `src/lib/feature-flags.ts`.
   */
  readonly VITE_ENABLE_LIVE_INVENTORY_LAB?: string;
  /**
   * Points the Station's Nostr Farm launch at a local or staging deployment
   * instead of the official site. See `src/connected-experiences`.
   */
  readonly VITE_CONNECTED_EXPERIENCE_URL_NOSTR_FARM?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
