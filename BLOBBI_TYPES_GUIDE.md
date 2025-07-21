# Blobbi TypeScript Types Guide

This guide explains the comprehensive TypeScript typing system for Blobbi Nostr events (kinds 31125 and 31124) and the optimized status layer.

## Overview

The typing system provides:
- **Full type safety** for all possible tags in both event kinds
- **Optimized status layer** for real-time UI updates without waiting for relay responses
- **Validation functions** to ensure event integrity
- **Parser utilities** to convert Nostr events into typed objects
- **Event creation hooks** for type-safe event publishing

## File Structure

```
src/lib/
├── blobbi-types.ts      # Type definitions for all Blobbi events
├── blobbi-parsers.ts    # Parsing and validation utilities

src/hooks/
├── useOptimizedStatus.ts # Optimized status layer with real-time updates
├── useBlobbiEvents.ts   # Type-safe event creation hooks
├── useBlobbis.ts        # Updated to use new type system (backward compatible)
└── useCurrentCompanion.ts # Updated to use new type system

src/components/blobbi/
└── OptimizedStatusExample.tsx # Example component demonstrating usage
```

## Type Definitions

### Kind 31125 - Owner Profile

```typescript
interface OwnerProfile {
  // Required fields
  id: string;                    // Profile ID (from 'd' tag)
  name: string;                  // Display name (from 'name' tag)
  
  // Stats
  coins: number;                 // Currency amount
  pettingLevel: number;          // Interaction level
  lifetimeBlobbis: number;       // Total Blobbis ever owned
  
  // References
  favoriteBlobbi?: string;       // Favorite Blobbi ID
  starterBlobbi?: string;        // First Blobbi ID
  currentCompanion?: string;     // Currently selected companion
  
  // Customization
  style?: string;                // Visual style/theme
  background?: string;           // Background theme
  title?: string;                // Custom title or role
  
  // Collections
  ownedPets: string[];           // List of owned pet IDs
  achievements: string[];        // List of earned achievement IDs
  inventory: InventoryItem[];    // Parsed inventory items
  
  // Metadata
  client?: string;               // Client that created the event
}
```

### Kind 31124 - Pet State

```typescript
interface PetState {
  // Identity
  id: string;                    // Pet ID (from 'd' tag)
  name: string;                  // Pet name (from content field)
  stage: 'egg' | 'baby' | 'adult';
  generation: number;
  breedingReady: boolean;
  
  // Core stats (0-100)
  hunger: number;
  happiness: number;
  health: number;
  hygiene: number;
  energy: number;
  
  // Progress
  experience: number;            // Total XP
  careStreak: number;            // Consecutive care days
  
  // Appearance (all optional)
  baseColor?: string;
  secondaryColor?: string;
  pattern?: string;
  eyeColor?: string;
  specialMark?: string;
  adultType?: string;            // For adult stage
  manifestation?: string;
  visualEffect?: string;
  blessing?: string;
  
  // Personality (all optional)
  personality?: string;
  trait?: string;
  mood?: string;
  favoriteFood?: string;
  voiceType?: string;
  size?: string;
  title?: string;
  skill?: string;
  
  // Egg-specific (for stage="egg")
  incubationTime?: number;
  incubationProgress?: number;
  eggTemperature?: number;
  eggStatus?: string;
  shellIntegrity?: number;
  
  // Behavior
  isSleeping: boolean;
  isDirty: boolean;
  hasBuff: boolean;
  hasDebuff: boolean;
  lastInteraction?: Date;
  
  // Care tracking (all timestamps as Date objects)
  lastMeal?: Date;
  lastClean?: Date;
  lastWarm?: Date;
  lastTalk?: Date;
  lastCheck?: Date;
  lastSing?: Date;
  lastMedicine?: Date;
  
  // Social
  adoptedBy?: string;            // Pubkey
  adoptedFrom?: string;          // Pubkey
  currentLocation?: string;
  inParty: boolean;
  visibleToOthers: boolean;
  
  // Special
  fees?: number;
  penalty?: number;
  value?: number;
  carePointsDeducted?: number;
  client?: string;
}
```

## Optimized Status Layer

The optimized status layer provides real-time UI updates without waiting for relay responses.

### Basic Usage

```typescript
import { useOptimizedStatus } from '@/hooks/useOptimizedStatus';

function MyComponent() {
  const { status, updatePetStats, setCurrentCompanion } = useOptimizedStatus();
  
  const { owner, currentPet, allPets, isLoading } = status;
  
  if (isLoading) return <div>Loading...</div>;
  
  return (
    <div>
      <h1>{owner?.name || 'Unnamed Owner'}</h1>
      <p>Coins: {owner?.coins || 0}</p>
      
      {currentPet && (
        <div>
          <h2>{currentPet.name}</h2>
          <p>Hunger: {currentPet.hunger}/100</p>
          <button onClick={() => updatePetStats(currentPet.id, { hunger: 100 })}>
            Feed (Optimistic Update)
          </button>
        </div>
      )}
    </div>
  );
}
```

### Convenience Hooks

```typescript
import { useCurrentPet, useOwnerProfile, useAllPets } from '@/hooks/useOptimizedStatus';

// Get just the current pet
const currentPet = useCurrentPet();

// Get just the owner profile
const owner = useOwnerProfile();

// Get all pets
const allPets = useAllPets();
```

### Action Hooks with Optimistic Updates

```typescript
import { useFeedPet, useCleanPet, usePutPetToSleep } from '@/hooks/useOptimizedStatus';

function PetCareButtons({ petId }: { petId: string }) {
  const feedPet = useFeedPet();
  const cleanPet = useCleanPet();
  const putToSleep = usePutPetToSleep();
  
  return (
    <div>
      <button onClick={() => feedPet(petId)}>Feed</button>
      <button onClick={() => cleanPet(petId)}>Clean</button>
      <button onClick={() => putToSleep(petId)}>Sleep</button>
    </div>
  );
}
```

## Event Creation

### Creating Owner Profile Events

```typescript
import { useCreateOwnerProfile, useUpdateOwnerProfile } from '@/hooks/useBlobbiEvents';

function OwnerProfileForm() {
  const createProfile = useCreateOwnerProfile();
  const updateProfile = useUpdateOwnerProfile();
  
  const handleCreate = () => {
    createProfile.mutate({
      profileId: 'profile',
      name: 'My Name',
      coins: 100,
      pettingLevel: 5,
      achievements: ['first_pet', 'caretaker'],
      inventory: [
        { itemId: 'food_basic', quantity: 10 },
        { itemId: 'toy_ball', quantity: 1 }
      ]
    });
  };
  
  const handleUpdate = () => {
    updateProfile.mutate({
      coins: 150, // Only update coins, other fields remain unchanged
    });
  };
  
  return (
    <div>
      <button onClick={handleCreate}>Create Profile</button>
      <button onClick={handleUpdate}>Add Coins</button>
    </div>
  );
}
```

### Creating Pet State Events

```typescript
import { useCreatePetState, useUpdatePetState } from '@/hooks/useBlobbiEvents';

function PetCreationForm() {
  const createPet = useCreatePetState();
  const updatePet = useUpdatePetState();
  
  const handleCreateBaby = () => {
    createPet.mutate({
      petId: 'pet_001',
      name: 'Fluffy',
      stage: 'baby',
      generation: 1,
      hunger: 80,
      happiness: 70,
      health: 100,
      hygiene: 90,
      energy: 60,
      baseColor: 'blue',
      personality: 'playful',
      mood: 'happy'
    });
  };
  
  const handleFeed = () => {
    updatePet.mutate({
      petId: 'pet_001',
      updates: {
        hunger: 100,
        lastMeal: new Date(),
        happiness: 75 // Small happiness boost
      }
    });
  };
  
  return (
    <div>
      <button onClick={handleCreateBaby}>Create Baby Pet</button>
      <button onClick={handleFeed}>Feed Pet</button>
    </div>
  );
}
```

## Parsing and Validation

### Parsing Nostr Events

```typescript
import { parseOwnerProfile, parsePetState } from '@/lib/blobbi-parsers';

// Parse a kind 31125 event
const ownerProfile = parseOwnerProfile(nostrEvent);
if (ownerProfile) {
  console.log('Owner:', ownerProfile.name);
  console.log('Coins:', ownerProfile.coins);
}

// Parse a kind 31124 event
const petState = parsePetState(nostrEvent);
if (petState) {
  console.log('Pet:', petState.name);
  console.log('Hunger:', petState.hunger);
}
```

### Validation

```typescript
import { validateOwnerProfileEvent, validatePetStateEvent } from '@/lib/blobbi-parsers';

// Validate events before parsing
const events = await nostr.query([{ kinds: [31125, 31124] }]);

const validOwnerEvents = events.filter(validateOwnerProfileEvent);
const validPetEvents = events.filter(validatePetStateEvent);
```

### Care Status Analysis

```typescript
import { analyzeCareStatus } from '@/lib/blobbi-parsers';

const pet = parsePetState(event);
if (pet) {
  const careStatus = analyzeCareStatus(pet);
  
  console.log('Condition:', careStatus.condition);     // 'excellent' | 'good' | 'fair' | 'poor' | 'critical'
  console.log('Urgency:', careStatus.urgency);         // 'none' | 'low' | 'medium' | 'high' | 'critical'
  console.log('Urgent need:', careStatus.urgentNeed);  // 'food' | 'cleaning' | 'play' | etc.
  console.log('Sleep state:', careStatus.sleepState);  // 'awake' | 'sleeping' | 'tired'
}
```

## Migration from Legacy Code

The new type system is backward compatible with existing code:

### useBlobbis Hook

The `useBlobbis` hook still returns the legacy `Blobbi[]` interface, but now uses the new typed parsing internally:

```typescript
// This still works exactly as before
const { data: blobbis } = useBlobbis();
```

### useCurrentCompanion Hook

The `useCurrentCompanion` hook now uses typed parsing but returns the same string value:

```typescript
// This still works exactly as before
const { data: companionId } = useCurrentCompanion();
```

## Best Practices

1. **Use the optimized status layer** for UI components that need real-time updates
2. **Apply optimistic updates** for immediate user feedback
3. **Validate events** before parsing to ensure data integrity
4. **Use typed event creation hooks** instead of manually constructing tags
5. **Leverage care status analysis** for intelligent UI decisions

## Example: Complete Pet Care Component

```typescript
import React from 'react';
import { useOptimizedStatus, useFeedPet, useCleanPet } from '@/hooks/useOptimizedStatus';
import { analyzeCareStatus } from '@/lib/blobbi-parsers';

export function PetCareWidget() {
  const { status } = useOptimizedStatus();
  const feedPet = useFeedPet();
  const cleanPet = useCleanPet();
  
  const { currentPet } = status;
  
  if (!currentPet) {
    return <div>No pet selected</div>;
  }
  
  const careStatus = analyzeCareStatus(currentPet);
  
  return (
    <div className="pet-care-widget">
      <h2>{currentPet.name}</h2>
      <div className="stats">
        <div>Hunger: {currentPet.hunger}/100</div>
        <div>Hygiene: {currentPet.hygiene}/100</div>
        <div>Condition: {careStatus.condition}</div>
      </div>
      
      {careStatus.urgentNeed && (
        <div className="alert">
          Urgent: Pet needs {careStatus.urgentNeed}!
        </div>
      )}
      
      <div className="actions">
        <button 
          onClick={() => feedPet(currentPet.id)}
          disabled={currentPet.hunger >= 90}
        >
          Feed
        </button>
        <button 
          onClick={() => cleanPet(currentPet.id)}
          disabled={currentPet.hygiene >= 90}
        >
          Clean
        </button>
      </div>
    </div>
  );
}
```

This component demonstrates:
- Real-time status updates
- Care status analysis
- Optimistic UI updates
- Intelligent button states based on pet needs