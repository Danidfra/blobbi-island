/**
 * TypeScript types for Blobbi accessory management
 *
 * This system handles:
 * - Kind 11125: Owner Profile with inventory tags (inv)
 * - Kind 31124: Pet State with equipment tags (equip)
 */

// ============================================================================
// Accessory Types
// ============================================================================

/** Accessory slot type inferred from code prefix */
export type AccessorySlot = 'headwear' | 'eyewear' | 'back' | 'neckwear' | 'handheld' | 'face-mark' | 'aura' | 'color-overlay' | 'unknown';

/** Accessory form type */
export type AccessoryForm = 'default' | 'baby' | 'teen' | 'adult';

/**
 * Accessory slots that are not drawn when a Blobbi faces away from the camera.
 *
 * The rule is "would you still see it from behind?":
 *  - `eyewear` / `face-mark` sit on the face — gone.
 *  - `handheld` is held in front of the body; a mirrored placement would need
 *    per-accessory art, so it is hidden rather than misplaced.
 *
 * Everything else stays: `headwear` (hats read fine from behind), `back`
 * (wings/capes are back-mounted and MORE visible), `neckwear` (wraps the neck),
 * `aura` (radial, view-independent) and `color-overlay` (a tint).
 */
export const REAR_VIEW_HIDDEN_SLOTS: ReadonlySet<AccessorySlot> = new Set<AccessorySlot>([
  'eyewear',
  'face-mark',
  'handheld',
]);

/** Equipment tag interface for kind 31124 */
export interface EquipTag {
  /** Tag name: "equip" */
  name: 'equip';
  /** Accessory code (e.g., "headwear-8", "eyewear-2") */
  code: string;
  /** X position (0-100) */
  x: string;
  /** Y position (0-100) */
  y: string;
  /** Scale factor (0.25-2.0) */
  scale: string;
  /** Rotation (-45 to 45) */
  rot: string;
  /** Flip horizontally (0|1) */
  flipX: '0' | '1';
  /** Reference width */
  refw: string;
  /** Reference height */
  refh: string;
  /** Form type */
  form: AccessoryForm;
  /** Accessory image URL */
  url: string;
  /** Version */
  ver: string;
}

/** Inventory tag interface for kind 11125 */
export interface InvTag {
  /** Tag name: "inv" */
  name: 'inv';
  /** Accessory code (e.g., "headwear-8", "eyewear-2") */
  code: string;
  /** Quantity owned */
  qty: string;
  /** Accessory image URL */
  url: string;
  /** Version */
  ver: string;
}

/** Parsed accessory item */
export interface AccessoryItem {
  /** Accessory code (e.g., "headwear-8", "eyewear-2") */
  code: string;
  /** Quantity owned */
  quantity: number;
  /** Accessory image URL */
  url: string;
  /** Slot inferred from code prefix */
  slot: AccessorySlot;
}

/** Parsed equipment configuration */
export interface EquipmentConfig {
  /** Accessory code */
  code: string;
  /** X position (0-100) */
  x: number;
  /** Y position (0-100) */
  y: number;
  /** Scale factor (0.25-2.0) */
  scale: number;
  /** Rotation (-45 to 45) */
  rot: number;
  /** Flip horizontally */
  flipX: boolean;
  /** Reference width */
  refw: number;
  /** Reference height */
  refh: number;
  /** Form type */
  form: AccessoryForm;
  /** Accessory image URL */
  url: string;
  /** Slot inferred from code prefix */
  slot: AccessorySlot;
}

/** Accessory edit form data */
export interface AccessoryEditData {
  /** Accessory code */
  code: string;
  /** X position (0-100) */
  x: number;
  /** Y position (0-100) */
  y: number;
  /** Scale factor (0.25-2.0) */
  scale: number;
  /** Rotation (-45 to 45) */
  rot: number;
  /** Flip horizontally */
  flipX: boolean;
  /** Reference width */
  refw: number;
  /** Reference height */
  refh: number;
  /** Form type */
  form: AccessoryForm;
  /** Accessory image URL */
  url: string;
}

// ============================================================================
// Validation and Utility Types
// ============================================================================

/** Accessory slot prefix mapping */
export const SLOT_PREFIXES: Record<AccessorySlot, string> = {
  headwear: 'headwear-',
  eyewear: 'eyewear-',
  back: 'back-',
  neckwear: 'neckwear-',
  handheld: 'handheld-',
  'face-mark': 'face-mark-',
  aura: 'aura-',
  'color-overlay': 'color-overlay-',
  unknown: '',
} as const;

/** All valid accessory form values */
export const VALID_FORMS: AccessoryForm[] = ['default', 'baby', 'teen', 'adult'] as const;

/** Regular expression pattern for valid accessory codes */
export const ACCESSORY_CODE_PATTERN = /^(headwear|eyewear|back|neckwear|handheld|face-mark|aura|color-overlay)-[A-Za-z0-9_-]+$/;

/** GitHub repository URL pattern */
export const GITHUB_ACCESSORY_BASE_URL = 'https://danidfra.github.io/blobbi-designs/accessories';

// ============================================================================
// Error Types
// ============================================================================

/** Accessory operation error */
export class AccessoryError extends Error {
  constructor(
    message: string,
    public readonly code: 'validation' | 'inventory' | 'network' | 'unknown' = 'unknown'
  ) {
    super(message);
    this.name = 'AccessoryError';
  }
}

/** Validation error */
export class AccessoryValidationError extends AccessoryError {
  constructor(message: string) {
    super(message, 'validation');
    this.name = 'AccessoryValidationError';
  }
}

/** Inventory error (insufficient quantity, etc.) */
export class AccessoryInventoryError extends AccessoryError {
  constructor(message: string) {
    super(message, 'inventory');
    this.name = 'AccessoryInventoryError';
  }
}