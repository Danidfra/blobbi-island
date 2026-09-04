/**
 * DevRooms: the ground-anchor room verification harness (dev-only route
 * `/dev/rooms`; excluded from production builds like DevArcade/DevTheater).
 *
 * Renders any room with its REAL background, walk boundary, depth ramp,
 * z-bands, spawn/exit markers and a locally-driven Blobbi actor; no login
 * required (the body uses an explicit visual). Debug overlays are forced on,
 * so the actor draws its ground-point crosshair, box outline, and
 * position/scale/z readout (see BlobbiActor), and the boundary is outlined by
 * BoundaryVisualizer. Click anywhere to verify that the feet land on the
 * clicked point and stay planted across depth scaling.
 */
import React, { useEffect, useRef, useState } from 'react';
import { InteractiveElements } from '@/components/blobbi/InteractiveElements';
import { LocationProvider } from '@/contexts/LocationContext';
import { DebugOverlaysProvider, useDebugOverlays } from '@/contexts/DebugOverlaysContext';
import { MovementBlockerProvider } from '@/contexts/MovementBlockerContext';
import { PhotoBoothProvider } from '@/contexts/PhotoBoothContext';
import { useLocation } from '@/hooks/useLocation';
import { PlaceBackground } from '@/components/blobbi/PlaceBackground';
import { BoundaryVisualizer } from '@/components/blobbi/BoundaryVisualizer';
import { MovableBlobbi, type MovableBlobbiRef } from '@/components/blobbi/MovableBlobbi';
import { locationBoundaries } from '@/lib/location-boundaries';
import { getBackgroundForLocation, LOCATION_BACKGROUNDS } from '@/lib/location-backgrounds';
import { getBlobbiSizeForLocation } from '@/lib/location-blobbi-sizes';
import { getBlobbiInitialPosition, EXIT_POSITIONS } from '@/lib/location-initial-position';
import type { LocationId } from '@/lib/location-types';
import type { Position } from '@/lib/types';
import { constrainPosition } from '@/lib/boundaries';
import { boundaryYRange, resolveSeatedRender } from '@/lib/blobbi-world-render';
import {
  occupiableTheaterSeats,
  seatAnchorPosition,
  seatApproachPosition,
  seatCushionPoint,
  THEATER_BACKGROUND_FILE,
} from '@/lib/theater-seats-config';
import { DOCK_EVENTS, type PresenceMoveDetail } from '@/components/shell/dock-events';

const DEV_VISUAL = {
  stage: 'baby' as const,
  baseColor: '#8E6BE8',
  secondaryColor: '#B79CF2',
  eyeColor: '#3A2A1A',
  name: 'DevBlobbi',
};

function Marker({ pos, color, label }: { pos: Position; color: string; label: string }) {
  return (
    <div
      className="absolute z-[900] pointer-events-none"
      style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%, -50%)' }}
      title={label}
    >
      <div className="h-2.5 w-2.5 rounded-full border-2" style={{ borderColor: color, background: `${color}66` }} />
      <div className="absolute left-3 top-0 whitespace-nowrap rounded bg-black/70 px-1 text-[9px] text-white">{label}</div>
    </div>
  );
}

/** Keeps a broken room branch from taking down the whole harness. */
class RoomErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(err: unknown) {
    return { error: String(err) };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="absolute left-2 top-2 z-[999] rounded bg-red-900/80 p-2 text-xs text-white">
          InteractiveElements failed: {this.state.error}
        </div>
      );
    }
    return this.props.children;
  }
}

function RoomView() {
  const { currentLocation, setCurrentLocation } = useLocation();
  const containerRef = useRef<HTMLDivElement>(null);
  const blobbiRef = useRef<MovableBlobbiRef>(null);
  const { setShowDebugOverlays } = useDebugOverlays();
  const [lastPos, setLastPos] = useState<Position | null>(null);
  const [hiddenIn, setHiddenIn] = useState<string | null>(null);
  const [sittingIn, setSittingIn] = useState<string | null>(null);
  // The most recent walk-to-interact APPROACH target (usePendingInteraction
  // broadcasts every request as a presenceMove dock event).
  const [lastApproach, setLastApproach] = useState<Position | null>(null);

  useEffect(() => {
    const onMove = (e: Event) => {
      const detail = (e as CustomEvent<PresenceMoveDetail>).detail;
      if (detail?.target) setLastApproach(detail.target);
    };
    document.addEventListener(DOCK_EVENTS.presenceMove, onMove);
    return () => document.removeEventListener(DOCK_EVENTS.presenceMove, onMove);
  }, []);

  // Mirrors PlayingView.handleSitInSeat: snap to the seat's pose anchor.
  const handleSit = (seatId: string) => {
    const seated = resolveSeatedRender(seatId);
    if (!seated) return;
    setSittingIn(seatId);
    blobbiRef.current?.snapTo(seated.position);
  };

  useEffect(() => {
    setShowDebugOverlays(true);
  }, [setShowDebugOverlays]);

  // Mirror PlayingView: leaving a room abandons any seat or hiding spot.
  useEffect(() => {
    setSittingIn(null);
    setHiddenIn(null);
  }, [currentLocation]);

  // Dev-only escape hatches: let automation drive `snapTo` and the seated
  // pose even where rAF is throttled (occluded windows).
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__devBlobbi = blobbiRef;
    w.__devSit = handleSit;
    w.__devStand = () => setSittingIn(null);
  });

  const background = getBackgroundForLocation(currentLocation);
  const boundary = locationBoundaries[background] || {
    shape: 'rectangle' as const,
    x: [0, 100] as [number, number],
    y: [60, 100] as [number, number],
  };
  const spawn = getBlobbiInitialPosition(currentLocation);
  const exits = Object.entries(EXIT_POSITIONS).filter(([key]) =>
    key.startsWith(`${currentLocation}:`),
  );

  return (
    <div className="fixed inset-0 flex flex-col bg-neutral-900">
      <div className="z-[1000] flex items-center gap-3 bg-black/80 px-3 py-1.5 text-xs text-white" data-block-move>
        <strong>/dev/rooms</strong>
        <select
          className="rounded bg-neutral-700 px-1 py-0.5"
          value={currentLocation}
          onChange={(e) => setCurrentLocation(e.target.value as LocationId)}
          data-block-move
        >
          {Object.keys(LOCATION_BACKGROUNDS).map((loc) => (
            <option key={loc} value={loc}>{loc}</option>
          ))}
        </select>
        <span>size: {getBlobbiSizeForLocation(currentLocation)}</span>
        <span>bg: {background}</span>
        {/* rAF-free snap buttons (snapTo) so geometry can be verified even in
            occluded automation windows where rAF is throttled. */}
        {([['back', 0.02], ['mid', 0.5], ['front', 0.98]] as const).map(([label, t]) => (
          <button
            key={label}
            type="button"
            className="rounded bg-neutral-700 px-1.5 py-0.5 hover:bg-neutral-600"
            data-block-move
            onClick={() => {
              const { minY, maxY } = boundaryYRange(boundary);
              const target = constrainPosition(
                { x: 50, y: minY + (maxY - minY) * t },
                boundary,
              );
              blobbiRef.current?.snapTo(target);
              setLastPos(target);
            }}
          >
            snap {label}
          </button>
        ))}
        {lastPos && <span>last stop: ({lastPos.x.toFixed(1)}, {lastPos.y.toFixed(1)})</span>}
        <span className="opacity-60">red cross = stored ground point · click = walk feet there</span>
      </div>
      <div className="min-h-0 flex-1">
        <PlaceBackground ref={containerRef}>
          <BoundaryVisualizer boundary={boundary} />
          <RoomErrorBoundary key={`ie-${currentLocation}`}>
            <InteractiveElements
              blobbiRef={blobbiRef}
              selectedBlobbi={null}
              sittingIn={sittingIn}
              occupiedSeats={new Set()}
              onSitInSeat={handleSit}
              sessionParticipants={1}
              onActivityChange={() => {}}
              hiddenIn={hiddenIn}
              onHideInSpot={setHiddenIn}
            />
          </RoomErrorBoundary>
          <Marker pos={spawn} color="#22c55e" label={`spawn (${spawn.x}, ${spawn.y})`} />
          {lastApproach && (
            <Marker
              pos={lastApproach}
              color="#f97316"
              label={`approach (${lastApproach.x.toFixed(1)}, ${lastApproach.y.toFixed(1)})`}
            />
          )}
          {/* Theater: approach (floor) + pose (cushion) markers per seat. */}
          {background === THEATER_BACKGROUND_FILE &&
            occupiableTheaterSeats
              .filter((seat) => ['theater-seat-a1', 'theater-seat-a4', 'theater-seat-b4', 'theater-seat-c2', 'theater-seat-c11'].includes(seat.id))
              .flatMap((seat) => [
                <Marker key={`${seat.id}-approach`} pos={seatApproachPosition(seat)} color="#f97316" label={`approach ${seat.id.slice(-2)}`} />,
                <Marker key={`${seat.id}-cushion`} pos={seatCushionPoint(seat)} color="#38bdf8" label={`cushion ${seat.id.slice(-2)}`} />,
                <Marker key={`${seat.id}-pose`} pos={seatAnchorPosition(seat)} color="#a855f7" label={`pose ${seat.id.slice(-2)}`} />,
              ])}
          {exits.map(([key, pos]) => (
            <Marker key={key} pos={pos} color="#eab308" label={key.split(':')[1]} />
          ))}
          <MovableBlobbi
            key={currentLocation}
            ref={blobbiRef}
            containerRef={containerRef}
            boundary={boundary}
            initialPosition={spawn}
            backgroundFile={background}
            size={getBlobbiSizeForLocation(currentLocation)}
            scaleByYPosition={true}
            visualOverride={DEV_VISUAL}
            pose={sittingIn ? { kind: 'seated', seatId: sittingIn } : hiddenIn ? { kind: 'hidden', spotId: hiddenIn } : { kind: 'standing' }}
            onMoveStart={() => {
              setSittingIn(null);
              setHiddenIn(null);
            }}
            onMoveComplete={setLastPos}
          />
        </PlaceBackground>
      </div>
    </div>
  );
}

export function DevRooms() {
  return (
    <LocationProvider>
      <DebugOverlaysProvider>
        <PhotoBoothProvider>
          <MovementBlockerProvider>
            <RoomView />
          </MovementBlockerProvider>
        </PhotoBoothProvider>
      </DebugOverlaysProvider>
    </LocationProvider>
  );
}
