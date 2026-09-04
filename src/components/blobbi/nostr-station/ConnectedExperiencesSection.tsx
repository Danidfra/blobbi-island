/**
 * The Nostr Hub's Connected Experiences section: the independent Nostr apps
 * that work with Blobbi Island, and the way to one of them. Today that is
 * Nostr Farm alone.
 *
 * This is a SECTION of the Station's one interface (`NostrHubModal`), not a
 * window of its own: the hub owns the frame, the navigation, the close and
 * escape lifecycle; this file owns only what the section says and does.
 *
 * ## What "launch" is
 *
 * A launch is an egress request, nothing more. The section names its intent
 * (`external-link`, the resolved destination, a label for the dialog) and
 * awaits the answer; the external-egress boundary decides whether the
 * experience permits leaving at all, validates the destination, asks the
 * player, and opens the tab with opener isolation. This file never touches
 * `window.open`, never renders an `<iframe>`, and never imports anything from
 * the Farm: the Island tab, its session and its live inventory subscription
 * stay open while the player plays elsewhere, and whatever they harvest comes
 * back as Nostr events through the inventory pipeline.
 *
 * ## Why the capability is read here as well
 *
 * `requestEgress` collapses "the player cancelled" and "this experience does
 * not allow external links" into one `false`, by design. A launch button that
 * silently did nothing under the Family profile would read as broken, so the
 * section consumes the `externalLinks` capability (never a profile) to say so
 * in player words and leave the button disabled. The egress boundary remains
 * the real gate; this is presentation of its answer, not a second decision.
 */
import { useCallback, useState } from 'react';
import { ExternalLink, Sprout } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useExternalEgress } from '@/external-egress';
import { useIslandSafetyPolicy } from '@/safety';
import {
  CONNECTED_EXPERIENCES,
  hasSeenLaunchHint,
  markLaunchHintSeen,
  resolveConnectedExperienceUrl,
  type ConnectedExperience,
} from '@/connected-experiences';

/** Shown once per device after the first successful launch of an experience. */
export const FIRST_LAUNCH_NOTE =
  'Harvest food in Farm, then come back here. Your produce will appear in your inventory automatically.';

/** Shown when the experience does not permit leaving Blobbi Island. */
export const LAUNCH_UNAVAILABLE_NOTE = 'Opening other apps is turned off in this experience.';

/** Shown when a permitted launch could not be carried out. */
export const LAUNCH_FAILED_NOTE = 'Nostr Farm could not be opened just now. Please try again in a moment.';

export function ConnectedExperiencesSection() {
  return (
    <div data-testid="connected-experiences" className="w-full max-w-2xl space-y-4 text-left">
      {CONNECTED_EXPERIENCES.map((experience) => (
        <ConnectedExperienceCard key={experience.id} experience={experience} />
      ))}
      {/* Honest about the future without pretending it is here: one quiet,
          non-interactive line rather than a grid of empty cards. */}
      <p
        className="text-center text-xs uppercase tracking-wider text-cyan-300/60"
        data-testid="connected-experiences-more"
      >
        More experiences coming later
      </p>
    </div>
  );
}

function ConnectedExperienceCard({ experience }: { experience: ConnectedExperience }) {
  const { requestEgress } = useExternalEgress();
  const policy = useIslandSafetyPolicy();
  const canLeave = policy.externalLinks;
  const [launching, setLaunching] = useState(false);
  const [note, setNote] = useState<'first-launch' | 'failed' | null>(null);

  const launch = useCallback(async () => {
    if (!canLeave || launching) return;
    setLaunching(true);
    setNote(null);
    try {
      const went = await requestEgress({
        class: 'external-link',
        url: resolveConnectedExperienceUrl(experience),
        label: experience.name,
      });
      if (went && !hasSeenLaunchHint(experience.id)) {
        markLaunchHintSeen(experience.id);
        setNote('first-launch');
      }
      // `false` is the player cancelling, which needs no comment.
    } catch {
      // Egress does not throw for a refusal; an exception here is the browser
      // itself failing, and the player needs to know that nothing opened.
      setNote('failed');
    } finally {
      setLaunching(false);
    }
  }, [canLeave, launching, requestEgress, experience]);

  return (
    <article
      className={cn(
        'relative overflow-hidden rounded-lg p-4 sm:p-5',
        'border border-cyan-400/40 bg-gray-900/40 backdrop-blur-sm',
        'shadow-[0_0_18px_rgba(34,211,238,0.18),inset_0_0_24px_rgba(168,85,247,0.08)]',
      )}
      data-testid={`connected-experience-${experience.id}`}
      aria-labelledby={`connected-experience-${experience.id}-name`}
      // The hub's card header toggles the section; nothing in here should.
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-start gap-4">
        {/* Artwork slot: the experience's own image when one exists, otherwise a
            neon mark in the Station's palette. */}
        <div
          aria-hidden
          className="flex size-14 shrink-0 items-center justify-center rounded-lg border border-cyan-400/50 bg-purple-500/15 text-cyan-300"
          style={{ boxShadow: '0 0 14px rgba(34,211,238,0.35)' }}
        >
          {experience.image ? (
            <img src={experience.image} alt="" className="size-10 object-contain" draggable={false} />
          ) : (
            <Sprout className="size-7" />
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h4
              id={`connected-experience-${experience.id}-name`}
              className="text-lg font-bold tracking-wide text-cyan-100"
            >
              {experience.name}
            </h4>
            <span
              className="rounded-full border border-cyan-400/50 bg-cyan-400/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-cyan-300"
              data-testid="connected-experience-badge"
            >
              Works with Blobbi Island
            </span>
          </div>
          <p className="text-sm font-medium text-purple-100">{experience.tagline}</p>
          <p className="text-sm text-purple-200/80">{experience.description}</p>
          <p className="text-sm text-purple-200/80" data-testid="connected-experience-interop">
            {experience.interoperability}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-cyan-300/70">Opens in a new tab. Blobbi Island stays open here.</p>
        <Button
          variant="outline"
          onClick={() => void launch()}
          disabled={!canLeave || launching}
          aria-disabled={!canLeave || undefined}
          data-testid={`launch-${experience.id}`}
          className={cn(
            'border-cyan-400/60 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/20 hover:text-white cursor-blobbi-neon',
            'shadow-[0_0_12px_rgba(34,211,238,0.3)] hover:shadow-[0_0_18px_rgba(34,211,238,0.5)]',
          )}
        >
          <ExternalLink />
          Open {experience.name}
        </Button>
      </div>

      {!canLeave && (
        <p className="mt-3 text-xs text-purple-200/80" role="status" data-testid="launch-unavailable">
          {LAUNCH_UNAVAILABLE_NOTE}
        </p>
      )}
      {note === 'first-launch' && (
        <p
          className="mt-3 rounded-lg border border-cyan-400/40 bg-cyan-400/10 px-3 py-2 text-sm text-cyan-100"
          role="status"
          data-testid="first-launch-note"
        >
          {FIRST_LAUNCH_NOTE}
        </p>
      )}
      {note === 'failed' && (
        <p className="mt-3 text-sm text-purple-100" role="alert" data-testid="launch-failed">
          {LAUNCH_FAILED_NOTE}
        </p>
      )}
    </article>
  );
}
