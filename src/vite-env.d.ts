/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Exposes the mutation-capable Inventory & Equipment Lab when the exact
   * string "true". See `src/lib/feature-flags.ts`.
   */
  readonly VITE_ENABLE_LIVE_INVENTORY_LAB?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
