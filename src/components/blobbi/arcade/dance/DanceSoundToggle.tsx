import { cn } from '@/lib/utils';

/**
 * The one sound control Blobbi Dance has.
 *
 * ## Why mute and not volume
 *
 * The arcade audio boundary persists exactly one sound setting — a global
 * `blobbi:arcade:audio-muted` flag — and the dance engine already reads it when
 * it builds a context and honours `setMuted` while one is running. A volume
 * slider would need a new persisted setting, a new engine parameter and a new
 * migration; a mute toggle needs none of those, because the machinery is already
 * there and was simply never given a control.
 *
 * ## Why muting is safe for the clock
 *
 * The engine mutes by taking the master gain to zero. The `AudioContext` keeps
 * running, `currentTime` keeps advancing, and the schedule is untouched — so a
 * muted run is judged by exactly the same clock as a loud one. Muting is a
 * volume decision, never a timing one.
 *
 * ## Why the name never changes
 *
 * A toggle button has ONE name and a separate pressed state. Naming it for the
 * action instead — "Mute the music" when unmuted, "Turn the music on" when muted
 * — reads correctly on screen but contradicts itself out loud: a screen reader
 * announces "Turn the music on, toggle button, **pressed**", which says the
 * opposite of what it means.
 *
 * So the name is fixed ("Mute the music", the control's function) and
 * `aria-pressed` carries the state: pressed means muted. That is the standard
 * toggle pattern, and it means the state is available from the name-plus-state
 * announcement rather than from the icon alone.
 */

interface DanceSoundToggleProps {
  readonly muted: boolean;
  readonly onToggle: () => void;
  readonly className?: string;
}

export function DanceSoundToggle({ muted, onToggle, className }: DanceSoundToggleProps) {
  return (
    <button
      type="button"
      data-dance-sound={muted ? 'muted' : 'on'}
      aria-pressed={muted}
      aria-label="Mute the music"
      onClick={onToggle}
      className={cn(
        'flex h-10 w-10 items-center justify-center rounded-full border-2 text-base',
        'border-island-wood/40 bg-island-cream text-island-ink',
        'hover:bg-island-cream-2 active:scale-95',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
        className,
      )}
    >
      <span aria-hidden>{muted ? '🔇' : '🔊'}</span>
    </button>
  );
}
