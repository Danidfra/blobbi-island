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
// Owner Profile Parser (Kind 31125)
// ============================================================================

/** Parse a kind 31125 event into an OwnerProfile */
export function parseOwnerProfile(event: NostrEvent): OwnerProfile | null {
  if (event.kind !== 31125) return null;

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
  };
}

// ============================================================================
// Pet State Parser (Kind 31124)
// ============================================================================

/** Parse a kind 31124 event into a PetState */
export function parsePetState(event: NostrEvent): PetState | null {
  if (event.kind !== 31124) return null;

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

  return {
    id,
    name: event.content || id,
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
// Validation Functions
// ============================================================================

/** Validate a kind 31125 event structure */
export function validateOwnerProfileEvent(event: NostrEvent): boolean {
  if (event.kind !== 31125) return false;
  
  const d = getTag(event, 'd');
  const name = getTag(event, 'name');
  
  return !!(d && name !== undefined);
}

/** Validate a kind 31124 event structure */
export function validatePetStateEvent(event: NostrEvent): boolean {
  if (event.kind !== 31124) return false;
  
  const requiredTags = ['d', 'stage', 'breeding_ready', 'generation', 
                       'hunger', 'happiness', 'health', 'hygiene', 
                       'energy', 'experience', 'care_streak'];
  
  return requiredTags.every(tagName => getTag(event, tagName) !== undefined);
}