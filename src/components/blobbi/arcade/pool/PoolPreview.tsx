import { cn } from '@/lib/utils';
import { POOL_AI_PROFILES, POOL_DIFFICULTIES, type PoolDifficulty } from '@/arcade/pool/ai';

import { PoolSoundToggle } from './PoolSoundToggle';

/**
 * What the player sees before pressing Start.
 *
 * Four jobs, in order of importance:
 *
 *  1. **Teach the gesture in one picture.** The whole control is "pull the cue
 *     back and let go", and a diagram of exactly that teaches it faster than any
 *     paragraph — which matters, because it is the one thing a player cannot
 *     discover by pressing buttons.
 *  2. **Say the rules, in six lines.** Not the real rule book. Pool's reputation
 *     for being complicated is entirely about the rules nobody explains, and the
 *     simplified set (documented in full in `rules.ts`) fits on this card.
 *  3. **Let the player pick a rival.**
 *  4. **Be honest about tickets.** Pool grants none. Saying so is better than an
 *     absence a player has to notice.
 *
 * Difficulty is chosen here and nowhere else: it is part of the run REQUEST, it
 * is echoed into the result, and changing it mid-frame would make the result
 * describe a match that did not happen.
 */

interface PoolPreviewProps {
  readonly difficulty: PoolDifficulty;
  readonly onSelectDifficulty: (difficulty: PoolDifficulty) => void;
  /** Set when a previous run in this shell ended without a result. */
  readonly abortNotice?: string | null;
  readonly muted: boolean;
  readonly onToggleMute: () => void;
}

export function PoolPreview({
  difficulty,
  onSelectDifficulty,
  abortNotice,
  muted,
  onToggleMute,
}: PoolPreviewProps) {
  return (
    <div data-pool-preview className="mx-auto flex max-w-md flex-col gap-3 pb-2">
      {abortNotice && (
        <p
          role="status"
          data-pool-abort-notice
          className="rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-800"
        >
          {abortNotice}
        </p>
      )}

      {/* Marquee, in the same treatment as the table's frame, so the start
          screen and the playfield read as one machine. */}
      <div className="relative overflow-hidden rounded-2xl border-2 border-island-wood/40 bg-gradient-to-b from-island-cream-2 to-island-sand px-4 py-3 text-center shadow-[0_4px_0_rgba(140,98,57,0.35)]">
        <PoolSoundToggle
          muted={muted}
          onToggle={onToggleMute}
          className="absolute right-2 top-2 h-9 w-9 border-island-wood/40 bg-island-cream text-island-ink hover:bg-island-cream-2"
        />

        <CueDiagram />

        <h3 className="mt-1 text-xl font-black uppercase tracking-[0.16em] text-island-wood-dark sm:text-2xl">
          Pool
        </h3>
        <p className="mt-1 text-sm font-semibold text-island-ink">
          Pull the cue back and let go. Sink your seven, then the 8-ball.
        </p>
        <p className="mt-1 text-xs blobbi-text-muted">
          One frame against a rival &middot; about three to five minutes
        </p>
      </div>

      {/* Difficulty. A radio group, because these are alternatives rather than
          switches — and because that is what a keyboard user expects to arrow
          between. */}
      <fieldset className="rounded-2xl border-2 border-island-wood/25 bg-island-cream/60 p-3">
        <legend className="px-1 text-xs font-bold uppercase tracking-widest text-island-ink-soft">
          Rival
        </legend>
        <div data-pool-difficulty className="mt-1 grid gap-2 sm:grid-cols-2">
          {POOL_DIFFICULTIES.map((id) => {
            const profile = POOL_AI_PROFILES[id];
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
                    name="pool-difficulty"
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
        <ul data-pool-controls className="space-y-1.5 text-sm text-island-ink">
          <li className="flex items-start gap-2">
            <span aria-hidden className="text-base leading-tight">
              👆
            </span>
            <span>
              <strong>Touch or mouse.</strong> Press and drag <em>away</em> from the cue ball. The
              further you pull, the harder you hit. Let go to shoot.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden className="text-base leading-tight">
              🎯
            </span>
            <span>
              <strong>A short tap just aims.</strong> Nothing fires until you pull properly, so you
              can line the shot up first.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden className="text-base leading-tight">
              ⌨️
            </span>
            <span>
              <strong>Keyboard.</strong> Left and right swing the cue, up and down set the power,
              space shoots.
            </span>
          </li>
        </ul>
      </div>

      <div className="rounded-2xl border-2 border-island-wood/25 bg-island-cream/60 p-3">
        <h4 className="mb-2 text-center text-xs font-bold uppercase tracking-widest text-island-ink-soft">
          The rules, all of them
        </h4>
        <ol data-pool-rules className="space-y-1 text-sm text-island-ink">
          <li>You break. Nobody owns a colour yet.</li>
          <li>
            The first ball potted after the break decides it &mdash; <strong>solids</strong> or{' '}
            <strong>stripes</strong>. Your balls get a ring round them.
          </li>
          <li>Pot one of yours and you shoot again.</li>
          <li>Miss, or pot the wrong colour, and it&rsquo;s your rival&rsquo;s turn.</li>
          <li>
            Pot the cue ball, hit nothing, or hit the wrong ball first &mdash; that&rsquo;s a foul,
            and your rival gets to place the cue ball wherever they like.
          </li>
          <li>
            Clear your seven, then pot the <strong>8-ball</strong> to win. Pot it early and you
            lose.
          </li>
        </ol>
        <p className="mt-2 text-xs blobbi-text-muted">
          The 8-ball on the break is the one exception: it goes straight back on the table and play
          carries on.
        </p>
      </div>

      <div className="space-y-2 rounded-2xl border-2 border-island-wood/25 p-3 text-xs blobbi-text-muted">
        <p data-pool-ticket-notice>
          <strong className="text-island-ink">
            <span aria-hidden>🎟️ </span>Arcade Tickets.
          </strong>{' '}
          Pool does not pay out tickets yet. Play it for the frame.
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
 * The gesture, drawn once in SVG.
 *
 * Static and decorative, so it is markup rather than a canvas: it never
 * animates, it costs nothing, and it scales with the card. It shows the one
 * thing a player cannot guess — that you drag AWAY from the ball and the shot
 * goes the other way.
 */
function CueDiagram() {
  return (
    <svg
      viewBox="0 0 100 44"
      role="img"
      aria-label="A cue ball with a cue drawn back behind it. Dragging away from the ball aims the shot in the opposite direction."
      className="mx-auto h-20 w-auto sm:h-24"
    >
      <rect x="1" y="1" width="98" height="42" rx="4" fill="#257953" stroke="#8C6239" strokeWidth="2" />
      <circle cx="8" cy="8" r="3.4" fill="#120D08" />
      <circle cx="92" cy="8" r="3.4" fill="#120D08" />
      <circle cx="8" cy="36" r="3.4" fill="#120D08" />
      <circle cx="92" cy="36" r="3.4" fill="#120D08" />
      <circle cx="50" cy="4" r="3" fill="#120D08" />
      <circle cx="50" cy="40" r="3" fill="#120D08" />

      {/* The cue, drawn back to the left. */}
      <line x1="8" y1="22" x2="30" y2="22" stroke="#8A6534" strokeWidth="2.4" strokeLinecap="round" />
      <line x1="30" y1="22" x2="33" y2="22" stroke="#4B7FBF" strokeWidth="2.4" strokeLinecap="round" />

      {/* The drag, going backwards. */}
      <path d="M 30 30 L 20 30" stroke="#FFD666" strokeWidth="1.4" strokeLinecap="round" strokeDasharray="3 2" />
      <path d="M 21.5 28 L 19 30 L 21.5 32" fill="none" stroke="#FFD666" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />

      {/* The cue ball, the aim line, and the ball it is aimed at. */}
      <circle cx="38" cy="22" r="4" fill="#F6F2E8" stroke="#D6CBB4" strokeWidth="0.8" />
      <line x1="43" y1="22" x2="62" y2="22" stroke="rgba(255,255,255,0.7)" strokeWidth="0.9" strokeDasharray="2.5 2.5" />
      <circle cx="70" cy="22" r="4" fill="#F2C230" stroke="rgba(0,0,0,0.3)" strokeWidth="0.6" />
      <circle cx="70" cy="22" r="2" fill="#FBF8F1" />
    </svg>
  );
}
