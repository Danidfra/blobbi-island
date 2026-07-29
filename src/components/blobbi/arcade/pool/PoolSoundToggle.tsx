import { cn } from '@/lib/utils';

/**
 * Pool's sound control.
 *
 * A third small toggle rather than a shared one lifted out of the other two, for
 * the reason `HockeySoundToggle` already states: the three are visually similar
 * and semantically different, and the part that genuinely must be common — the
 * persisted `blobbi:arcade:audio-muted` flag — already is. A generic
 * `ArcadeSoundToggle` parameterised by surface colour, for three callers, is the
 * speculative abstraction the brief asks not to build.
 *
 * The accessibility pattern IS copied, because it is the correct one: a toggle
 * button has one fixed name ("Mute the sound") and carries its state in
 * `aria-pressed`, so a screen reader announces "Mute the sound, toggle button,
 * pressed" rather than a name that contradicts its own state.
 */

interface PoolSoundToggleProps {
  readonly muted: boolean;
  readonly onToggle: () => void;
  readonly className?: string;
}

export function PoolSoundToggle({ muted, onToggle, className }: PoolSoundToggleProps) {
  return (
    <button
      type="button"
      data-pool-sound={muted ? 'muted' : 'on'}
      aria-pressed={muted}
      aria-label="Mute the sound"
      // The table is a pointer surface: a press here must move the sound
      // setting, never the cue.
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onToggle}
      className={cn(
        'flex h-10 w-10 items-center justify-center rounded-full border-2 text-base',
        'border-white/25 bg-black/40 text-white backdrop-blur-[2px]',
        'hover:bg-black/55 active:scale-95',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
        className,
      )}
    >
      <span aria-hidden>{muted ? '🔇' : '🔊'}</span>
    </button>
  );
}
