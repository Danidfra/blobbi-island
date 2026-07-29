import { useId } from 'react';

import { cn, islandCtaButtonClass } from '@/lib/utils';
import {
  canLaunchArcadeGame,
  catalogueDurationLabel,
  sharedCabinetCatalogue,
  ARCADE_CATALOGUE,
  type ArcadeCatalogueEntry,
} from '@/arcade/catalogue';

import { ArcadeGameShell } from './ArcadeGameShell';

/**
 * The shared catalogue — what a GENERIC arcade cabinet offers.
 *
 * ## Six cabinets, not nine machines
 *
 * The pink, black, classic, green, purple and red cabinets are interchangeable
 * furniture: their screens can show anything, so they show a list. The dance
 * machine, the pool table and the air hockey table are not, and none of them
 * ever opens this screen. That distinction lives in the machine registry's
 * `activation` field and in `sharedCabinetCatalogue()`; this component simply
 * renders whatever the latter returns.
 *
 * ## It is built for being empty
 *
 * Today it returns nothing, because every game the arcade has belongs to a
 * dedicated machine. That is the honest state of the product, and the screen is
 * designed around it rather than apologising for it: a friendly panel with the
 * cabinet the player is standing at, one sentence saying games are on the way,
 * and two short notes about what will eventually appear. No empty grids, no
 * placeholder cards, no "0 results".
 *
 * The first version of this screen filled the space by listing Blobbi Dance —
 * a game that lives on a machine two floors down and cannot be played here. A
 * catalogue that lies to look busy is worse than one that is honestly quiet.
 *
 * ## What it may say
 *
 * Everything on a card is a fact from the registry, and the ticket wording is
 * deliberately conditional: "Play well to earn tickets", never "Earn Arcade
 * Tickets" and never an amount. No ids, no publisher keys, no kinds, no package
 * formats, no sandbox talk, no reward formulas. A player is nine years old and
 * looking for something to play.
 */

interface ArcadeCatalogueProps {
  /** Which cabinet the player walked up to. Context, never a filter. */
  readonly machineName: string;
  /** The cabinet's own artwork, used as the panel's illustration. */
  readonly machineImage?: string;
  /**
   * Overridable for the DEV harness and tests. Defaults to the games generic
   * cabinets offer — which is a SUBSET of the registry, not all of it.
   */
  readonly entries?: readonly ArcadeCatalogueEntry[];
  /** Called with a game id when a playable card is chosen. */
  readonly onSelect: (gameId: string) => void;
  /** Set when a launch was refused, e.g. an unknown or unavailable game. */
  readonly launchError?: string | null;
}

export function ArcadeCatalogue({
  machineName,
  machineImage,
  entries = ARCADE_CATALOGUE,
  onSelect,
  launchError = null,
}: ArcadeCatalogueProps) {
  const headingId = useId();
  const games = sharedCabinetCatalogue(entries);

  return (
    <div
      data-arcade-catalogue
      data-catalogue-games={games.length}
      /*
        `my-auto` inside the shell's flex column centres a short catalogue
        vertically. Deliberately not `justify-center` on the parent: when the
        content is taller than the box, `justify-center` clips the TOP out of a
        scroll container, whereas an auto margin simply collapses to zero.
      */
      className="mx-auto my-auto flex w-full max-w-lg flex-col gap-4 py-1"
    >
      {launchError && (
        <p
          role="alert"
          data-catalogue-error
          className="rounded-2xl bg-rose-500/10 px-3 py-2 text-center text-sm text-rose-800"
        >
          {launchError}
        </p>
      )}

      {/*
        The marquee. The cabinet the player is actually standing at is the
        illustration — it costs no new artwork, it is different at every cabinet,
        and it makes the screen feel like it belongs to the thing they walked up
        to rather than to a menu system.
      */}
      <section
        aria-labelledby={headingId}
        data-catalogue-section="games"
        className="rounded-3xl border-2 border-island-wood/30 bg-gradient-to-b from-island-cream-2 to-island-sand px-5 py-6 text-center shadow-[0_4px_0_rgba(140,98,57,0.3)]"
      >
        {machineImage && (
          <img
            src={machineImage}
            alt=""
            aria-hidden
            draggable={false}
            className="mx-auto mb-3 h-24 w-auto select-none object-contain sm:h-28"
          />
        )}
        <h3
          id={headingId}
          className="text-xl font-black uppercase tracking-[0.14em] text-island-wood-dark sm:text-2xl"
        >
          Arcade Games
        </h3>

        {games.length === 0 ? (
          <>
            <p className="mx-auto mt-2 max-w-sm text-sm font-semibold text-island-ink sm:text-base">
              New games are being prepared for these cabinets.
            </p>
            <p className="mt-1 text-xs blobbi-text-muted">
              Come back another day — the {machineName} will be ready for you.
            </p>
          </>
        ) : (
          <>
            <p className="mx-auto mt-2 max-w-sm text-sm font-semibold text-island-ink sm:text-base">
              Pick a game to play on the {machineName}.
            </p>
            <ul className="mt-4 grid grid-cols-1 gap-3 text-left sm:grid-cols-2">
              {games.map((entry) => (
                <ArcadeCatalogueCard key={entry.id} entry={entry} onSelect={onSelect} />
              ))}
            </ul>
          </>
        )}
      </section>

      {/*
        Two short notes, not two sections.

        These were headings over empty grids, which turned a child's game menu
        into an administrative form with nothing in it. The categories are still
        real and still mean different things — one can pay tickets and one never
        will — so they are still said, in a sentence each.
      */}
      <ul className="space-y-2 rounded-2xl border-2 border-island-wood/20 px-4 py-3 text-xs blobbi-text-muted sm:text-sm">
        <li data-catalogue-note="island">
          <strong className="text-island-ink">
            <span aria-hidden>🎟️ </span>Island Games
          </strong>{' '}
          are made here on Blobbi Island. Play well and you can earn Arcade Tickets.
        </li>
        <li data-catalogue-note="guest">
          <strong className="text-island-ink">
            <span aria-hidden>✨ </span>Guest Games
          </strong>{' '}
          are made by other people, just for fun. They never give Arcade Tickets, and official
          ones are coming soon.
        </li>
      </ul>
    </div>
  );
}

interface ArcadeCatalogueCardProps {
  readonly entry: ArcadeCatalogueEntry;
  readonly onSelect: (gameId: string) => void;
}

/**
 * One game on a generic cabinet.
 *
 * Nothing renders this today — no game is offered by the shared cabinets yet —
 * and it is here so the screen above has somewhere to grow without being
 * redesigned. It shows only what is useful: a title, what you do, whether
 * tickets are possible, and (when the game is playable) how it is controlled and
 * how long a go takes. A coming-soon entry gets no button at all, because a
 * disabled button is still announced as a button and still invites a click.
 */
export function ArcadeCatalogueCard({ entry, onSelect }: ArcadeCatalogueCardProps) {
  const titleId = useId();
  const playable = entry.availability === 'playable';
  const launchable = canLaunchArcadeGame({
    game: entry,
    machineId: null,
    surface: 'shared-catalogue',
  });
  const duration = catalogueDurationLabel(entry);
  const showTicketBadge = entry.category === 'island' && playable && entry.grantsTickets;

  return (
    <li
      data-catalogue-card={entry.id}
      data-catalogue-availability={entry.availability}
      data-catalogue-category={entry.category}
    >
      <article
        aria-labelledby={titleId}
        className={cn(
          'flex h-full flex-col gap-2 rounded-2xl border-2 p-3',
          playable
            ? 'border-island-wood/30 bg-island-cream/80'
            : 'border-island-wood/20 bg-island-cream/40',
        )}
      >
        <h4 id={titleId} className="text-base font-bold leading-tight text-island-ink">
          {entry.title}
        </h4>
        <p className="text-sm blobbi-text-muted">{entry.shortDescription}</p>

        <ul className="flex flex-wrap gap-1.5">
          {showTicketBadge ? (
            <li data-catalogue-tickets={entry.id} className={chipClass('tickets')}>
              <span aria-hidden>🎟️ </span>Play well to earn tickets
            </li>
          ) : entry.category === 'guest' ? (
            <li className={chipClass('default')}>Just for fun</li>
          ) : null}
          {!playable && (
            <li data-catalogue-coming-soon={entry.id} className={chipClass('muted')}>
              Coming soon
            </li>
          )}
        </ul>

        {/*
          Controls and duration are shown only for a game that can be played.
          Telling a child which keys to press for something they cannot start is
          metadata for its own sake.
        */}
        {playable && (entry.controls.length > 0 || duration) && (
          <p className="text-xs blobbi-text-muted">
            {[...entry.controls.map((c) => c.label), duration].filter(Boolean).join(' · ')}
          </p>
        )}

        <div className="mt-auto pt-1">
          {launchable ? (
            <button
              type="button"
              data-catalogue-launch={entry.id}
              onClick={() => onSelect(entry.id)}
              aria-label={`Play ${entry.title}`}
              className={cn(islandCtaButtonClass, 'min-h-[44px] w-full px-6 py-2 text-base')}
            >
              Play
            </button>
          ) : (
            <p className="text-xs font-semibold text-island-ink-soft">Not ready to play yet.</p>
          )}
        </div>
      </article>
    </li>
  );
}

/** One badge's classes. A function, so a badge carrying a test hook stays a plain `<li>`. */
function chipClass(tone: 'default' | 'tickets' | 'muted'): string {
  return cn(
    'rounded-full px-2 py-0.5 text-[11px] font-bold',
    tone === 'tickets'
      ? 'bg-island-purple/10 text-island-purple'
      : tone === 'muted'
        ? 'bg-island-wood/10 text-island-ink-soft'
        : 'bg-island-wood/10 text-island-ink',
  );
}

interface ArcadeCatalogueShellProps extends ArcadeCatalogueProps {
  readonly open: boolean;
  /** The cabinet's stable id, carried for analytics and future behaviour. */
  readonly machineId: string;
  /** Dismiss the catalogue and return to the arcade room. */
  readonly onClose: () => void;
}

/**
 * The catalogue inside the shared arcade dialog.
 *
 * One component so the room and the DEV harness open the SAME thing — a harness
 * that reassembles the dialog itself proves nothing about the dialog the player
 * gets.
 *
 * It passes no `status`: browsing a catalogue is not a run, and the shell's
 * pause/resume controls are absent for exactly that reason.
 */
export function ArcadeCatalogueShell({
  open,
  machineId,
  machineName,
  machineImage,
  entries,
  onSelect,
  onClose,
  launchError,
}: ArcadeCatalogueShellProps) {
  const games = sharedCabinetCatalogue(entries ?? ARCADE_CATALOGUE);
  return (
    <ArcadeGameShell
      open={open}
      onClose={onClose}
      title={machineName}
      description={games.length > 0 ? 'Choose a game' : 'Games are on their way'}
      machineId={machineId}
      surface="catalogue"
      closeLabel="Close"
      closeAriaLabel="Close and go back to the arcade"
      contentClassName="flex flex-col"
    >
      <ArcadeCatalogue
        machineName={machineName}
        machineImage={machineImage}
        entries={entries}
        onSelect={onSelect}
        launchError={launchError}
      />
    </ArcadeGameShell>
  );
}
