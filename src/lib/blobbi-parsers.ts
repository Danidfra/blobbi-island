/**
 * Utility functions for parsing Nostr events into typed Blobbi structures
 */

import type { NostrEvent } from '@nostrify/nostrify';
import type {
  OwnerProfile,
  PetState,
  InventoryItem,
  PetStage,
  BooleanString,
  CareStatus,
  CareUrgency,
  PetCondition,
  SleepState,
  CareNeed,
} from './blobbi-types';
import { nameFromDTag } from './blobbi-name';
import {
  KIND_BLOBBONAUT_PROFILE,
  KIND_BLOBBONAUT_PROFILE_LEGACY,
  KIND_BLOBBI_STATE,
} from './blobbi-kinds';
import { BLOBBI_ECOSYSTEM_NAMESPACE } from '@blobbi/core/blobbi';

/** Find a tag value within a raw tags array (first match). */
function rawTagValue(rawTags: string[][], name: string): string | undefined {
  return rawTags.find(([tagName]) => tagName === name)?.[1];
}

// ============================================================================
// Tag Parsing Utilities
// ============================================================================

/** Get a single tag value from a Nostr event */
export function getTag(event: NostrEvent, tagName: string): string | undefined {
  return event.tags.find(([name]) => name === tagName)?.[1];
}

/** Get multiple tag values from a Nostr event */
export function getTags(event: NostrEvent, tagName: string): string[] {
  return event.tags.filter(([name]) => name === tagName).map(([, value]) => value);
}

/** Parse a boolean string tag */
export function parseBooleanTag(value: string | undefined, defaultValue = false): boolean {
  if (!value) return defaultValue;
  return value === 'true';
}

/** Parse a numeric tag with fallback */
export function parseNumericTag(value: string | undefined, defaultValue = 0): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/** Parse a timestamp tag into a Date object */
export function parseTimestampTag(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const timestamp = parseInt(value, 10);
  if (isNaN(timestamp)) return undefined;
  return new Date(timestamp * 1000); // Convert from Unix timestamp
}

/** Parse inventory items from storage tags */
export function parseInventoryItems(storageTags: string[]): InventoryItem[] {
  return storageTags
    .map(tag => {
      const [itemId, quantityStr] = tag.split(':');
      const quantity = parseInt(quantityStr, 10);
      if (!itemId || isNaN(quantity)) return null;
      return { itemId, quantity };
    })
    .filter((item): item is InventoryItem => item !== null);
}

// ============================================================================
// Owner Profile Parser (Kind 11125, with legacy 31125 support)
// ============================================================================

/** Parse a kind 11125 (or legacy 31125) event into an OwnerProfile */
export function parseOwnerProfile(event: NostrEvent): OwnerProfile | null {
  if (event.kind !== KIND_BLOBBONAUT_PROFILE && event.kind !== KIND_BLOBBONAUT_PROFILE_LEGACY) return null;

  const id = getTag(event, 'd');
  const name = getTag(event, 'name');

  if (!id || name === undefined) {
    // Missing required tags
    return null;
  }

  const storageTags = getTags(event, 'storage');
  const inventory = parseInventoryItems(storageTags);

  return {
    id,
    name,
    coins: parseNumericTag(getTag(event, 'coins'), 0),
    pettingLevel: parseNumericTag(getTag(event, 'pettingLevel'), 0),
    lifetimeBlobbis: parseNumericTag(getTag(event, 'lifetimeBlobbis'), 0),
    favoriteBlobbi: getTag(event, 'favoriteBlobbi'),
    starterBlobbi: getTag(event, 'starterBlobbi'),
    currentCompanion: getTag(event, 'current_companion'),
    style: getTag(event, 'style'),
    background: getTag(event, 'background'),
    title: getTag(event, 'title'),
    ownedPets: getTags(event, 'has'),
    achievements: getTags(event, 'achievements'),
    inventory,
    client: getTag(event, 'client'),
    rawTags: event.tags,
    rawContent: event.content,
  };
}

// ============================================================================
// Pet State Parser (Kind 31124)
// ============================================================================

/** Parse a kind 31124 event into a PetState */
export function parsePetState(event: NostrEvent): PetState | null {
  if (event.kind !== KIND_BLOBBI_STATE) return null;

  const id = getTag(event, 'd');
  const stage = getTag(event, 'stage') as PetStage;
  const breedingReadyStr = getTag(event, 'breeding_ready') as BooleanString;
  const generation = getTag(event, 'generation');
  const hunger = getTag(event, 'hunger');
  const happiness = getTag(event, 'happiness');
  const health = getTag(event, 'health');
  const hygiene = getTag(event, 'hygiene');
  const energy = getTag(event, 'energy');
  const experience = getTag(event, 'experience');
  const careStreak = getTag(event, 'care_streak');

  // Validate required tags
  if (!id || !stage || !breedingReadyStr || !generation ||
      !hunger || !happiness || !health || !hygiene ||
      !energy || !experience || !careStreak) {
    return null;
  }

  // Validate stage enum
  if (!['egg', 'baby', 'adult'].includes(stage)) {
    return null;
  }

  const dTag = getTag(event, 'd');
  return {
    id,
    name: nameFromDTag(dTag) || getTag(event, 'name') || id,
    stage,
    breedingReady: parseBooleanTag(breedingReadyStr),
    generation: parseNumericTag(generation, 1),

    // Core stats
    hunger: parseNumericTag(hunger, 50),
    happiness: parseNumericTag(happiness, 50),
    health: parseNumericTag(health, 50),
    hygiene: parseNumericTag(hygiene, 50),
    energy: parseNumericTag(energy, 50),

    // Progress
    experience: parseNumericTag(experience, 0),
    careStreak: parseNumericTag(careStreak, 0),

    // Appearance
    baseColor: getTag(event, 'base_color'),
    secondaryColor: getTag(event, 'secondary_color'),
    pattern: getTag(event, 'pattern'),
    eyeColor: getTag(event, 'eye_color'),
    specialMark: getTag(event, 'special_mark'),
    adultType: getTag(event, 'adult_type'),
    manifestation: getTag(event, 'manifestation'),
    visualEffect: getTag(event, 'visual_effect'),
    blessing: getTag(event, 'blessing'),

    // Personality
    personality: getTag(event, 'personality'),
    trait: getTag(event, 'trait'),
    mood: getTag(event, 'mood'),
    favoriteFood: getTag(event, 'favorite_food'),
    voiceType: getTag(event, 'voice_type'),
    size: getTag(event, 'size'),
    title: getTag(event, 'title'),
    skill: getTag(event, 'skill'),

    // Egg-specific
    incubationTime: parseNumericTag(getTag(event, 'incubation_time')),
    incubationProgress: parseNumericTag(getTag(event, 'incubation_progress')),
    eggTemperature: parseNumericTag(getTag(event, 'egg_temperature')),
    eggStatus: getTag(event, 'egg_status'),
    shellIntegrity: parseNumericTag(getTag(event, 'shell_integrity')),

    // Behavior
    isSleeping: parseBooleanTag(getTag(event, 'is_sleeping')),
    isDirty: parseBooleanTag(getTag(event, 'is_dirty')),
    hasBuff: parseBooleanTag(getTag(event, 'has_buff')),
    hasDebuff: parseBooleanTag(getTag(event, 'has_debuff')),
    lastInteraction: parseTimestampTag(getTag(event, 'last_interaction')),

    // Care tracking
    lastMeal: parseTimestampTag(getTag(event, 'last_meal')),
    lastClean: parseTimestampTag(getTag(event, 'last_clean')),
    lastWarm: parseTimestampTag(getTag(event, 'last_warm')),
    lastTalk: parseTimestampTag(getTag(event, 'last_talk')),
    lastCheck: parseTimestampTag(getTag(event, 'last_check')),
    lastSing: parseTimestampTag(getTag(event, 'last_sing')),
    lastMedicine: parseTimestampTag(getTag(event, 'last_medicine')),

    // Social
    adoptedBy: getTag(event, 'adopted_by'),
    adoptedFrom: getTag(event, 'adopted_from'),
    currentLocation: getTag(event, 'current_location'),
    inParty: parseBooleanTag(getTag(event, 'in_party')),
    visibleToOthers: parseBooleanTag(getTag(event, 'visible_to_others'), true),

    // Special
    fees: parseNumericTag(getTag(event, 'fees')),
    penalty: parseNumericTag(getTag(event, 'penalty')),
    value: parseNumericTag(getTag(event, 'value')),
    carePointsDeducted: parseNumericTag(getTag(event, 'care_points_deducted')),
    client: getTag(event, 'client'),
    rawTags: event.tags,
    rawContent: event.content,
  };
}

// ============================================================================
// Care Status Analysis
// ============================================================================

/** Calculate care urgency based on stat value */
function getStatUrgency(value: number): CareUrgency {
  if (value <= 10) return 'critical';
  if (value <= 25) return 'high';
  if (value <= 50) return 'medium';
  if (value <= 75) return 'low';
  return 'none';
}

/** Calculate overall pet condition */
function calculateCondition(pet: PetState): PetCondition {
  const avgStat = (pet.hunger + pet.happiness + pet.health + pet.hygiene + pet.energy) / 5;

  if (avgStat >= 90) return 'excellent';
  if (avgStat >= 75) return 'good';
  if (avgStat >= 50) return 'fair';
  if (avgStat >= 25) return 'poor';
  return 'critical';
}

/** Calculate sleep state */
function calculateSleepState(pet: PetState): SleepState {
  if (pet.isSleeping) return 'sleeping';
  if (pet.energy <= 20) return 'tired';
  return 'awake';
}

/** Find the most urgent care need */
function findUrgentCareNeed(pet: PetState): { need?: CareNeed; urgency: CareUrgency } {
  const needs: Array<{ need: CareNeed; urgency: CareUrgency }> = [
    { need: 'food', urgency: getStatUrgency(pet.hunger) },
    { need: 'play', urgency: getStatUrgency(pet.happiness) },
    { need: 'medicine', urgency: getStatUrgency(pet.health) },
    { need: 'cleaning', urgency: getStatUrgency(pet.hygiene) },
    { need: 'rest', urgency: getStatUrgency(pet.energy) },
  ];

  // Add special conditions
  if (pet.isDirty) {
    needs.push({ need: 'cleaning', urgency: 'high' });
  }

  // Sort by urgency priority
  const urgencyOrder: CareUrgency[] = ['critical', 'high', 'medium', 'low', 'none'];
  needs.sort((a, b) => urgencyOrder.indexOf(a.urgency) - urgencyOrder.indexOf(b.urgency));

  const mostUrgent = needs[0];
  return mostUrgent.urgency === 'none'
    ? { urgency: 'none' }
    : { need: mostUrgent.need, urgency: mostUrgent.urgency };
}

/** Calculate time until next care is needed (in minutes) */
function calculateNextCareTime(pet: PetState): number | undefined {
  const now = new Date();
  const timeSinceLastMeal = pet.lastMeal ? (now.getTime() - pet.lastMeal.getTime()) / (1000 * 60) : Infinity;
  const timeSinceLastClean = pet.lastClean ? (now.getTime() - pet.lastClean.getTime()) / (1000 * 60) : Infinity;

  // Simple heuristic: pets need food every 4 hours, cleaning every 6 hours
  const nextMealIn = Math.max(0, 240 - timeSinceLastMeal); // 4 hours
  const nextCleanIn = Math.max(0, 360 - timeSinceLastClean); // 6 hours

  const nextCare = Math.min(nextMealIn, nextCleanIn);
  return nextCare === Infinity ? undefined : nextCare;
}

/** Analyze pet care status */
export function analyzeCareStatus(pet: PetState): CareStatus {
  const { need: urgentNeed, urgency } = findUrgentCareNeed(pet);
  const condition = calculateCondition(pet);
  const sleepState = calculateSleepState(pet);
  const nextCareIn = calculateNextCareTime(pet);

  return {
    urgentNeed,
    urgency,
    condition,
    sleepState,
    nextCareIn,
  };
}

// ============================================================================
// Owner Profile Tag Merging (preserves unknown tags from Ditto)
// ============================================================================

/**
 * Tags that blobbi-island manages (knows how to read/write).
 * Any tag NOT in this set is considered "unknown" and will be preserved as-is
 * when republishing, so we don't strip tags set by Ditto (like
 * `blobbi_onboarding_done`, `xp`, `level`, `room`, etc.).
 *
 * `b` is managed: we author the canonical `blobbi:ecosystem:v1` namespace on
 * write (preferring any existing value), so it must be excluded from the
 * unknown-tag passthrough to avoid duplication.
 */
const MANAGED_OWNER_PROFILE_TAG_NAMES = new Set([
  'd', 'b', 'name', 'coins', 'pettingLevel', 'lifetimeBlobbis',
  'favoriteBlobbi', 'starterBlobbi', 'current_companion',
  'style', 'background', 'title',
  // Multi-value tags
  'has', 'achievements', 'storage',
  // Inventory (accessory) tags
  'inv',
]);

/**
 * Merge owner profile tags for republishing.
 * Builds managed tags from the profile's current state, then appends any unknown
 * tags from the original event so that tags set by Ditto are never dropped.
 *
 * Tags like `client` are NOT in the managed set — they are preserved as-is from
 * rawTags so multi-element tags (e.g. `['client', 'Ditto', '31990:...']`) keep
 * all their values.
 */
export function mergeOwnerProfileTags(profile: OwnerProfile): string[][] {
  // Build managed tags from profile fields
  const tags: string[][] = [
    ['d', profile.id],
    // Canonical ecosystem marker required by @blobbi/core validation.
    // Prefer the existing value from the source event (never overwrite), else
    // author the canonical namespace. Additive + idempotent.
    ['b', rawTagValue(profile.rawTags, 'b') ?? BLOBBI_ECOSYSTEM_NAMESPACE],
    ['name', profile.name],
    ['coins', profile.coins.toString()],
    ['pettingLevel', profile.pettingLevel.toString()],
    ['lifetimeBlobbis', profile.lifetimeBlobbis.toString()],
  ];

  // Add optional single-value tags
  if (profile.favoriteBlobbi) tags.push(['favoriteBlobbi', profile.favoriteBlobbi]);
  if (profile.starterBlobbi) tags.push(['starterBlobbi', profile.starterBlobbi]);
  if (profile.currentCompanion) tags.push(['current_companion', profile.currentCompanion]);
  if (profile.style) tags.push(['style', profile.style]);
  if (profile.background) tags.push(['background', profile.background]);
  if (profile.title) tags.push(['title', profile.title]);

  // Add multi-value tags
  profile.ownedPets.forEach(petId => tags.push(['has', petId]));
  profile.achievements.forEach(achievement => tags.push(['achievements', achievement]));
  profile.inventory.forEach(item => tags.push(['storage', `${item.itemId}:${item.quantity}`]));

  // Preserve unknown tags from the original event (tags we don't manage)
  // This keeps Ditto's tags like `b`, `blobbi_onboarding_done`, `xp`, `level`, `room`,
  // and `client` (which may have 3+ elements) exactly as they were.
  const unknownTags = profile.rawTags.filter(tag => !MANAGED_OWNER_PROFILE_TAG_NAMES.has(tag[0]));
  tags.push(...unknownTags);

  return tags;
}

// ============================================================================
// Pet State Tag Merging (preserves unknown tags from Ditto)
// ============================================================================

/**
 * Tags that blobbi-island manages for kind 31124 (Pet State).
 * Any tag NOT in this set is preserved as-is when republishing.
 * Tags like `seed`, `progression_state`, `progression_started_at`,
 * `last_decay_at`, and `client` (which may have 3+ elements) are NOT
 * managed — they come through from rawTags.
 *
 * `b` and `state` are managed: we author canonical values on write (preferring
 * any existing value from the source event), so they must be excluded from the
 * unknown-tag passthrough to avoid duplication.
 */
const MANAGED_PET_STATE_TAG_NAMES = new Set([
  'd', 'b', 'state', 'stage', 'breeding_ready', 'generation',
  'hunger', 'happiness', 'health', 'hygiene', 'energy',
  'experience', 'care_streak',
  // Appearance
  'base_color', 'secondary_color', 'pattern', 'eye_color', 'special_mark',
  'adult_type', 'manifestation', 'visual_effect', 'blessing',
  // Personality
  'personality', 'trait', 'mood', 'favorite_food', 'voice_type', 'size', 'title', 'skill',
  // Egg-specific
  'incubation_time', 'incubation_progress', 'egg_temperature', 'egg_status', 'shell_integrity',
  // Behavior
  'is_sleeping', 'is_dirty', 'has_buff', 'has_debuff', 'last_interaction',
  // Care tracking
  'last_meal', 'last_clean', 'last_warm', 'last_talk', 'last_check', 'last_sing', 'last_medicine',
  // Social
  'adopted_by', 'adopted_from', 'current_location', 'in_party', 'visible_to_others',
  // Special
  'fees', 'penalty', 'value', 'care_points_deducted',
  // Equipment (managed by accessory system)
  'equip',
]);

/** Convert Date to Unix timestamp string */
function dateToTimestamp(date: Date): string {
  return Math.floor(date.getTime() / 1000).toString();
}

/**
 * Merge pet state tags for republishing.
 * Builds managed tags from the pet's current state, then appends any unknown
 * tags from the original event so that tags set by Ditto are never dropped.
 *
 * @param pet - The pet state (with rawTags from the original event)
 * @param overrides - Optional tag overrides as [tagName, value] pairs (e.g. updated stats)
 */
export function mergePetStateTags(
  pet: PetState,
  overrides?: Record<string, string>,
): string[][] {
  // Canonical ecosystem marker required by @blobbi/core validation.
  // Prefer the existing value from the source event (never overwrite).
  const bValue = rawTagValue(pet.rawTags, 'b') ?? BLOBBI_ECOSYSTEM_NAMESPACE;

  // Canonical activity state required by @blobbi/core validation.
  // Preference order: existing `state` tag from source event > derive from
  // Island's `isSleeping` flag (sleeping/active) > default 'active'.
  const stateValue =
    rawTagValue(pet.rawTags, 'state') ?? (pet.isSleeping ? 'sleeping' : 'active');

  // Canonical last_interaction required by @blobbi/core validation.
  // Preserve the existing value if present, else use the PetState timestamp,
  // else fall back to the current time so the tag is always emitted.
  const lastInteractionValue =
    rawTagValue(pet.rawTags, 'last_interaction') ??
    (pet.lastInteraction ? dateToTimestamp(pet.lastInteraction) : dateToTimestamp(new Date()));

  // Build managed tags from pet fields
  const tags: string[][] = [
    ['d', pet.id],
    ['b', bValue],
    ['state', stateValue],
    ['stage', pet.stage],
    ['breeding_ready', pet.breedingReady ? 'true' : 'false'],
    ['generation', pet.generation.toString()],
    ['hunger', pet.hunger.toString()],
    ['happiness', pet.happiness.toString()],
    ['health', pet.health.toString()],
    ['hygiene', pet.hygiene.toString()],
    ['energy', pet.energy.toString()],
    ['experience', pet.experience.toString()],
    ['care_streak', pet.careStreak.toString()],
    ['last_interaction', lastInteractionValue],
  ];

  // Care tracking timestamps
  if (pet.lastMeal) tags.push(['last_meal', dateToTimestamp(pet.lastMeal)]);
  if (pet.lastClean) tags.push(['last_clean', dateToTimestamp(pet.lastClean)]);
  if (pet.lastWarm) tags.push(['last_warm', dateToTimestamp(pet.lastWarm)]);
  if (pet.lastTalk) tags.push(['last_talk', dateToTimestamp(pet.lastTalk)]);
  if (pet.lastCheck) tags.push(['last_check', dateToTimestamp(pet.lastCheck)]);
  if (pet.lastSing) tags.push(['last_sing', dateToTimestamp(pet.lastSing)]);
  if (pet.lastMedicine) tags.push(['last_medicine', dateToTimestamp(pet.lastMedicine)]);

  // Appearance
  if (pet.baseColor) tags.push(['base_color', pet.baseColor]);
  if (pet.secondaryColor) tags.push(['secondary_color', pet.secondaryColor]);
  if (pet.pattern) tags.push(['pattern', pet.pattern]);
  if (pet.eyeColor) tags.push(['eye_color', pet.eyeColor]);
  if (pet.specialMark) tags.push(['special_mark', pet.specialMark]);
  if (pet.adultType) tags.push(['adult_type', pet.adultType]);
  if (pet.manifestation) tags.push(['manifestation', pet.manifestation]);
  if (pet.visualEffect) tags.push(['visual_effect', pet.visualEffect]);
  if (pet.blessing) tags.push(['blessing', pet.blessing]);

  // Personality
  if (pet.personality) tags.push(['personality', pet.personality]);
  if (pet.trait) tags.push(['trait', pet.trait]);
  if (pet.mood) tags.push(['mood', pet.mood]);
  if (pet.favoriteFood) tags.push(['favorite_food', pet.favoriteFood]);
  if (pet.voiceType) tags.push(['voice_type', pet.voiceType]);
  if (pet.size) tags.push(['size', pet.size]);
  if (pet.title) tags.push(['title', pet.title]);
  if (pet.skill) tags.push(['skill', pet.skill]);

  // Egg-specific
  if (pet.stage === 'egg') {
    if (pet.incubationTime) tags.push(['incubation_time', pet.incubationTime.toString()]);
    if (pet.incubationProgress) tags.push(['incubation_progress', pet.incubationProgress.toString()]);
    if (pet.eggTemperature) tags.push(['egg_temperature', pet.eggTemperature.toString()]);
    if (pet.eggStatus) tags.push(['egg_status', pet.eggStatus]);
    if (pet.shellIntegrity) tags.push(['shell_integrity', pet.shellIntegrity.toString()]);
  }

  // Behavior
  tags.push(['is_sleeping', pet.isSleeping ? 'true' : 'false']);
  tags.push(['is_dirty', pet.isDirty ? 'true' : 'false']);
  tags.push(['has_buff', pet.hasBuff ? 'true' : 'false']);
  tags.push(['has_debuff', pet.hasDebuff ? 'true' : 'false']);

  // Social
  if (pet.adoptedBy) tags.push(['adopted_by', pet.adoptedBy]);
  if (pet.adoptedFrom) tags.push(['adopted_from', pet.adoptedFrom]);
  if (pet.currentLocation) tags.push(['current_location', pet.currentLocation]);
  tags.push(['in_party', pet.inParty ? 'true' : 'false']);
  tags.push(['visible_to_others', pet.visibleToOthers ? 'true' : 'false']);

  // Special
  if (pet.fees) tags.push(['fees', pet.fees.toString()]);
  if (pet.penalty) tags.push(['penalty', pet.penalty.toString()]);
  if (pet.value) tags.push(['value', pet.value.toString()]);
  if (pet.carePointsDeducted) tags.push(['care_points_deducted', pet.carePointsDeducted.toString()]);

  // Apply overrides (replace matching managed tags)
  if (overrides) {
    const overrideKeys = new Set(Object.keys(overrides));
    const filteredTags = tags.filter(tag => !overrideKeys.has(tag[0]));
    for (const [name, value] of Object.entries(overrides)) {
      filteredTags.push([name, value]);
    }
    // Preserve unknown tags from the original event
    const unknownTags = pet.rawTags.filter(tag => !MANAGED_PET_STATE_TAG_NAMES.has(tag[0]));
    filteredTags.push(...unknownTags);
    return filteredTags;
  }

  // Preserve unknown tags from the original event
  const unknownTags = pet.rawTags.filter(tag => !MANAGED_PET_STATE_TAG_NAMES.has(tag[0]));
  tags.push(...unknownTags);

  return tags;
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Ecosystem gate: reject events explicitly tagged with a foreign ecosystem.
 *
 * Rules (backward-compatible):
 * - No `b` tag  → accept (legacy Blobbi events predate the ecosystem tag).
 * - `b === BLOBBI_ECOSYSTEM_NAMESPACE` → accept.
 * - `b` present but different (e.g. `pets:ecosystem:v1`) → reject.
 */
function isForeignEcosystem(event: NostrEvent): boolean {
  const b = getTag(event, 'b');
  return b !== undefined && b !== BLOBBI_ECOSYSTEM_NAMESPACE;
}

/** Validate a kind 11125 (or legacy 31125) event structure */
export function validateOwnerProfileEvent(event: NostrEvent): boolean {
  if (event.kind !== KIND_BLOBBONAUT_PROFILE && event.kind !== KIND_BLOBBONAUT_PROFILE_LEGACY) return false;

  // Reject explicit non-Blobbi ecosystem events (missing `b` stays accepted).
  if (isForeignEcosystem(event)) return false;

  const d = getTag(event, 'd');
  const name = getTag(event, 'name');

  return !!(d && name !== undefined);
}

/** Validate a kind 31124 event structure */
export function validatePetStateEvent(event: NostrEvent): boolean {
  if (event.kind !== KIND_BLOBBI_STATE) return false;

  // Reject explicit non-Blobbi ecosystem events (missing `b` stays accepted).
  if (isForeignEcosystem(event)) return false;

  const requiredTags = ['d', 'stage', 'breeding_ready', 'generation',
                       'hunger', 'happiness', 'health', 'hygiene',
                       'energy', 'experience', 'care_streak'];

  return requiredTags.every(tagName => getTag(event, tagName) !== undefined);
}