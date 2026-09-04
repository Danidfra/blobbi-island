/**
 * Props a Blobbi wears BECAUSE OF WHERE IT IS SITTING: the VR headset in a
 * Nostr Station chair. Presentation only, resolved from the seat through the
 * shared pose model (`resolveActorRender(...).seatedAccessory`), so the local
 * player and a remote player seated in the same chair wear the same thing.
 *
 * This is deliberately not the equipment system. Nothing here is published,
 * placed, owned or persisted; the prop exists exactly as long as the pose
 * says `seated` in a chair that carries a `seatedAccessory`, and the pose
 * flipping back to standing unmounts it in the same render.
 *
 * Geometry: the layer wraps the renderer box (`BlobbiRendererView`, a fixed
 * square) and positions the prop in box percent at the face anchor from
 * `blobbi-actor-anchors.ts`. Because it sits INSIDE the actor's scale rig,
 * the prop follows the body through the room's depth ramp, the seat scale and
 * the viewport's world transform without knowing about any of them.
 */
import React from 'react';
import { cn } from '@/lib/utils';
import type { SeatedAccessory } from '@/lib/room-seats-config';
import {
  blobbiFaceAnchor,
  type BlobbiFaceVisual,
  VR_HEADSET_HEIGHT_PERCENT,
  VR_HEADSET_SRC,
  VR_HEADSET_WIDTH_PERCENT,
} from '@/lib/blobbi-actor-anchors';

interface SeatedAccessoryLayerProps {
  accessory: SeatedAccessory | null;
  /** A face prop has nothing to sit on when the Blobbi faces away. */
  facing: 'front' | 'back';
  /** The body being drawn: its form decides where the eye line is. */
  visual?: BlobbiFaceVisual | null;
  /** The renderer box (the body). */
  children: React.ReactNode;
}

export function SeatedAccessoryLayer({ accessory, facing, visual, children }: SeatedAccessoryLayerProps) {
  const showHeadset = accessory === 'vr-headset' && facing === 'front';
  // Nothing to wear: the body renders exactly as it would without this layer,
  // so no consumer of the display pays for the wrapper.
  if (!showHeadset) return <>{children}</>;
  const face = blobbiFaceAnchor(visual);
  return (
    <div className="relative w-fit" data-seated-accessory-layer="">
      {children}
      <img
        src={VR_HEADSET_SRC}
        alt=""
        aria-hidden
        draggable={false}
        data-seated-accessory="vr-headset"
        className={cn(
          'pointer-events-none absolute max-w-none select-none',
          // A short equip fade; static under reduced motion.
          'animate-in fade-in duration-150 motion-reduce:animate-none',
        )}
        style={{
          left: `${face.x}%`,
          top: `${face.y}%`,
          width: `${VR_HEADSET_WIDTH_PERCENT}%`,
          height: `${VR_HEADSET_HEIGHT_PERCENT}%`,
          transform: 'translate(-50%, -50%)',
        }}
      />
    </div>
  );
}
