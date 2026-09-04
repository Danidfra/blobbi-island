/**
 * "Import event JSON": paste a whole kind:31632 event and get the form back.
 *
 * The parse is a PURE function (`importEventJson`), so this component holds no
 * conversion logic of its own: it collects text, shows what came back, and
 * hands the finished form up. Nothing here reaches a relay, a signer or a
 * publish mutation: importing is an editor action, and the only way to publish
 * remains the review dialog's explicit button.
 *
 * ## Two-step, like "Load published"
 *
 * Importing REPLACES the editor, which autosaves into the same draft slot. So
 * when the editor holds real work, the import is parsed and held while the user
 * confirms, rather than applied and apologised for. With an empty or untouched
 * editor it applies immediately, a confirmation nobody needs is just a click.
 *
 * ## What the summary is for
 *
 * The pasted JSON is somebody's authored artefact and may be subtly wrong: the
 * wrong `d`, no image, an unsigned draft mistaken for a published event. The
 * summary states what was actually understood, identity, image count,
 * preserved unknown tags, provenance: BEFORE anything replaces the editor,
 * because that is the moment the author can still say no.
 */

import { useState } from 'react';
import { ClipboardPaste, FileJson } from 'lucide-react';

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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  importEventJson,
  type ImportedEvent,
} from '@/tools/game-items/form-event-conversion';
import { PRIMARY_MARKER } from '@/tools/game-items/item-form-model';

export interface ImportEventDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Applies the imported form to the editor. */
  onImported: (imported: ImportedEvent) => void;
  /** True when the editor currently holds work worth warning about. */
  hasUnsavedWork: boolean;
}

export function ImportEventDialog({
  open,
  onOpenChange,
  onImported,
  hasUnsavedWork,
}: ImportEventDialogProps) {
  const [raw, setRaw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<ImportedEvent | null>(null);

  const reset = () => {
    setRaw('');
    setError(null);
    setPending(null);
  };

  const apply = (imported: ImportedEvent) => {
    onImported(imported);
    reset();
    onOpenChange(false);
  };

  const handleImport = () => {
    const result = importEventJson(raw);
    if (!result.ok) {
      setError(result.error);
      setPending(null);
      return;
    }
    setError(null);
    if (hasUnsavedWork) {
      setPending(result.value);
      return;
    }
    apply(result.value);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Import event JSON</DialogTitle>
          <DialogDescription>
            Paste a kind:31632 event or unsigned draft. Images can still be replaced
            after import.
          </DialogDescription>
        </DialogHeader>

        {pending ? (
          <ConfirmReplace
            imported={pending}
            onCancel={() => setPending(null)}
            onConfirm={() => apply(pending)}
          />
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="import-json" className="text-xs">
                Event JSON
              </Label>
              <Textarea
                id="import-json"
                value={raw}
                rows={14}
                spellCheck={false}
                className="font-mono text-xs"
                placeholder={'{\n  "kind": 31632,\n  "tags": [["d", "blobbi:effect:golden-sparkles"], …],\n  "content": "{\\"description\\":\\"…\\"}"\n}'}
                onChange={(event) => {
                  setRaw(event.target.value);
                  if (error) setError(null);
                }}
              />
              <p className="text-[11px] text-muted-foreground">
                <code>id</code>, <code>pubkey</code>, <code>created_at</code> and{' '}
                <code>sig</code> are optional: an unsigned draft imports fine. Any
                that are present are shown as provenance and are not attached: this
                becomes a local draft that publishes under your own key.
              </p>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription className="text-xs">{error}</AlertDescription>
              </Alert>
            )}

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                className="gap-1.5"
                disabled={raw.trim() === ''}
                onClick={handleImport}
              >
                <ClipboardPaste className="h-3.5 w-3.5" />
                Import
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** What was understood, shown before anything replaces the editor. */
function ConfirmReplace({
  imported,
  onCancel,
  onConfirm,
}: {
  imported: ImportedEvent;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="space-y-3">
      <Alert>
        <FileJson className="h-4 w-4" />
        <AlertDescription className="text-xs">
          The editor holds unsaved work. Importing replaces it. The current draft
          stays in your draft list until you clear it.
        </AlertDescription>
      </Alert>
      <ImportSummary imported={imported} />
      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={onCancel}>
          Keep editing
        </Button>
        <Button onClick={onConfirm}>Replace editor</Button>
      </DialogFooter>
    </div>
  );
}

export function ImportSummary({ imported }: { imported: ImportedEvent }) {
  const { form, warnings, provenance } = imported;
  const primaryImages = form.images.filter((row) => row.marker === PRIMARY_MARKER);
  const markedImages = form.images.filter((row) => row.marker !== PRIMARY_MARKER);

  return (
    <div className="space-y-2 rounded-xl border p-3 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium">{form.name || 'Unnamed item'}</span>
        <code className="text-[10px] text-muted-foreground">{form.d || 'no d tag'}</code>
        {form.type && (
          <Badge variant="outline" className="text-[10px]">
            {form.type}
          </Badge>
        )}
        {form.category && (
          <Badge variant="outline" className="text-[10px]">
            {form.category}
          </Badge>
        )}
      </div>

      <ul className="space-y-0.5 text-[11px] text-muted-foreground">
        <li>
          {form.images.length === 0
            ? 'No image tag, add artwork in the Images section.'
            : `${primaryImages.length} primary + ${markedImages.length} marked view(s).`}
        </li>
        <li>
          {form.contexts.length} context tag(s), {form.topics.length} topic tag(s).
        </li>
        {form.extraTags.length > 0 && (
          <li>{form.extraTags.length} unknown tag(s) preserved.</li>
        )}
        {Object.keys(form.content.extra).length > 0 && (
          <li>
            Preserved content keys:{' '}
            <span className="font-mono">
              {Object.keys(form.content.extra).join(', ')}
            </span>
          </li>
        )}
        {Object.keys(form.content.visual.extra).length > 0 && (
          <li>
            Preserved <code>visual</code> keys:{' '}
            <span className="font-mono">
              {Object.keys(form.content.visual.extra).join(', ')}
            </span>
          </li>
        )}
        {provenance && (
          <li>
            {provenance.isSigned ? 'Signed' : 'Unsigned'} paste
            {provenance.pubkey && ` by ${provenance.pubkey.slice(0, 12)}…`}, imported
            as a new local draft.
          </li>
        )}
      </ul>

      {warnings.length > 0 && (
        <ul className="space-y-0.5 text-[11px] text-amber-700 dark:text-amber-400">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
