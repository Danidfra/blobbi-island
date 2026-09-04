import { cn } from '@/lib/utils';
import {
  HOCKEY_AI_PROFILES,
  HOCKEY_DIFFICULTIES,
  type HockeyDifficulty,
} from '@/arcade/hockey/ai';
import { MATCH_GOAL_TARGET } from '@/arcade/hockey/table';

import { HockeySoundToggle } from './HockeySoundToggle';

/**
 * What the player sees before pressing Start.
 *
 * Three jobs, in order of importance:
 *
 *  1. **Say what to do, in a picture.** Air hockey explains itself in one
 *     diagram: a table with your end at the bottom, far better than in a
 *     paragraph. The controls are shown per input device, before the countdown
 *     rather than during it.
 *  2. **Say when it ends.** "First to seven" is the whole rule, and knowing it
 *     up front is what makes 5–6 exciting rather than confusing.
 *  3. **Be honest about tickets.** Air Hockey pays them now: finishing earns
 *     some, winning earns more, and leaving earns nothing. Saying so is
 *     better than an absence a player has to notice.
 *
 * Difficulty is chosen here and nowhere else: it is part of the run REQUEST,
 * it is echoed into the result, and changing it mid-match would make the result
 * describe a match that did not happen.
 */

interface AirHockeyPreviewProps {
  readonly difficulty: HockeyDifficulty;
  readonly onSelectDifficulty: (difficulty: HockeyDifficulty) => void;
  /** Set when a previous run in this shell ended without a result. */
  readonly abortNotice?: string | null;
  readonly muted: boolean;
  readonly onToggleMute: () => void;
}

export function AirHockeyPreview({
  difficulty,
  onSelectDifficulty,
  abortNotice,
  muted,
  onToggleMute,
}: AirHockeyPreviewProps) {
  return (
    <div data-hockey-preview className="mx-auto flex max-w-md flex-col gap-3 pb-2">
      {abortNotice && (
        <p
          role="status"
          data-hockey-abort-notice
          className="rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-800"
        >
          {abortNotice}
        </p>
      )}

      {/* Marquee, in the same treatment as the table's frame, so the start
          screen and the playfield read as one machine. */}
      <div className="relative overflow-hidden rounded-2xl border-2 border-island-wood/40 bg-gradient-to-b from-island-cream-2 to-island-sand px-4 py-3 text-center shadow-[0_4px_0_rgba(140,98,57,0.35)]">
        <HockeySoundToggle
          muted={muted}
          onToggle={onToggleMute}
          className="absolute right-2 top-2 h-9 w-9 border-island-wood/40 bg-island-cream text-island-ink hover:bg-island-cream-2"
        />

        <TableDiagram />

        <h3 className="mt-1 text-xl font-black uppercase tracking-[0.16em] text-island-wood-dark sm:text-2xl">
          Air Hockey
        </h3>
        <p className="mt-1 text-sm font-semibold text-island-ink">
          Slide the puck into your rival&rsquo;s goal. Keep it out of yours.
        </p>
        <p className="mt-1 text-xs blobbi-text-muted">
          First to {MATCH_GOAL_TARGET} goals wins &middot; about two to four minutes
        </p>
      </div>

      {/* Difficulty. A radio group, because these are alternatives rather than
          switches: and because that is what a keyboard user expects to arrow
          between. */}
      <fieldset className="rounded-2xl border-2 border-island-wood/25 bg-island-cream/60 p-3">
        <legend className="px-1 text-xs font-bold uppercase tracking-widest text-island-ink-soft">
          Opponent
        </legend>
        <div data-hockey-difficulty className="mt-1 grid gap-2 sm:grid-cols-2">
          {HOCKEY_DIFFICULTIES.map((id) => {
            const profile = HOCKEY_AI_PROFILES[id];
            const selected = id === difficulty;
            return (
              <label
                key={id}
                className={cn(
                  'flex cursor-pointer flex-col gap-0.5 rounded-xl border-2 px-3 py-2 text-left',
                  'focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-island-purple',
                  selected
                    ? 'border-island-purple bg-island-purple/10'
                    : 'border-island-wood/25 bg-island-cream-2/60 hover:border-island-wood/45',
                )}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="air-hockey-difficulty"
                    value={id}
                    checked={selected}
                    onChange={() => onSelectDifficulty(id)}
                    className="h-4 w-4 accent-island-purple"
                  />
                  <span className="text-sm font-bold text-island-ink">{profile.label}</span>
                </span>
                <span className="pl-6 text-xs blobbi-text-muted">{profile.blurb}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="rounded-2xl border-2 border-island-wood/25 bg-island-cream/60 p-3">
        <h4 className="mb-2 text-center text-xs font-bold uppercase tracking-widest text-island-ink-soft">
          Controls
        </h4>
        <ul data-hockey-controls className="space-y-1.5 text-sm text-island-ink">
          <li className="flex items-start gap-2">
            <span aria-hidden className="text-base leading-tight">
              🖱️
            </span>
            <span>
              <strong>Mouse.</strong> Move the pointer over the table &mdash; your mallet follows
              it. No clicking needed.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden className="text-base leading-tight">
              👆
            </span>
            <span>
              <strong>Touch.</strong> Press and drag inside the table. The page will not scroll
              while you play.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden className="text-base leading-tight">
              ⌨️
            </span>
            <span>
              <strong>Keyboard.</strong> Arrow keys or WASD once the table has focus.
            </span>
          </li>
        </ul>
        <p className="mt-2 text-center text-xs blobbi-text-muted">
          You can only reach your own half &mdash; and so can your rival. Hit the puck hard by
          moving into it fast.
        </p>
      </div>

      <div className="space-y-2 rounded-2xl border-2 border-island-wood/25 p-3 text-xs blobbi-text-muted">
        <p data-hockey-ticket-notice>
          <strong className="text-island-ink">
            <span aria-hidden>🎟️ </span>Arcade Tickets.
          </strong>{' '}
          Finishing a match earns tickets and winning earns more. Leaving mid-match earns
          nothing.
        </p>
        <p>
          <strong className="text-island-ink">Sound.</strong> Press Start to let the browser play
          audio &mdash; it will not start on its own. Every sound here is feedback, so the game
          plays exactly the same with it off.
        </p>
      </div>
    </div>
  );
}

/**
 * The table, drawn once in SVG.
 *
 * Static and decorative, so it is markup rather than a canvas: it never
 * animates, it costs nothing, and it scales with the card. The player's end is
 * at the bottom in the same colour it is in the game, which is the one thing
 * this diagram exists to teach.
 */
function TableDiagram() {
  return (
    <svg
      viewBox="0 0 80 50"
      role="img"
      aria-label="An air hockey table seen from above. Your goal and mallet are on the left; your rival's are on the right."
      className="mx-auto h-20 w-auto sm:h-24"
    >
      <rect x="1" y="1" width="78" height="48" rx="4" fill="#1e1636" stroke="#0d0a1c" strokeWidth="2" />
      <line x1="40" y1="1" x2="40" y2="49" stroke="rgba(255,255,255,0.28)" strokeWidth="0.8" />
      <circle cx="40" cy="25" r="7" fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="0.8" />
      {/* The two goal mouths, in the colours they have in the game. */}
      <line x1="2" y1="14" x2="2" y2="36" stroke="#9C7BF0" strokeWidth="2.6" strokeLinecap="round" />
      <line x1="78" y1="14" x2="78" y2="36" stroke="#F0A35C" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="14" cy="25" r="4" fill="#9C7BF0" stroke="#6B4FC4" strokeWidth="1" />
      <circle cx="66" cy="25" r="4" fill="#F0A35C" stroke="#B96F2C" strokeWidth="1" />
      <circle cx="40" cy="25" r="2.4" fill="#FDFBFF" stroke="#C9B6FF" strokeWidth="0.7" />
    </svg>
  );
}
