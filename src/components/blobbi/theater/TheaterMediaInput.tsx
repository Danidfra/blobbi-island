import { useCallback, useState } from 'react';
import { cn } from '@/lib/utils';
import { YOUTUBE_PARSE_MESSAGES, parseYouTubeInput } from '@/lib/youtube-url';

interface TheaterMediaInputProps {
  /** Called with a validated video id and any `?t=` start offset. */
  onLoad: (videoId: string, startSeconds?: number) => void;
  /** Blocks a second submission while one is already in flight. */
  disabled?: boolean;
  onCancel?: () => void;
  autoFocus?: boolean;
}

/**
 * The way to put something on the screen.
 *
 * A real `<form>` with a real submit button, so Enter and the button take the
 * same path and `preventDefault` is stated once. (It used to be two loose
 * handlers on a `<div>`; nothing navigated, but nothing guaranteed it wouldn't
 * either, and the two paths could drift.)
 *
 * The theater has an OPEN catalog: a normal watch URL, a `youtu.be` link, an
 * embed/shorts URL, or the bare 11-character id all work, and the id is
 * extracted here. Anything else is rejected with a specific sentence *before* a
 * player is constructed — a malformed input should never become a mysterious
 * embed failure.
 *
 * Failures that CANNOT be detected here — private, deleted, embedding disabled,
 * region blocked — are only knowable by attempting the embed, and are reported
 * by the control card once the player answers.
 */
export function TheaterMediaInput({ onLoad, disabled = false, onCancel, autoFocus }: TheaterMediaInputProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    (event: React.FormEvent) => {
      // The form must never navigate: this is a world overlay, not a page.
      event.preventDefault();
      event.stopPropagation();
      if (disabled) return;

      const result = parseYouTubeInput(value);
      if (!result.ok) {
        setError(YOUTUBE_PARSE_MESSAGES[result.reason]);
        return;
      }
      setError(null);
      setValue('');
      onLoad(result.videoId, result.startSeconds);
    },
    [value, onLoad, disabled],
  );

  return (
    <form
      className="flex w-full flex-col gap-1.5"
      data-theater-media-input
      data-block-move
      onSubmit={submit}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <label htmlFor="theater-media-url" className="px-1 text-[11px] text-white/60">
        Paste a YouTube URL or video ID
      </label>
      <div className="flex items-center gap-2">
        <input
          id="theater-media-url"
          type="text"
          inputMode="url"
          autoFocus={autoFocus}
          value={value}
          disabled={disabled}
          spellCheck={false}
          placeholder="https://www.youtube.com/watch?v=..."
          aria-label="YouTube URL or video ID"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'theater-media-url-error' : undefined}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          // The world listens for keystrokes; the theater's input must not feed it.
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel?.();
            e.stopPropagation();
          }}
          className={cn(
            'min-w-0 flex-1 rounded-full bg-black/50 px-4 py-1.5 text-sm text-white/90 outline-none',
            'border placeholder:text-white/35 backdrop-blur-sm transition-colors disabled:opacity-50',
            error ? 'border-red-400/70' : 'border-white/20 focus:border-white/50',
          )}
        />
        <button
          type="submit"
          disabled={disabled}
          className="shrink-0 rounded-full bg-white/90 px-4 py-1.5 text-sm font-medium text-black transition-colors hover:bg-white disabled:opacity-50"
        >
          Load Video
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="shrink-0 rounded-full border border-white/20 px-3 py-1.5 text-sm text-white/70 transition-colors hover:text-white"
          >
            Cancel
          </button>
        )}
      </div>
      {error && (
        <p id="theater-media-url-error" role="alert" className="px-1 text-xs text-red-300">
          {error}
        </p>
      )}
    </form>
  );
}
