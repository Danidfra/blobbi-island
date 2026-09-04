/**
 * The advanced panel: an event exactly as it exists (or would exist) on a
 * relay, plus what the package made of it.
 *
 * Shared by the Item Studio, the Published Items browser and the Inventory
 * Inspector, because "show me the actual event" is the same question in all
 * three and answering it three ways would let them drift.
 *
 * Two deliberate choices:
 *  - it renders COLLAPSED by default. A raw event is a diagnostic, not the UI;
 *    an always-expanded 4 kB JSON blob would push the actual work off screen
 *    and re-serialize on every render for something nobody is reading.
 *  - recognized and unrecognized tags are visually distinguished. That is the
 *    whole reason to look at raw tags in this tool: an unmanaged tag is one the
 *    editor will preserve untouched, and seeing which ones those are is how you
 *    trust that promise.
 */

import { useMemo, useState } from 'react';
import { Check, ChevronDown, Copy } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { ParseWarning } from '@/inventory/package';

import { isManagedTag } from '@/tools/game-items/form-event-conversion';

/** Copy-to-clipboard that reports failure instead of pretending it worked. */
export function CopyButton({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn('gap-1.5', className)}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setState('copied');
        } catch {
          setState('failed');
        }
        setTimeout(() => setState('idle'), 1800);
      }}
    >
      {state === 'copied' ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}
    </Button>
  );
}

export interface RawEventInspectorProps {
  event: NostrEvent | null;
  /** Shown above the JSON; e.g. the parsed model or a summary. */
  parsedModel?: unknown;
  warnings?: readonly ParseWarning[];
  /** Relays this event was seen on / accepted by, when known. */
  relays?: readonly string[];
  title?: string;
  /** Start expanded. Off by default; see the module note. */
  defaultOpen?: boolean;
  className?: string;
}

export function RawEventInspector({
  event,
  parsedModel,
  warnings = [],
  relays = [],
  title = 'Raw event',
  defaultOpen = false,
  className,
}: RawEventInspectorProps) {
  const [open, setOpen] = useState(defaultOpen);

  // Serializing only while open is the point of the memo: a collapsed panel
  // costs nothing on a form that re-renders per keystroke.
  const eventJson = useMemo(
    () => (open && event ? JSON.stringify(event, null, 2) : ''),
    [open, event],
  );
  const modelJson = useMemo(
    () =>
      open && parsedModel !== undefined ? JSON.stringify(parsedModel, null, 2) : '',
    [open, parsedModel],
  );

  if (!event) {
    return (
      <div className={cn('rounded-xl border border-dashed p-4 text-sm text-muted-foreground', className)}>
        No event to inspect yet.
      </div>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn('rounded-xl border bg-card', className)}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            {title}
            <Badge variant="secondary" className="font-mono text-[10px]">
              kind {event.kind}
            </Badge>
            {event.id ? (
              <span className="font-mono text-xs text-muted-foreground">
                {event.id.slice(0, 12)}…
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">unsigned</span>
            )}
          </span>
          <ChevronDown
            className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')}
          />
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-4 border-t px-4 py-4">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
          <Field label="id" value={event.id || '(assigned at signing)'} mono />
          <Field label="pubkey" value={event.pubkey || '(the signer)'} mono />
          <Field
            label="created_at"
            value={
              event.created_at
                ? `${event.created_at} · ${new Date(event.created_at * 1000).toLocaleString()}`
                : '(stamped at signing)'
            }
            mono
          />
          <Field label="sig" value={event.sig || '(not signed)'} mono />
          {relays.length > 0 && <Field label="relays" value={relays.join(', ')} />}
        </dl>

        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Tags ({event.tags.length})
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="w-10 py-1 pr-2 font-medium">#</th>
                  <th className="py-1 pr-2 font-medium">tag</th>
                  <th className="w-28 py-1 font-medium">handling</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {event.tags.map((tag, index) => {
                  const managed = isManagedTag(tag);
                  return (
                    <tr key={`${index}-${tag.join('|')}`} className="border-t">
                      <td className="py-1 pr-2 text-muted-foreground">{index}</td>
                      <td className="py-1 pr-2 break-all">{JSON.stringify(tag)}</td>
                      <td className="py-1">
                        <Badge
                          variant={managed ? 'secondary' : 'outline'}
                          className="text-[10px] font-sans"
                        >
                          {managed ? 'form field' : 'preserved'}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {warnings.length > 0 && (
          <section className="space-y-1">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Parser warnings ({warnings.length})
            </h4>
            <ul className="space-y-1 text-xs text-amber-700 dark:text-amber-400">
              {warnings.map((warning, index) => (
                <li key={`${warning.code}-${index}`}>
                  <span className="font-mono">{warning.code}</span>: {warning.message}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              JSON
            </h4>
            <div className="flex gap-2">
              <CopyButton value={eventJson} label="Copy event" />
              {event.id && <CopyButton value={event.id} label="Copy id" />}
            </div>
          </div>
          <pre className="max-h-80 overflow-auto rounded-lg bg-muted p-3 text-[11px] leading-relaxed">
            {eventJson}
          </pre>
        </section>

        {modelJson && (
          <section className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Parsed model
            </h4>
            <pre className="max-h-64 overflow-auto rounded-lg bg-muted p-3 text-[11px] leading-relaxed">
              {modelJson}
            </pre>
          </section>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('break-all', mono && 'font-mono')}>{value}</dd>
    </div>
  );
}
