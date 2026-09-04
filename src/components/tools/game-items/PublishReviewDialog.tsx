/**
 * The publish gate. Two deliberate steps, and nothing happens between them.
 *
 *   REVIEW   who signs, what address, new or replacing, what warnings remain
 *   PUBLISH  one button, pressed by a human, that signs and fans out
 *   RESULT   the signed id and a per-relay verdict that stays on screen
 *
 * The step that matters is the first one. An addressable update does not edit
 * an event: it publishes a new one that supersedes the old one at the same
 * address: and the difference between "creates a new item" and "replaces the
 * item you already published" is one character in a `d` tag. This dialog says
 * which of the two is about to happen, in words, before anything is signed.
 *
 * ## The form is never cleared here
 *
 * Not on success, and especially not on partial failure. If two relays out of
 * three accepted the event, the honest state is "you have a published item and
 * a relay that did not take it", and throwing away the editor would leave the
 * user with nothing to retry from.
 */

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCcw,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { SignerIdentity } from '@/tools/game-items/signer-identity';
import type { StudioValidation } from '@/tools/game-items/validation';
import type { PublishItemDefinitionResult } from '@/tools/game-items/usePublishItemDefinition';

import { CopyButton } from './RawEventInspector';

export interface PublishReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  identity: SignerIdentity;
  address: string | null;
  itemName: string;
  /** True when this replaces the address the editor loaded. */
  updatesLoadedAddress: boolean;
  validation: StudioValidation;
  previewEvent: NostrEvent | null;
  relayUrls: readonly string[];
  isPublishing: boolean;
  /** Resolves with per-relay outcomes; rejects only when nothing was signed. */
  onPublish: () => Promise<PublishItemDefinitionResult>;
}

export function PublishReviewDialog({
  open,
  onOpenChange,
  identity,
  address,
  itemName,
  updatesLoadedAddress,
  validation,
  previewEvent,
  relayUrls,
  isPublishing,
  onPublish,
}: PublishReviewDialogProps) {
  const [result, setResult] = useState<PublishItemDefinitionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reopening the dialog must not show the previous publication's verdict.
  useEffect(() => {
    if (open) {
      setResult(null);
      setError(null);
    }
  }, [open]);

  const warningCount =
    validation.protocol.length + validation.image.length + validation.authoring.length;

  const handlePublish = async () => {
    setError(null);
    try {
      setResult(await onPublish());
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            {result ? 'Publication result' : 'Review publication'}
          </DialogTitle>
          <DialogDescription>
            {result
              ? 'The event has been signed. Here is what each relay said.'
              : 'Nothing is signed until you press the button at the bottom.'}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[55vh] pr-3">
          {result ? (
            <PublishOutcome result={result} />
          ) : (
            <div className="space-y-4">
              <dl className="space-y-2 rounded-xl border p-3 text-xs">
                <Row label="Item" value={itemName || '(unnamed)'} />
                <Row label="Signer" value={identity.npub ?? '(none)'} mono />
                <Row
                  label="Address"
                  value={address ?? '(cannot be resolved without a signer)'}
                  mono
                />
                <div className="flex items-start justify-between gap-3">
                  <dt className="shrink-0 text-muted-foreground">Effect</dt>
                  <dd className="text-right font-medium">
                    {updatesLoadedAddress ? (
                      <span className="text-amber-600 dark:text-amber-400">
                        Replaces the existing item at this address
                      </span>
                    ) : (
                      <span className="text-emerald-600 dark:text-emerald-400">
                        Creates a new item at this address
                      </span>
                    )}
                  </dd>
                </div>
                <Row label="Relays" value={relayUrls.join(', ')} />
              </dl>

              {identity.mode === 'third-party' && (
                <Alert className="border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40">
                  <ShieldAlert className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    You are publishing under your own key, not the official Blobbi
                    issuer. The event is valid and will be stored, but Blobbi
                    Island&rsquo;s catalog only trusts the official issuer, so this
                    item will not appear in the game. It is not an official item.
                  </AlertDescription>
                </Alert>
              )}

              {updatesLoadedAddress && (
                <Alert>
                  <RefreshCcw className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    Addressable events are superseded, not edited. The previous event
                    is not deleted; clients simply prefer the newest one for this
                    address.
                  </AlertDescription>
                </Alert>
              )}

              {warningCount > 0 && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    <p className="mb-1 font-medium">
                      {warningCount} warning(s): none of them block publishing.
                    </p>
                    <ul className="list-inside list-disc space-y-0.5">
                      {[...validation.protocol, ...validation.image, ...validation.authoring]
                        .slice(0, 6)
                        .map((issue) => (
                          <li key={issue.id}>{issue.message}</li>
                        ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {previewEvent && (
                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {previewEvent.tags.length} tags · {previewEvent.content.length} bytes of content
                  </p>
                </div>
              )}

              {error && (
                <Alert variant="destructive">
                  <XCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs">{error}</AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </ScrollArea>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {result ? 'Back to editor' : 'Cancel'}
          </Button>
          {!result && (
            <Button
              type="button"
              disabled={isPublishing || !validation.isPublishable || !address}
              onClick={handlePublish}
            >
              {isPublishing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Sign and publish
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PublishOutcome({ result }: { result: PublishItemDefinitionResult }) {
  return (
    <div className="space-y-4">
      <div
        className={cn(
          'flex items-start gap-2 rounded-xl border p-3',
          result.reachedAnyRelay
            ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30'
            : 'border-destructive/40 bg-destructive/5',
        )}
      >
        {result.reachedAnyRelay ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        )}
        <p className="text-xs">
          {result.reachedAnyRelay
            ? `Accepted by ${result.acceptedRelays.length} of ${result.outcomes.length} relay(s).`
            : 'The event was signed but no relay accepted it. It exists locally only; try again.'}
        </p>
      </div>

      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Event id
        </p>
        <p className="break-all font-mono text-xs">{result.event.id}</p>
      </div>

      {result.record && (
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Address
          </p>
          <p className="break-all font-mono text-xs">{result.record.address}</p>
        </div>
      )}

      <ul className="space-y-1.5">
        {result.outcomes.map((outcome) => (
          <li
            key={outcome.relay}
            className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs"
          >
            <span className="min-w-0 flex-1 truncate font-mono">{outcome.relay}</span>
            {outcome.ok ? (
              <Badge variant="secondary" className="text-[10px]">
                accepted
              </Badge>
            ) : (
              <Badge variant="destructive" className="max-w-40 truncate text-[10px]">
                {outcome.error ?? 'rejected'}
              </Badge>
            )}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-2">
        <CopyButton value={JSON.stringify(result.event, null, 2)} label="Copy event JSON" />
        <CopyButton value={result.event.id} label="Copy id" />
        {result.record && (
          <CopyButton value={result.record.address} label="Copy address" />
        )}
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className={cn('min-w-0 break-all text-right', mono && 'font-mono')}>{value}</dd>
    </div>
  );
}
