/**
 * Build-time feature flags.
 *
 * A flag here is an OPERATOR/DEVELOPER decision baked into the bundle at build
 * time: not a runtime toggle, not a per-user permission, and NOT a
 * protocol-level authorization mechanism. Anyone can construct their own Nostr
 * events in another client; what a flag controls is whether THIS build of
 * Blobbi offers a given surface at all.
 *
 * Parsing is deliberately strict: a flag is on only when its variable is the
 * exact string `"true"`. `"TRUE"`, `"1"`, `"yes"` and an unset variable are
 * all OFF: a mutation-capable surface must never appear because of a typo'd
 * or half-set environment.
 *
 * There is intentionally NO development-mode auto-enable. The repository's
 * `import.meta.env.DEV` convention gates the existence of dev-only ROUTES
 * (`/dev/*`, stripped from production builds); flagged surfaces like the
 * Inventory & Equipment Lab ship in production builds when deliberately
 * enabled, so their semantics must be identical in every mode. Developers
 * enable them locally via `.env.local`.
 */

/**
 * Strict flag parser: exactly `"true"` enables, everything else disables.
 * Exported separately so tests can pin the parsing rule without stubbing
 * `import.meta.env`.
 */
export function isFeatureFlagEnabled(value: string | undefined): boolean {
  return value === 'true';
}

/**
 * Whether THIS BUILD exposes the mutation-capable Inventory & Equipment Lab
 * inside `/tools/game-items`.
 *
 * Default: disabled. When disabled, the Lab tab does not exist, its component
 * chunk is never imported, and no Lab mutation surface mounts, signer
 * ownership checks remain necessary for any write, but they are not the
 * access gate; this flag is.
 *
 * Enable with `VITE_ENABLE_LIVE_INVENTORY_LAB=true` at build (or dev-server)
 * time. See `docs/inventory-equipment-lab.md`.
 */
export const LIVE_INVENTORY_LAB_ENABLED = isFeatureFlagEnabled(
  import.meta.env.VITE_ENABLE_LIVE_INVENTORY_LAB,
);
