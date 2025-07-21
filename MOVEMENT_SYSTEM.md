# Blobbi Movement System

## Overview

The Blobbi Movement System provides smooth, responsive character movement for interactive scenes in the Blobbi Island game. The system features fluid animations, directional awareness, and boundary restrictions to create a polished exploration experience.

## Features

### ✨ Smooth Movement
- **Fluid Animation**: Characters move smoothly between positions using requestAnimationFrame
- **Natural Speed**: Configurable movement speed (default: 100 pixels/second) for calm, natural movement
- **No Teleporting**: Characters always walk to destinations, never jump or teleport

### 🎯 Interactive Controls
- **Click/Tap to Move**: Users can click or tap anywhere on the scene to move their Blobbi
- **Touch Support**: Full support for mobile touchscreen interactions
- **Responsive**: Works across all device sizes and orientations

### 🎨 Visual Effects
- **Clean Character Display**: Shows only the Blobbi SVG without background circles or borders
- **Floating Animation**: Subtle floating effect with soft shadow for hovering appearance
- **Directional Facing**: Character flips horizontally when moving left/right
- **Movement Feedback**: Slight scale effect during movement for visual feedback
- **Soft Shadows**: Drop shadows and ground shadows for depth
- **Transparent Rendering**: Character appears clean and integrated with the scene background

### 🚧 Smart Boundaries
- **Restricted Movement**: Characters can only move in the lower half of scenes (50-100% Y position)
- **Prevents Sky Walking**: Keeps characters grounded and realistic
- **Percentage-Based**: Uses percentage positioning for responsive layouts

### 🎛️ Customizable Options
- **Movement Speed**: Adjustable pixels per second
- **Character Size**: Support for sm, md, lg, xl sizes
- **Trail Effects**: Optional movement trail (disabled by default for cleaner look)
- **Callbacks**: onMoveStart and onMoveComplete events

## Usage

### Basic Implementation

```tsx
import { MovableBlobbi } from '@/components/blobbi/MovableBlobbi';

function MyScene() {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      {/* Your scene background */}
      <img src="/assets/scene-background.png" alt="Scene" />

      {/* Movable Blobbi Character */}
      <MovableBlobbi
        containerRef={containerRef}
        isVisible={true}
        initialPosition={{ x: 50, y: 80 }}
        movementSpeed={100}
        size="lg"
      />
    </div>
  );
}
```

### Advanced Configuration

```tsx
<MovableBlobbi
  containerRef={containerRef}
  isVisible={showCharacter}
  initialPosition={{ x: 30, y: 75 }}
  movementSpeed={120}
  size="xl"
  showTrail={true}
  className="custom-blobbi-styles"
  onMoveStart={(destination) => {
    console.log('Moving to:', destination);
    playWalkingSound();
  }}
  onMoveComplete={(position) => {
    console.log('Arrived at:', position);
    stopWalkingSound();
  }}
/>
```

### Character Display Options

The `CurrentBlobbiDisplay` component now supports transparent rendering:

```tsx
// With background circle (default)
<CurrentBlobbiDisplay size="lg" transparent={false} />

// Clean, transparent display (used in MovableBlobbi)
<CurrentBlobbiDisplay size="lg" transparent={true} />
```

## Props Reference

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `containerRef` | `React.RefObject<HTMLElement>` | Required | Container element for click detection and boundaries |
| `isVisible` | `boolean` | `true` | Whether the character should be visible and interactive |
| `initialPosition` | `Position` | `{ x: 50, y: 75 }` | Starting position as percentage of container |
| `movementSpeed` | `number` | `120` | Movement speed in pixels per second |
| `size` | `"sm" \| "md" \| "lg" \| "xl"` | `"lg"` | Size of the character |
| `className` | `string` | `undefined` | Additional CSS classes |
| `showTrail` | `boolean` | `false` | Show movement trail effect |
| `onMoveStart` | `(destination: Position) => void` | `undefined` | Callback when movement starts |
| `onMoveComplete` | `(position: Position) => void` | `undefined` | Callback when movement completes |

## Position System

Positions are represented as percentages of the container:
- `x`: 0-100 (left to right)
- `y`: 50-100 (middle to bottom - restricted for realism)

```tsx
interface Position {
  x: number; // 0-100 percentage from left
  y: number; // 50-100 percentage from top (restricted to lower half)
}
```

## Integration Examples

### Town Scene (Current Implementation)

The movement system is currently integrated into the Town scene in `InteractiveIslandMap.tsx`:

```tsx
{/* Movable Blobbi Character - only show in town expanded view */}
<MovableBlobbi
  containerRef={mapContainerRef}
  isVisible={showTownExpanded}
  initialPosition={{ x: 50, y: 80 }}
  movementSpeed={100}
  size="lg"
  showTrail={false}
/>
```

### Adding to New Scenes

To add the movement system to other interactive scenes:

1. **Create a container ref**:
   ```tsx
   const sceneContainerRef = useRef<HTMLDivElement>(null);
   ```

2. **Add the ref to your scene container**:
   ```tsx
   <div ref={sceneContainerRef} className="relative w-full h-full">
   ```

3. **Include the MovableBlobbi component**:
   ```tsx
   <MovableBlobbi
     containerRef={sceneContainerRef}
     isVisible={isSceneActive}
     // ... other props
   />
   ```

## Performance Notes

- Uses `requestAnimationFrame` for smooth 60fps animations
- Automatically cancels animations when component unmounts
- Minimal re-renders through careful state management
- Optimized for mobile devices with touch event handling

## Accessibility

- Supports both mouse and touch interactions
- Provides visual feedback for all interactions
- Maintains focus and keyboard navigation compatibility
- Uses semantic HTML and proper ARIA labels where applicable

## Future Enhancements

Potential improvements for the movement system:
- **Pathfinding**: Avoid obstacles and buildings
- **Animation States**: Walking, idle, running animations
- **Sound Integration**: Footstep sounds and ambient audio
- **Multiplayer**: Multiple characters moving simultaneously
- **Interaction Zones**: Special areas that trigger events
- **Terrain Effects**: Different movement speeds on different surfaces