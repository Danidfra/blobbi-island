/**
 * The relay part of the player's stored configuration, and its one migration.
 *
 * Until now `AppConfig.relayUrl` was THE relay: the only one read, the only
 * one written. It is now the PRIMARY relay, and `secondaryRelays` are read and
 * written beside it.
 *
 * ## The migration (version absent → 2)
 *
 * A configuration written by an earlier build has a `relayUrl` and no
 * version. Whatever that relay was (the old default, or one the player
 * picked), it is where their Blobbis and inventory live, so it must keep
 * being read and written. It becomes the first secondary; the Blobbi relay
 * becomes the primary. Nothing the player chose is dropped, and from then on
 * the selection is theirs: a version-2 configuration is never rewritten.
 *
 * A new installation gets the same result from the defaults: the Blobbi relay
 * as primary, the relays earlier builds used as secondaries.
 */

import { DEFAULT_SECONDARY_RELAYS, type IslandRelayConfig } from './island-flows';
import { BLOBBI_RELAY_URL, dedupeRelayUrls, normalizeRelayUrl } from './relay-routing';

export const RELAY_CONFIG_VERSION = 2;

/** The relay fields of `AppConfig`. */
export interface StoredRelayConfig {
  relayUrl: string;
  secondaryRelays?: string[];
  relayConfigVersion?: number;
}

/** What a new installation starts with. */
export const DEFAULT_RELAY_CONFIG: Required<StoredRelayConfig> = {
  relayUrl: BLOBBI_RELAY_URL,
  secondaryRelays: [...DEFAULT_SECONDARY_RELAYS],
  relayConfigVersion: RELAY_CONFIG_VERSION,
};

/** Secondaries never repeat the primary. */
function withoutPrimary(relays: readonly (string | null | undefined)[], primary: string): string[] {
  const normalizedPrimary = normalizeRelayUrl(primary);
  return dedupeRelayUrls(relays).filter((url) => url !== normalizedPrimary);
}

/** Bring a stored configuration to the current version. Idempotent. */
export function migrateRelayConfig<T extends StoredRelayConfig>(config: T): T {
  if (config.relayConfigVersion === RELAY_CONFIG_VERSION) {
    const primary = normalizeRelayUrl(config.relayUrl) ?? BLOBBI_RELAY_URL;
    return { ...config, relayUrl: primary, secondaryRelays: withoutPrimary(config.secondaryRelays ?? [], primary) };
  }
  return {
    ...config,
    relayUrl: BLOBBI_RELAY_URL,
    secondaryRelays: withoutPrimary([config.relayUrl, ...DEFAULT_SECONDARY_RELAYS], BLOBBI_RELAY_URL),
    relayConfigVersion: RELAY_CONFIG_VERSION,
  };
}

/** The selection the pool routes by. */
export function relaySelection(config: StoredRelayConfig): IslandRelayConfig {
  const primary = normalizeRelayUrl(config.relayUrl) ?? config.relayUrl;
  return { primary, secondaries: withoutPrimary(config.secondaryRelays ?? DEFAULT_SECONDARY_RELAYS, primary) };
}

/** Make `url` the primary. The relay it replaces stays, as a secondary. */
export function withPrimary<T extends StoredRelayConfig>(config: T, url: string): T {
  const primary = normalizeRelayUrl(url);
  if (!primary) return config;
  return {
    ...config,
    relayUrl: primary,
    secondaryRelays: withoutPrimary([config.relayUrl, ...(config.secondaryRelays ?? [])], primary),
    relayConfigVersion: RELAY_CONFIG_VERSION,
  };
}

/** Add a secondary relay (ignored when it is malformed, the primary, or already there). */
export function withSecondary<T extends StoredRelayConfig>(config: T, url: string): T {
  return {
    ...config,
    secondaryRelays: withoutPrimary([...(config.secondaryRelays ?? []), url], config.relayUrl),
    relayConfigVersion: RELAY_CONFIG_VERSION,
  };
}

/** Remove a secondary relay. */
export function withoutSecondary<T extends StoredRelayConfig>(config: T, url: string): T {
  const removed = normalizeRelayUrl(url);
  return {
    ...config,
    secondaryRelays: withoutPrimary(config.secondaryRelays ?? [], config.relayUrl).filter((relay) => relay !== removed),
    relayConfigVersion: RELAY_CONFIG_VERSION,
  };
}

/** Whether two configurations select the same relays in the same roles. */
export function sameRelaySelection(a: StoredRelayConfig, b: StoredRelayConfig): boolean {
  const x = relaySelection(a);
  const y = relaySelection(b);
  return x.primary === y.primary && x.secondaries.join('\n') === y.secondaries.join('\n');
}
