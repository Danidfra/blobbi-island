/**
 * "Is this cosmetic wearable yet?" — shown on a published item's card.
 *
 * DIAGNOSTIC ONLY. Every control here copies text to the clipboard. Nothing on
 * this panel publishes an event, mutates an inventory, or edits the mapping:
 * activation is a source-code change a human reviews and commits, and a browser
 * that could perform it would defeat the purpose of having an explicit trust
 * mapping at all.
 *
 * The panel renders for cosmetics only. A consumable has no activation story —
 * it is used, never worn — so showing it an empty checklist would be noise.
 */

import { CheckCircle2, Circle, AlertTriangle } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  type ActivationFinding,
  type ActivationStatus,
  type ActivationSubject,
  registrySnippet,
} from '@/tools/game-items/activation-status';

import { CopyButton } from './RawEventInspector';

const ICONS: Record<ActivationFinding['level'], typeof CheckCircle2> = {
  ok: CheckCircle2,
  todo: Circle,
  warn: AlertTriangle,
};

const TONES: Record<ActivationFinding['level'], string> = {
  ok: 'text-emerald-600 dark:text-emerald-400',
  todo: 'text-muted-foreground',
  warn: 'text-amber-600 dark:text-amber-400',
};

export interface ActivationStatusPanelProps {
  subject: ActivationSubject;
  status: ActivationStatus;
  className?: string;
}

export function ActivationStatusPanel({
  subject,
  status,
  className,
}: ActivationStatusPanelProps) {
  if (!status.applicable) return null;

  const snippet = registrySnippet(subject);

  return (
    <section
      className={cn('rounded-xl border bg-muted/30 p-3 sm:p-4', className)}
      aria-label="Accessory activation status"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-medium">Accessory activation</h4>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[11px] font-medium',
            status.wearable
              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
              : 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
          )}
        >
          {status.wearable ? 'Wearable' : 'Not wearable'}
        </span>
      </div>

      <ul className="mt-3 space-y-1.5">
        {status.findings.map((finding, i) => {
          const Icon = ICONS[finding.level];
          return (
            <li key={i} className="flex items-start gap-2 text-xs">
              <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', TONES[finding.level])} />
              <span className="min-w-0">
                <span className="font-medium">{finding.label}</span>
                {finding.detail ? (
                  // `break-words` because a detail may carry a full address, and
                  // an unbreakable 70-character token is what pushes this whole
                  // card wider than a phone.
                  <span className="ml-1 break-words text-muted-foreground">
                    — {finding.detail}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex flex-wrap gap-2">
        <CopyButton value={subject.address} label="Copy full address" />
        {status.declaredSlot ? (
          <CopyButton value={status.declaredSlot} label="Copy declared slot" />
        ) : null}
        {snippet && !status.wearable ? (
          <CopyButton value={snippet} label="Copy registry snippet" />
        ) : null}
      </div>

      {!status.wearable ? (
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Paste the snippet into{' '}
          <code className="break-all">OFFICIAL_COSMETIC_DEFINITIONS</code> in{' '}
          <code className="break-all">src/protocol/event-registry.ts</code>, then
          review and commit it. This tool never edits source.
        </p>
      ) : null}
    </section>
  );
}
