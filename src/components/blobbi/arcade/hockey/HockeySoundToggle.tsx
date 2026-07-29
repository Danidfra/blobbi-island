import { cn } from '@/lib/utils';

/**
 * Air Hockey's sound control.
 *
 * Deliberately a second component rather than a shared one lifted out of
 * `DanceSoundToggle`. The two are visually similar and semantically different:
 * the dance toggle sits on a cream marquee and mutes MUSIC that the game keeps
 * time from; this one sits on a dark table and mutes IMPACT SOUNDS that nothing
 * depends on. They share the persisted `blobbi:arcade:audio-muted` flag — which
 * is the part that genuinely must be common, and already is — and nothing else.
 *
 * Extracting a generic `ArcadeSoundToggle` would mean a component parameterised
 * by surface colour and by what the word "sound" refers to, for two callers.
 * That is the speculative abstraction the brief asks not to build.
 *
 * The accessibility pattern IS copied, because it is the correct one: a toggle
 * button has one fixed name ("Mute the sound") and carries its state in
 * `aria-pressed`, so a screen reader announces "Mute the sound, toggle button,
 * pressed" rather than a name that contradicts its own state.
 */

interface HockeySoundToggleProps {
  readonly muted: boolean;
  readonly onToggle: () => void;
  readonly className?: string;
}

export function HockeySoundToggle({ muted, onToggle, className }: HockeySoundToggleProps) {
  return (
    <button
      type="button"
      data-hockey-sound={muted ? 'muted' : 'on'}
      aria-pressed={muted}
      aria-label="Mute the sound"
      // The table is a pointer surface: a click here must move the sound
      // setting, never the mallet.
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
