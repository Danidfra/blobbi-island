/**
 * Utility functions for accessory management
 */

import { accessoryImagePath } from '@/lib/asset-paths';
import type {
  AccessorySlot,
  AccessoryForm,
  AccessoryItem,
  EquipmentConfig,
  AccessoryEditData
} from './accessory-types';
import {
  SLOT_PREFIXES,
  VALID_FORMS,
  GITHUB_ACCESSORY_BASE_URL,
  AccessoryValidationError
} from './accessory-types';

// ============================================================================
// Slot Inference
// ============================================================================

/** Infer accessory slot from code prefix */
export function inferSlotFromCode(code: string): AccessorySlot {
  // Back-compat: map "glasses-" prefix to "eyewear-"
  if (code.startsWith('glasses-')) {
    return 'eyewear';
  }

  for (const [slot, prefix] of Object.entries(SLOT_PREFIXES)) {
    if (slot === 'unknown') continue; // Skip unknown slot
    if (code.startsWith(prefix)) {
      return slot as AccessorySlot;
    }
  }

  // If prefix is unknown, return "unknown" instead of throwing
  console.warn(`Unknown accessory prefix for code: ${code}`);
  return 'unknown';
}

// ============================================================================
// URL Generation
// ============================================================================

/** Generate GitHub URL for accessory based on code */
export function generateAccessoryUrl(code: string): string | null {
  try {
    const slot = inferSlotFromCode(code);
    if (slot === 'unknown') {
      return null; // Don't generate URL for unknown slots
    }
    const filename = `${code}.png`;
    return `${GITHUB_ACCESSORY_BASE_URL}/${slot}/${filename}`;
  } catch (error) {
    console.warn(`Failed to generate accessory URL for ${code}:`, error);
    return null;
  }
}

// ============================================================================
// Tag Parsing
// ============================================================================

/**
 * Parse a numeric tag value preserving decimals.
 *
 * The legacy parsers used `parseInt` for x/y/rot, silently truncating the
 * decimal positions produced by drag editing on every save/load round-trip.
 * This parser keeps valid decimals and falls back for anything non-finite
 * (absent, empty, NaN, Infinity) — it never returns a non-finite number.
 */
export function parseFiniteNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Shared defaults for absent/invalid equip-tag fields.
 *
 * The two legacy parsers disagreed (`parseEquipTag` defaulted x to 50,
 * `parseEquipTags` to 5); 50/50 — the box center — is the sensible single
 * default and matches the documented tag example in `blobbi-types.ts`.
 * refw/refh default to 100: the reference space of the 0-100 percentage
 * coordinates (see `accessory-normalize.ts` — parsed and preserved, no
 * runtime conversion).
 */
export const EQUIP_TAG_DEFAULTS = {
  x: 50,
  y: 50,
  scale: 1.0,
  rot: 0,
  refw: 100,
  refh: 100,
} as const;

/** Parse one raw equip tag array into an EquipmentConfig (shared by both parsers). */
function parseEquipTagEntries(equipTag: string[]): EquipmentConfig {
  const code = equipTag[1];

  // Parse key-value pairs from the tag
  const tagEntries: Record<string, string> = {};
  for (let i = 2; i < equipTag.length; i += 2) {
    const key = equipTag[i];
    const val = equipTag[i + 1] || '';
    tagEntries[key] = val;
  }

  return {
    code,
    x: parseFiniteNumber(tagEntries.x, EQUIP_TAG_DEFAULTS.x),
    y: parseFiniteNumber(tagEntries.y, EQUIP_TAG_DEFAULTS.y),
    scale: parseFiniteNumber(tagEntries.scale, EQUIP_TAG_DEFAULTS.scale),
    rot: parseFiniteNumber(tagEntries.rot, EQUIP_TAG_DEFAULTS.rot),
    flipX: tagEntries.flipX === '1',
    refw: parseFiniteNumber(tagEntries.refw, EQUIP_TAG_DEFAULTS.refw),
    refh: parseFiniteNumber(tagEntries.refh, EQUIP_TAG_DEFAULTS.refh),
    form: (tagEntries.form || 'default') as AccessoryForm,
    url: tagEntries.url || generateAccessoryUrl(code) || '',
    slot: inferSlotFromCode(code),
  };
}

/** Parse an equip tag from event tags */
export function parseEquipTag(tags: string[][], code: string): EquipmentConfig | null {
  const equipTag = tags.find(([name, tagCode]) => name === 'equip' && tagCode === code);

  if (!equipTag) return null;

  try {
    return parseEquipTagEntries(equipTag);
  } catch (error) {
    console.warn(`Failed to parse equip tag for ${code}:`, error);
    return null;
  }
}

/** Parse all inventory tags from event tags */
export function parseInvTags(tags: string[][]): AccessoryItem[] {
  return tags
    .filter(([name]) => name === 'inv')
    .map((invTag) => {
      try {
        // Parse inv tag format: ["inv", "<code>", "qty", "<int>", "url", "..."]
        if (invTag.length < 4) {
          console.warn(`Invalid inv tag length:`, invTag);
          return null;
        }

        const code = invTag[1] || '';
        const qtyStr = invTag[3] || '0';
        const qty = parseInt(qtyStr, 10);

        // Skip if quantity is 0 or invalid
        if (qty <= 0 || isNaN(qty)) {
          return null;
        }

        // Generate URL safely - never throw
        const url = generateAccessoryUrl(code) || '';

        // Infer slot safely - never throw
        const slot = inferSlotFromCode(code);

        return {
          code,
          quantity: qty,
          url,
          slot,
        };
      } catch (error) {
        console.warn(`Failed to parse inv tag:`, invTag, error);
        return null;
      }
    })
    .filter((item): item is AccessoryItem => item !== null);
}

/** Parse all equipment tags from event tags */
export function parseEquipTags(tags: string[][]): EquipmentConfig[] {
  return tags
    .filter(([name]) => name === 'equip')
    .map((equipTag) => {
      try {
        return parseEquipTagEntries(equipTag);
      } catch (error) {
        console.warn(`Failed to parse equip tag:`, equipTag, error);
        return null;
      }
    })
    .filter((config): config is EquipmentConfig => config !== null);
}

// ============================================================================
// Tag Creation
// ============================================================================

/**
 * Serialize a numeric field: decimals are preserved (never truncated to int),
 * limited to 2 decimal places so float noise from dragging (55.00000000001)
 * doesn't accumulate across save/load round-trips. Integers stay integers
 * ("55", not "55.00").
 */
function serializeNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** Create an equip tag from equipment config */
export function createEquipTag(config: EquipmentConfig): string[] {
  const tag: string[] = ['equip', config.code];

  // Add all properties
  tag.push('x', serializeNumber(config.x));
  tag.push('y', serializeNumber(config.y));
  tag.push('scale', serializeNumber(config.scale));
  tag.push('rot', serializeNumber(config.rot));
  tag.push('flipX', config.flipX ? '1' : '0');
  tag.push('refw', serializeNumber(config.refw));
  tag.push('refh', serializeNumber(config.refh));
  tag.push('form', config.form);
  tag.push('url', config.url);
  tag.push('ver', '1');

  return tag;
}

/** Create an inv tag from accessory item */
export function createInvTag(item: AccessoryItem): string[] {
  return ['inv', item.code, 'qty', item.quantity.toString(), 'url', item.url, 'ver', '1'];
}

// ============================================================================
// Validation
// ============================================================================

/** Validate accessory edit data */
export function validateAccessoryEditData(data: AccessoryEditData): void {
  if (data.x < 0 || data.x > 100) {
    throw new AccessoryValidationError('X position must be between 0 and 100');
  }

  if (data.y < 0 || data.y > 100) {
    throw new AccessoryValidationError('Y position must be between 0 and 100');
  }

  if (data.scale < 0.25 || data.scale > 2.0) {
    throw new AccessoryValidationError('Scale must be between 0.25 and 2.0');
  }

  if (data.rot < -45 || data.rot > 45) {
    throw new AccessoryValidationError('Rotation must be between -45 and 45 degrees');
  }

  if (!VALID_FORMS.includes(data.form)) {
    throw new AccessoryValidationError(`Invalid form: ${data.form}`);
  }

  if (data.refw <= 0) {
    throw new AccessoryValidationError('Reference width must be positive');
  }

  if (data.refh <= 0) {
    throw new AccessoryValidationError('Reference height must be positive');
  }

  if (!data.url.trim()) {
    throw new AccessoryValidationError('URL cannot be empty');
  }
}

/** Check if accessory code is valid */
export function isValidAccessoryCode(code: string): boolean {
  try {
    inferSlotFromCode(code);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Inventory Management
// ============================================================================

/** Merge duplicate inventory tags by summing quantities */
export function mergeInventoryTags(items: AccessoryItem[]): AccessoryItem[] {
  const merged = new Map<string, AccessoryItem>();

  for (const item of items) {
    const existing = merged.get(item.code);
    if (existing) {
      merged.set(item.code, {
        ...existing,
        quantity: existing.quantity + item.quantity,
      });
    } else {
      merged.set(item.code, { ...item });
    }
  }

  return Array.from(merged.values()).sort((a, b) => a.code.localeCompare(b.code));
}

/** Find equipment by slot */
export function findEquipmentBySlot(equipment: EquipmentConfig[], slot: AccessorySlot): EquipmentConfig | null {
  return equipment.find(config => config.slot === slot) || null;
}

/** Remove equipment by code */
export function removeEquipmentByCode(equipment: EquipmentConfig[], code: string): EquipmentConfig[] {
  return equipment.filter(config => config.code !== code);
}

/** Check if user has enough quantity of an accessory */
export function checkInventoryQuantity(inventory: AccessoryItem[], code: string, required: number = 1): boolean {
  const item = inventory.find(item => item.code === code);
  return item ? item.quantity >= required : false;
}

// ============================================================================
// Local Asset Resolution
// ============================================================================

/** Resolve accessory image URL from local assets first, then fallback to remote */
export function resolveAccessoryImageUrl(code: string, slot: AccessorySlot, _remoteUrl?: string): string {
  // Don't try to resolve URLs for unknown slots
  if (slot === 'unknown') {
    return '';
  }

  // Prioritize the local PNG asset; the `onError` handlers in the accessory components
  // walk the remaining fallback chain (.webp, then placeholder).
  return accessoryImagePath(slot, code, 'png');
}

// ============================================================================
// Event Tag Management
// ============================================================================

/** Remove all inv tags from event tags */
export function removeInvTags(tags: string[][]): string[][] {
  return tags.filter(([name]) => name !== 'inv');
}

/** Remove all equip tags from event tags */
export function removeEquipTags(tags: string[][]): string[][] {
  return tags.filter(([name]) => name !== 'equip');
}

/** Add or update inv tags in event tags */
export function updateInvTags(tags: string[][], items: AccessoryItem[]): string[][] {
  // Remove existing inv tags
  const filteredTags = removeInvTags(tags);

  // Add new inv tags
  for (const item of items) {
    if (item.quantity > 0) {
      filteredTags.push(createInvTag(item));
    }
  }

  return filteredTags;
}

/** Add or update equip tags in event tags */
export function updateEquipTags(tags: string[][], equipment: EquipmentConfig[]): string[][] {
  // Remove existing equip tags
  const filteredTags = removeEquipTags(tags);

  // Add new equip tags
  for (const config of equipment) {
    filteredTags.push(createEquipTag(config));
  }

  return filteredTags;
}

/** Update inventory quantity for a specific item */
export function updateInventoryQuantity(inventory: AccessoryItem[], code: string, delta: number): AccessoryItem[] {
  const existing = inventory.find(item => item.code === code);

  if (!existing && delta > 0) {
    // Create new item if it doesn't exist and we're adding
    const url = generateAccessoryUrl(code) || '';
    const slot = inferSlotFromCode(code);

    return [
      ...inventory,
      {
        code,
        quantity: delta,
        url,
        slot,
      }
    ];
  }

  if (!existing) {
    return inventory; // No change if item doesn't exist and we're removing
  }

  const newQuantity = existing.quantity + delta;

  if (newQuantity <= 0) {
    // Remove item if quantity reaches 0
    return inventory.filter(item => item.code !== code);
  }

  // Update existing item
  return inventory.map(item =>
    item.code === code
      ? { ...item, quantity: newQuantity }
      : item
  );
}