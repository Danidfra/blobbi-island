import { useEffect, useState } from 'react';
import {
  Captions,
  Maximize,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Slider } from '@/components/ui/slider';
import { PREFERRED_RATES, SKIP_STEP_SECONDS, type TheaterPlaybackController, type TheaterPlaybackSnapshot } from '@/lib/theater-playback';

/**
 * Who is operating this screen.
 *
 * Local playback always makes you the host of your own screen. The guest view
 * exists now, unused, because the control-surface split is a protocol decision,
 * not a UI detail: global controls must be ABSENT from a guest's UI (not merely
 * disabled) so ownership is legible at a glance. Building it later would mean
 * rewriting the control bar; building it now means the shared-playback work only
 * has to choose a role.
 */
export type TheaterRole = 'host' | 'guest';

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

const buttonClass =
  'flex items-center justify-center rounded-full text-white/80 transition-colors hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent';

interface ControlsProps {
  controller: TheaterPlaybackController;
  snapshot: TheaterPlaybackSnapshot;
}

/**
 * Timeline scrubber.
 *
 * Commits on drag END, never per pointer move. Locally that is only politeness;
 * once seeks are published it is the difference between one event and fifty, and
 * it is the reason the shared layer will not need to bolt on a debounce.
 */
function Timeline({ controller, snapshot }: ControlsProps) {
  const [dragValue, setDragValue] = useState<number | null>(null);
  const duration = snapshot.duration;
  const value = dragValue ?? snapshot.currentTime;

  // Unknown duration (metadata still loading) means there is nothing to scrub.
  const disabled = !Number.isFinite(duration) || duration <= 0;

  return (
    <div className="flex flex-1 items-center gap-2 text-[10px] tabular-nums text-white/70">
      <span className="w-9 shrink-0 text-right">{formatTime(value)}</span>
      <Slider
        aria-label="Timeline"
        className="flex-1"
        min={0}
        max={disabled ? 1 : duration}
        step={0.1}
        disabled={disabled}
        value={[Math.min(value, disabled ? 1 : duration)]}
        onValueChange={([next]) => setDragValue(next)}
        onValueCommit={([next]) => {
          setDragValue(null);
          controller.seek(next, 'direct');
        }}
      />
      <span className="w-9 shrink-0">{formatTime(duration)}</span>
    </div>
  );
}

interface LocalControlsProps extends ControlsProps {
  /**
   * Fullscreen can be refused by the browser (no user activation, an iframe
   * without `allowfullscreen`, iOS). Saying so is the whole point — a button
   * that silently does nothing is worse than no button.
   */
  onFullscreenDenied: () => void;
}

/** Volume, mute, captions and fullscreen: per-device, never synchronized. */
function LocalControls({ controller, snapshot, onFullscreenDenied }: LocalControlsProps) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        className={cn(buttonClass, 'h-7 w-7')}
        aria-label={snapshot.muted ? 'Unmute' : 'Mute'}
        onClick={() => controller.setMuted(!snapshot.muted)}
      >
        {snapshot.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </button>
      <Slider
        aria-label="Volume"
        className="hidden w-16 sm:flex"
        min={0}
        max={100}
        step={1}
        value={[snapshot.muted ? 0 : snapshot.volume]}
        onValueChange={([next]) => controller.setVolume(next)}
      />
      <button
        type="button"
        className={cn(buttonClass, 'h-7 w-7', snapshot.captionsEnabled && 'text-white bg-white/15')}
        aria-label={snapshot.captionsEnabled ? 'Hide captions' : 'Show captions'}
        aria-pressed={snapshot.captionsEnabled}
        onClick={() => controller.setCaptionsEnabled(!snapshot.captionsEnabled)}
      >
        <Captions className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={cn(buttonClass, 'h-7 w-7')}
        aria-label="Fullscreen"
        title="Fullscreen"
        onClick={async () => {
          const granted = await controller.requestFullscreen();
          if (!granted) onFullscreenDenied();
        }}
      >
        <Maximize className="h-4 w-4" />
      </button>
    </div>
  );
}

/** `-10` / `+10` drawn as text, so they read the same at any world scale. */
function SkipButton({ delta, onClick, disabled }: { delta: number; onClick: () => void; disabled: boolean }) {
  const label = delta > 0 ? `Skip forward ${delta} seconds` : `Skip back ${-delta} seconds`;
  return (
    <button
      type="button"
      className={cn(buttonClass, 'h-7 min-w-[2.25rem] px-1 text-[11px] font-semibold')}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {delta > 0 ? `+${delta}` : delta}
    </button>
  );
}

function RateMenu({ controller, snapshot }: ControlsProps) {
  const rates = PREFERRED_RATES.filter(
    (rate) => snapshot.availableRates.length <= 1 || snapshot.availableRates.includes(rate),
  );
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        className={cn(buttonClass, 'h-7 min-w-[2.25rem] px-1 text-[11px] font-semibold tabular-nums')}
        aria-label="Playback speed"
        aria-expanded={open}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((v) => !v)}
      >
        {snapshot.rate}×
      </button>
      {open && (
        <div
          className="absolute bottom-full right-0 z-10 mb-1 flex flex-col overflow-hidden rounded-lg border border-white/15 bg-black/85 backdrop-blur-sm"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {rates.map((rate) => (
            <button
              key={rate}
              type="button"
              className={cn(
                'px-3 py-1 text-left text-[11px] tabular-nums text-white/75 hover:bg-white/10 hover:text-white',
                rate === snapshot.rate && 'bg-white/15 text-white',
              )}
              onClick={() => {
                controller.setRate(rate);
                setOpen(false);
              }}
            >
              {rate}×
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface HostControlsProps extends ControlsProps {
  onChangeVideo: () => void;
  onFullscreenDenied: () => void;
}

/**
 * Host controls — the full global surface.
 *
 * Every button here maps one-to-one onto a shared-playback action, in the same
 * order the protocol lists them: play/pause, timeline, ±10, restart, rate, change
 * media. None of them touches the YouTube API; they call the controller.
 */
export function HostControls({ controller, snapshot, onChangeVideo, onFullscreenDenied }: HostControlsProps) {
  const hasMedia = snapshot.media !== null;
  const isPlaying = snapshot.status === 'playing';

  return (
    <div className="flex w-full flex-col gap-1.5">
      <Timeline controller={controller} snapshot={snapshot} />
      <div className="flex items-center gap-1">
        <button
          type="button"
          className={cn(buttonClass, 'h-7 w-7')}
          aria-label="Restart"
          disabled={!hasMedia}
          onClick={() => controller.restart()}
        >
          <RotateCcw className="h-4 w-4" />
        </button>
        <SkipButton delta={-SKIP_STEP_SECONDS} disabled={!hasMedia} onClick={() => controller.skip(-SKIP_STEP_SECONDS)} />
        <button
          type="button"
          className={cn(buttonClass, 'h-9 w-9 bg-white/15')}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          disabled={!hasMedia}
          onClick={() => controller.togglePlay()}
        >
          {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
        </button>
        <SkipButton delta={SKIP_STEP_SECONDS} disabled={!hasMedia} onClick={() => controller.skip(SKIP_STEP_SECONDS)} />
        <RateMenu controller={controller} snapshot={snapshot} />

        <div className="ml-auto flex items-center gap-1">
          <LocalControls
            controller={controller}
            snapshot={snapshot}
            onFullscreenDenied={onFullscreenDenied}
          />
          <button
            type="button"
            className="rounded-full border border-white/20 px-2.5 py-1 text-[11px] text-white/70 transition-colors hover:border-white/40 hover:text-white"
            onClick={onChangeVideo}
          >
            Change video
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Guest controls — local only.
 *
 * Deliberately renders NO global control and no timeline handle: a guest cannot
 * play, pause, seek or change the video, and the UI says so by omission rather
 * than by greying things out.
 */
export function GuestControls({ controller, snapshot, onFullscreenDenied }: LocalControlsProps) {
  return (
    <div className="flex w-full items-center gap-2">
      <div className="flex flex-1 items-center gap-2 text-[10px] tabular-nums text-white/60">
        <span className="w-9 shrink-0 text-right">{formatTime(snapshot.currentTime)}</span>
        <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-white/15">
          <div
            className="absolute inset-y-0 left-0 bg-white/60"
            style={{
              width: snapshot.duration > 0 ? `${(snapshot.currentTime / snapshot.duration) * 100}%` : '0%',
            }}
          />
        </div>
        <span className="w-9 shrink-0">{formatTime(snapshot.duration)}</span>
      </div>
      <LocalControls
        controller={controller}
        snapshot={snapshot}
        onFullscreenDenied={onFullscreenDenied}
      />
      <span className="hidden shrink-0 text-[10px] text-white/40 sm:inline">Playback is controlled by the host</span>
    </div>
  );
}
