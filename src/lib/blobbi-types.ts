/**
 * Comprehensive TypeScript types for Blobbi Nostr events
 * Kind 31125: Owner Profile
 * Kind 31124: Pet State
 */

// ============================================================================
// Kind 31125 - Owner Profile Types
// ============================================================================

/** Required tags for kind 31125 Owner Profile events */
export interface OwnerProfileRequiredTags {
  /** Profile ID (required) */
  d: string;
  /** Display name (can be empty) */
  name: string;
}

/** Optional tags for kind 31125 Owner Profile events */
export interface OwnerProfileOptionalTags {
  /** Currency amount */
  coins?: string;
  /** Interaction level */
  pettingLevel?: string;
  /** Total Blobbis the user has ever owned */
  lifetimeBlobbis?: string;
  /** Favorite Blobbi ID */
  favoriteBlobbi?: string;
  /** First Blobbi ID */
  starterBlobbi?: string;
  /** Currently selected companion Blobbi ID */
  current_companion?: string;
  /** Visual style/theme */
  style?: string;
  /** Background theme */
  background?: string;
  /** Custom title or role */
  title?: string;
  /** Identifying tag for the app/client that created it */
  client?: string;
}

/** Multi-value tags for kind 31125 Owner Profile events */
export interface OwnerProfileMultiTags {
  /** List of owned pet IDs (multiple) */
  has?: string[];
  /** List of earned achievement IDs (multiple) */
  achievements?: string[];
  /** Items in inventory in "item_id:quantity" format (multiple) */
  storage?: string[];
}

/** Complete tag interface for kind 31125 Owner Profile events */
export type OwnerProfileTags = OwnerProfileRequiredTags &
  OwnerProfileOptionalTags &
  OwnerProfileMultiTags;

/** Parsed owner profile data structure */
export interface OwnerProfile {
  /** Profile ID */
  id: string;
  /** Display name */
  name: string;
  /** Currency amount */
  coins: number;
  /** Interaction level */
  pettingLevel: number;
  /** Total Blobbis the user has ever owned */
  lifetimeBlobbis: number;
  /** Favorite Blobbi ID */
  favoriteBlobbi?: string;
  /** First Blobbi ID */
  starterBlobbi?: string;
  /** Currently selected companion Blobbi ID */
  currentCompanion?: string;
  /** Visual style/theme */
  style?: string;
  /** Background theme */
  background?: string;
  /** Custom title or role */
  title?: string;
  /** List of owned pet IDs */
  ownedPets: string[];
  /** List of earned achievement IDs */
  achievements: string[];
  /** Parsed inventory items */
  inventory: InventoryItem[];
  /** Client that created the event */
  client?: string;
}

/** Input data for creating an owner profile event */
export interface CreateOwnerProfileInput {
  /** Profile ID (required) */
  profileId: string;
  /** Display name (can be empty) */
  name: string;
  /** Currency amount */
  coins?: number;
  /** Interaction level */
  pettingLevel?: number;
  /** Total Blobbis the user has ever owned */
  lifetimeBlobbis?: number;
  /** Favorite Blobbi ID */
  favoriteBlobbi?: string;
  /** First Blobbi ID */
  starterBlobbi?: string;
  /** Currently selected companion Blobbi ID */
  currentCompanion?: string;
  /** Visual style/theme */
  style?: string;
  /** Background theme */
  background?: string;
  /** Custom title or role */
  title?: string;
  /** List of owned pet IDs */
  ownedPets?: string[];
  /** List of earned achievement IDs */
  achievements?: string[];
  /** Inventory items */
  inventory?: InventoryItem[];
  /** Content for the event */
  content?: string;
}

/** Inventory item structure */
export interface InventoryItem {
  /** Item ID */
  itemId: string;
  /** Quantity owned */
  quantity: number;
}

// ============================================================================
// Kind 31124 - Pet State Types
// ============================================================================

/** Pet stage enum */
export type PetStage = 'egg' | 'baby' | 'adult';

/** Boolean string type for Nostr tags */
export type BooleanString = 'true' | 'false';

/** Required tags for kind 31124 Pet State events */
export interface PetStateRequiredTags {
  /** Pet ID (required) */
  d: string;
  /** Pet stage */
  stage: PetStage;
  /** Whether pet is ready for breeding */
  breeding_ready: BooleanString;
  /** Generation number */
  generation: string;
  /** Hunger level (0-100) */
  hunger: string;
  /** Happiness level (0-100) */
  happiness: string;
  /** Health level (0-100) */
  health: string;
  /** Hygiene level (0-100) */
  hygiene: string;
  /** Energy level (0-100) */
  energy: string;
  /** Total experience points */
  experience: string;
  /** Consecutive care days */
  care_streak: string;
}

/** Optional appearance tags for kind 31124 Pet State events */
export interface PetStateAppearanceTags {
  /** Base color */
  base_color?: string;
  /** Secondary color */
  secondary_color?: string;
  /** Pattern type */
  pattern?: string;
  /** Eye color */
  eye_color?: string;
  /** Special markings */
  special_mark?: string;
  /** Adult type (for adult stage) */
  adult_type?: string;
  /** Manifestation type */
  manifestation?: string;
  /** Visual effects */
  visual_effect?: string;
  /** Special blessing */
  blessing?: string;
}

/** Optional personality tags for kind 31124 Pet State events */
export interface PetStatePersonalityTags {
  /** Personality type */
  personality?: string;
  /** Character trait */
  trait?: string;
  /** Current mood */
  mood?: string;
  /** Favorite food */
  favorite_food?: string;
  /** Voice type */
  voice_type?: string;
  /** Size category */
  size?: string;
  /** Title or rank */
  title?: string;
  /** Special skill */
  skill?: string;
}

/** Optional egg-specific tags (for stage="egg") */
export interface PetStateEggTags {
  /** Incubation time required */
  incubation_time?: string;
  /** Current incubation progress */
  incubation_progress?: string;
  /** Egg temperature */
  egg_temperature?: string;
  /** Egg status */
  egg_status?: string;
  /** Shell integrity level */
  shell_integrity?: string;
}

/** Optional behavior tags for kind 31124 Pet State events */
export interface PetStateBehaviorTags {
  /** Whether pet is sleeping */
  is_sleeping?: BooleanString;
  /** Whether pet is dirty */
  is_dirty?: BooleanString;
  /** Whether pet has a buff */
  has_buff?: BooleanString;
  /** Whether pet has a debuff */
  has_debuff?: BooleanString;
  /** Last interaction timestamp */
  last_interaction?: string;
}

/** Optional care tracking tags for kind 31124 Pet State events */
export interface PetStateCareTags {
  /** Last meal timestamp */
  last_meal?: string;
  /** Last cleaning timestamp */
  last_clean?: string;
  /** Last warming timestamp */
  last_warm?: string;
  /** Last talk timestamp */
  last_talk?: string;
  /** Last check timestamp */
  last_check?: string;
  /** Last sing timestamp */
  last_sing?: string;
  /** Last medicine timestamp */
  last_medicine?: string;
}

/** Optional social tags for kind 31124 Pet State events */
export interface PetStateSocialTags {
  /** Adopted by pubkey */
  adopted_by?: string;
  /** Adopted from pubkey */
  adopted_from?: string;
  /** Current location */
  current_location?: string;
  /** Whether in party */
  in_party?: BooleanString;
  /** Whether visible to others */
  visible_to_others?: BooleanString;
}

/** Optional special tags for kind 31124 Pet State events */
export interface PetStateSpecialTags {
  /** Associated fees */
  fees?: string;
  /** Penalty amount */
  penalty?: string;
  /** Pet value */
  value?: string;
  /** Care points deducted */
  care_points_deducted?: string;
  /** Client that created the event */
  client?: string;
}

/** Complete tag interface for kind 31124 Pet State events */
export type PetStateTags = PetStateRequiredTags &
  PetStateAppearanceTags &
  PetStatePersonalityTags &
  PetStateEggTags &
  PetStateBehaviorTags &
  PetStateCareTags &
  PetStateSocialTags &
  PetStateSpecialTags;

/** Parsed pet state data structure */
export interface PetState {
  /** Pet ID */
  id: string;
  /** Pet name (from content field) */
  name: string;
  /** Pet stage */
  stage: PetStage;
  /** Whether pet is ready for breeding */
  breedingReady: boolean;
  /** Generation number */
  generation: number;

  // Core stats (0-100)
  /** Hunger level */
  hunger: number;
  /** Happiness level */
  happiness: number;
  /** Health level */
  health: number;
  /** Hygiene level */
  hygiene: number;
  /** Energy level */
  energy: number;

  // Progress
  /** Total experience points */
  experience: number;
  /** Consecutive care days */
  careStreak: number;

  // Appearance
  /** Base color */
  baseColor?: string;
  /** Secondary color */
  secondaryColor?: string;
  /** Pattern type */
  pattern?: string;
  /** Eye color */
  eyeColor?: string;
  /** Special markings */
  specialMark?: string;
  /** Adult type (for adult stage) */
  adultType?: string;
  /** Manifestation type */
  manifestation?: string;
  /** Visual effects */
  visualEffect?: string;
  /** Special blessing */
  blessing?: string;

  // Personality
  /** Personality type */
  personality?: string;
  /** Character trait */
  trait?: string;
  /** Current mood */
  mood?: string;
  /** Favorite food */
  favoriteFood?: string;
  /** Voice type */
  voiceType?: string;
  /** Size category */
  size?: string;
  /** Title or rank */
  title?: string;
  /** Special skill */
  skill?: string;

  // Egg-specific (for stage="egg")
  /** Incubation time required */
  incubationTime?: number;
  /** Current incubation progress */
  incubationProgress?: number;
  /** Egg temperature */
  eggTemperature?: number;
  /** Egg status */
  eggStatus?: string;
  /** Shell integrity level */
  shellIntegrity?: number;

  // Behavior
  /** Whether pet is sleeping */
  isSleeping: boolean;
  /** Whether pet is dirty */
  isDirty: boolean;
  /** Whether pet has a buff */
  hasBuff: boolean;
  /** Whether pet has a debuff */
  hasDebuff: boolean;
  /** Last interaction timestamp */
  lastInteraction?: Date;

  // Care tracking
  /** Last meal timestamp */
  lastMeal?: Date;
  /** Last cleaning timestamp */
  lastClean?: Date;
  /** Last warming timestamp */
  lastWarm?: Date;
  /** Last talk timestamp */
  lastTalk?: Date;
  /** Last check timestamp */
  lastCheck?: Date;
  /** Last sing timestamp */
  lastSing?: Date;
  /** Last medicine timestamp */
  lastMedicine?: Date;

  // Social
  /** Adopted by pubkey */
  adoptedBy?: string;
  /** Adopted from pubkey */
  adoptedFrom?: string;
  /** Current location */
  currentLocation?: string;
  /** Whether in party */
  inParty: boolean;
  /** Whether visible to others */
  visibleToOthers: boolean;

  // Special
  /** Associated fees */
  fees?: number;
  /** Penalty amount */
  penalty?: number;
  /** Pet value */
  value?: number;
  /** Care points deducted */
  carePointsDeducted?: number;
  /** Client that created the event */
  client?: string;
}

// ============================================================================
// Optimized Status Layer Types
// ============================================================================

/** Combined optimized status for real-time UI rendering */
export interface OptimizedStatus {
  /** Owner profile data */
  owner: OwnerProfile | null;
  /** Currently selected pet data */
  currentPet: PetState | null;
  /** All owned pets */
  allPets: PetState[];
  /** Last update timestamp */
  lastUpdated: Date;
  /** Whether data is loading */
  isLoading: boolean;
  /** Any error state */
  error?: string;
}

/** Update payload for optimistic updates */
export interface StatusUpdate {
  /** Pet ID being updated */
  petId?: string;
  /** Owner profile updates */
  ownerUpdates?: Partial<OwnerProfile>;
  /** Pet state updates */
  petUpdates?: Partial<PetState>;
  /** Timestamp of the update */
  timestamp: Date;
}

// ============================================================================
// Utility Types
// ============================================================================

/** Sleep state derived from pet behavior */
export type SleepState = 'awake' | 'sleeping' | 'tired';

/** Overall pet condition derived from stats */
export type PetCondition = 'excellent' | 'good' | 'fair' | 'poor' | 'critical';

/** Care urgency level */
export type CareUrgency = 'none' | 'low' | 'medium' | 'high' | 'critical';

/** Care need type */
export type CareNeed = 'food' | 'cleaning' | 'play' | 'rest' | 'medicine' | 'attention';

/** Derived care status */
export interface CareStatus {
  /** Most urgent care need */
  urgentNeed?: CareNeed;
  /** Urgency level */
  urgency: CareUrgency;
  /** Overall condition */
  condition: PetCondition;
  /** Sleep state */
  sleepState: SleepState;
  /** Time until next care needed */
  nextCareIn?: number; // minutes
}