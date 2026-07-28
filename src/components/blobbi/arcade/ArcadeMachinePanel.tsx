import { ARCADE_CONTROL_HINTS } from '@/arcade/arcade-input-map';
import type { ArcadeMachineAvailability } from '@/lib/arcade-machines-config';

/**
 * What the shell shows for a machine that has no playable game yet.
 *
 * Two honest states, and no third one that hints at a fourth:
 *
 *  - **`preview`** — a real game is designed and coming. The dance machine shows
 *    what it will be and how it will be controlled, so the promise is specific
 *    rather than a vague "soon".
 *  - **`coming-soon`** — no game exists for this machine. It says so plainly.
 *    There is no Start button, because there is nothing to start.
 *
 * The copy comes from the machine registry, not from here: `blurb` is data, so a
 * machine's promise lives next to its identity instead of inside a component's
 * JSX (which is exactly how one hard-coded "Get ready to dance!" ended up being
 * shown for a pool table).
 */

interface ArcadeMachinePanelProps {
  displayName: string;
  availability: ArcadeMachineAvailability;
  blurb: string;
  /** Whether to show the control mapping. Only meaningful for a real game. */
  showControls?: boolean;
}

export function ArcadeMachinePanel({
  displayName,
  availability,
  blurb,
  showControls = false,
}: ArcadeMachinePanelProps) {
  // A playable machine never reaches this panel — it has its own controller —
  // but the badge is exhaustive so a mis-wiring says something true rather than
  // announcing a live game as "coming soon".
  const badge =
    availability === 'playable'
      ? 'Ready to play'
      : availability === 'preview'
        ? 'Coming next'
        : 'Coming soon';

  return (
    <div
      data-arcade-panel={availability}
      className="flex h-full flex-col items-center justify-center gap-5 text-center"
    >
      {/*
        `role="status"` so the state is ANNOUNCED when the shell opens rather
        than only being visible. A player using a screen reader must learn that
        a machine is not playable at the same moment a sighted player does.
      */}
      <div role="status" className="space-y-2 max-w-md">
        <p className="inline-block rounded-full bg-island-purple/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-island-purple">
          {badge}
        </p>
        <h3 className="text-xl sm:text-2xl font-bold text-island-ink">{displayName}</h3>
        <p className="blobbi-text-muted text-sm sm:text-base">{blurb}</p>
      </div>

      {showControls && (
        <div className="w-full max-w-md rounded-xl border border-island-wood/25 p-4 text-left">
          <h4 className="mb-2 text-sm font-bold text-island-ink">Controls, when it arrives</h4>
          <dl className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {ARCADE_CONTROL_HINTS.map((hint) => (
              <div key={hint.lane} className="flex items-baseline justify-between gap-3">
                <dt className="text-sm capitalize blobbi-text">{hint.lane}</dt>
                <dd className="text-xs blobbi-text-muted text-right">
                  <span className="font-mono">{hint.desktop}</span>
                  <span className="mx-1 opacity-50">·</span>
                  <span>{hint.mobile}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
