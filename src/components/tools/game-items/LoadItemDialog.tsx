/**
 * Loading a published definition into the editor.
 *
 * Two ways in, because there are two situations. You either have a full
 * `31632:<pubkey>:<d>` address (from a browser row, a colleague, an inventory
 * entry), or you know the `d` of something you published yourself and would
 * rather not paste your own pubkey. The second form builds the address from the
 * active signer — it can never resolve to somebody else's event, which is
 * precisely why `d`-only lookup is safe to offer here and unsafe as a general
 * identity.
 *
 * Loading REPLACES the editor contents, so an unsaved draft with real work in
 * it triggers a confirmation first. The confirmation is not a formality: the
 * draft autosaves under the same slot the loaded item will occupy.
 */

import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { buildGameItemAddress } from '@/inventory/package';
import type { PublishedDefinitionRecord } from '@/tools/game-items/useItemDefinitions';

export interface LoadItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The active signer, for `d`-only lookup. Null when signed out. */
  signerPubkey: string | null;
  isLoading: boolean;
  /** Resolves the address, or throws with a reason. */
  onLoad: (address: string) => Promise<PublishedDefinitionRecord>;
  /** Called once the record is fetched and the user has confirmed any overwrite. */
  onLoaded: (record: PublishedDefinitionRecord) => void;
  /** True when the editor currently holds work worth warning about. */
  hasUnsavedWork: boolean;
}

export function LoadItemDialog({
  open,
  onOpenChange,
  signerPubkey,
  isLoading,
  onLoad,
  onLoaded,
  hasUnsavedWork,
}: LoadItemDialogProps) {
  const [address, setAddress] = useState('');
  const [dTag, setDTag] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendingRecord, setPendingRecord] = useState<PublishedDefinitionRecord | null>(
    null,
  );

  const resolve = async (value: string) => {
    setError(null);
    try {
      const record = await onLoad(value);
      if (hasUnsavedWork) {
        setPendingRecord(record);
        return;
      }
      onLoaded(record);
      onOpenChange(false);
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const dAddress = (() => {
    if (!signerPubkey || dTag.trim() === '') return null;
    try {
      return buildGameItemAddress(signerPubkey, dTag.trim());
    } catch {
      return null;
    }
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Load a published item</DialogTitle>
          <DialogDescription>
            Replaces the editor contents with a definition from the relays.
          </DialogDescription>
        </DialogHeader>

        {pendingRecord ? (
          <div className="space-y-3">
            <Alert>
              <AlertDescription className="text-xs">
                The editor holds unsaved work. Loading{' '}
                <span className="font-mono">{pendingRecord.definition.name}</span>{' '}
                replaces it. The current draft stays in your draft list until you
                clear it.
              </AlertDescription>
            </Alert>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setPendingRecord(null)}>
                Keep editing
              </Button>
              <Button
                onClick={() => {
                  onLoaded(pendingRecord);
                  setPendingRecord(null);
                  onOpenChange(false);
                }}
              >
                Replace editor
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="load-address" className="text-xs">
                Full address
              </Label>
              <div className="flex gap-2">
                <Input
                  id="load-address"
                  value={address}
                  placeholder="31632:<pubkey>:<d>"
                  className="h-9 font-mono text-xs"
                  onChange={(event) => setAddress(event.target.value)}
                />
                <Button
                  type="button"
                  size="sm"
                  className="h-9 shrink-0 gap-1.5"
                  disabled={isLoading || address.trim() === ''}
                  onClick={() => resolve(address)}
                >
                  {isLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  Load
                </Button>
              </div>
            </div>

            <div className="space-y-1.5 border-t pt-4">
              <Label htmlFor="load-d" className="text-xs">
                …or a <code>d</code> tag you published
              </Label>
              <div className="flex gap-2">
                <Input
                  id="load-d"
                  value={dTag}
                  placeholder="blobbi:accessory:party-hat"
                  className="h-9 font-mono text-xs"
                  disabled={!signerPubkey}
                  onChange={(event) => setDTag(event.target.value)}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-9 shrink-0"
                  disabled={isLoading || !dAddress}
                  onClick={() => dAddress && resolve(dAddress)}
                >
                  Load
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {signerPubkey
                  ? 'Resolved against your own key, so it can only find your own items.'
                  : 'Sign in to look items up by d alone.'}
              </p>
              {dAddress && (
                <p className="break-all font-mono text-[10px] text-muted-foreground">
                  {dAddress}
                </p>
              )}
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription className="text-xs">{error}</AlertDescription>
              </Alert>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
