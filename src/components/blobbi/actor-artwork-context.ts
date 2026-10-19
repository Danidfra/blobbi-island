/**
 * How the body tells its actor what it is.
 *
 * `BlobbiActor` draws the ground shadow and owns the float, but never sees
 * the visual: the body is whatever child it is given (the local companion
 * display, a remote sprite, a dev fixture). The body knows its generation,
 * stage and facing, so it is the one that can ask the renderer where the
 * drawing's ground line and footprint are (`resolveGroundShadow`) and say
 * whether it floats at all (`stageFloats`). This context carries that answer
 * UP, from the body to the actor, without the actor learning anything else.
 *
 * Outside an actor (a card, a preview, a modal portrait) the context is null
 * and the report goes nowhere: those surfaces draw no actor shadow.
 */
import { createContext, useContext, useLayoutEffect } from 'react';

import type { GroundShadowGeometry } from '@/lib/blobbi-ground-shadow';

export interface ActorArtworkReport {
  /** Where the drawing stands in its box. */
  shadow: GroundShadowGeometry;
  /** Whether it hovers over its shadow at rest (a baby) or stands on the ground (an adult, an egg). */
  floats: boolean;
}

export type ReportActorArtwork = (report: ActorArtworkReport | null) => void;

export const ActorArtworkContext = createContext<ReportActorArtwork | null>(null);

/**
 * Report this body to the enclosing actor, before paint, so the shadow's
 * first frame is already under the feet and a grounded adult never bobs for
 * a frame. A body outside an actor reports to nobody. Callers memoise the
 * report; the actor ignores one that changes nothing.
 */
export function useReportActorArtwork(report: ActorArtworkReport | null): void {
  const send = useContext(ActorArtworkContext);
  useLayoutEffect(() => {
    if (!send) return;
    send(report);
  }, [send, report]);
}
