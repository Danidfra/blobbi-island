/**
 * The four validation layers, kept visually distinct because they mean
 * different things.
 *
 * Errors are red and stop the publish button. Warnings are amber and do not.
 * Suggestions are muted and are opinions. Collapsing these into one list — the
 * usual temptation — would train the user to ignore all of them equally, and
 * the one that matters is the one that says "this event cannot be built".
 *
 * The counts are always visible even when a group is empty, so "no image
 * warnings" reads as a checked condition rather than as a missing section.
 */

import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { StudioIssue, StudioValidation } from '@/tools/game-items/validation';

const GROUPS = [
  {
    key: 'blocking',
    title: 'Blocking errors',
    blurb: 'These prevent the event from being built or accepted as a definition.',
    icon: XCircle,
    tone: 'text-destructive',
    box: 'border-destructive/40 bg-destructive/5',
  },
  {
    key: 'protocol',
    title: 'Protocol warnings',
    blurb: 'What the parser ignored or coerced. The item still publishes.',
    icon: AlertTriangle,
    tone: 'text-amber-600 dark:text-amber-400',
    box: 'border-amber-300/60 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20',
  },
  {
    key: 'image',
    title: 'Image warnings',
    blurb: 'Artwork concerns. None of them are protocol rules.',
    icon: AlertTriangle,
    tone: 'text-amber-600 dark:text-amber-400',
    box: 'border-amber-300/60 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20',
  },
  {
    key: 'authoring',
    title: 'Suggestions',
    blurb: 'Blobbi house style. Purely advisory.',
    icon: Info,
    tone: 'text-muted-foreground',
    box: 'border-border bg-muted/30',
  },
] as const;

export interface EventValidationPanelProps {
  validation: StudioValidation;
  className?: string;
}

export function EventValidationPanel({ validation, className }: EventValidationPanelProps) {
  const total =
    validation.blocking.length +
    validation.protocol.length +
    validation.image.length +
    validation.authoring.length;

  return (
    <section className={cn('space-y-3', className)}>
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-tight">Validation</h3>
        {total === 0 ? (
          <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
            Nothing to report
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">{total} item(s)</span>
        )}
      </header>

      {GROUPS.map((group) => {
        const issues = validation[group.key] as StudioIssue[];
        const Icon = group.icon;
        return (
          <div key={group.key} className={cn('rounded-xl border p-3', group.box)}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', group.tone)} aria-hidden />
                <div>
                  <p className="text-xs font-semibold">{group.title}</p>
                  <p className="text-[11px] text-muted-foreground">{group.blurb}</p>
                </div>
              </div>
              <Badge variant={issues.length === 0 ? 'outline' : 'secondary'} className="text-[10px]">
                {issues.length}
              </Badge>
            </div>

            {issues.length > 0 && (
              <ul className="mt-2 space-y-1.5 pl-6">
                {issues.map((issue) => (
                  // `break-words` is load-bearing, not decoration. Several
                  // messages quote the offending value back at the user, and an
                  // image warning quotes a URL — a 130-character token with no
                  // break opportunity. Without it that token set the width of
                  // this list, then of the panel, then of the page: at 375px the
                  // whole document scrolled sideways by ~320px.
                  <li key={issue.id} className="text-xs break-words">
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {issue.code}
                    </span>{' '}
                    {issue.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}
