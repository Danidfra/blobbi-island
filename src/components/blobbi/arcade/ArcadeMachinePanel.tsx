/**
 * The honest panel for a machine that cannot be played yet.
 *
 * Two callers, and the important one is the first:
 *
 *  - **A dedicated machine whose game is not built**: the pool table and the air
 *    hockey table. Each shows ITS OWN game: pool talks about pool. A corrective
 *    pass briefly sent both of them to the shared cabinet catalogue, which
 *    offered a rhythm game on a pool table and said nothing about pool at all.
 *  - **The prize counter**, which is not a game and does not pretend to be one.
 *
 * The copy is data, a registry entry's `shortDescription`, or
 * `arcade-room-config.ts` for the counter; never a string in this component.
 * That is the rule that stops a hard-coded "Get ready to dance!" from appearing
 * over a pool table, which is exactly how this started.
 */

interface ArcadeMachinePanelProps {
  /** What the player is looking at: "Pool", "Air Hockey", "Prize Counter". */
  displayName: string;
  /** One honest sentence about THIS thing. */
  blurb: string;
  /** Short state chip above the name. Says what is true, never a promise. */
  badge?: string;
  /** Decorative artwork: the machine's own sprite. Never the only signal. */
  image?: string;
}

export function ArcadeMachinePanel({
  displayName,
  blurb,
  badge = 'Coming soon',
  image,
}: ArcadeMachinePanelProps) {
  return (
    <div
      data-arcade-panel="coming-soon"
      className="flex h-full flex-col items-center justify-center gap-4 px-2 text-center"
    >
      {image && (
        <img
          src={image}
          alt=""
          aria-hidden
          draggable={false}
          className="h-24 w-auto select-none object-contain sm:h-32"
        />
      )}

      {/*
        `role="status"` so the state is ANNOUNCED when the shell opens rather
        than only being visible. A player using a screen reader must learn that
        something is not ready at the same moment a sighted player does.
      */}
      <div role="status" className="max-w-md space-y-2">
        <p className="inline-block rounded-full bg-island-purple/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-island-purple">
          {badge}
        </p>
        <h3 className="text-xl font-bold text-island-ink sm:text-2xl">{displayName}</h3>
        <p className="blobbi-text-muted text-sm sm:text-base">{blurb}</p>
      </div>
    </div>
  );
}
