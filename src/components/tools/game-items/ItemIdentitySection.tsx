/**
 * Identity: `d`, `name`, `type`, `alt` — and the address they add up to.
 *
 * The `d` tag is the only field in this whole editor that cannot be corrected
 * later. Everything else is a value inside an event; `d` (with the signer's
 * pubkey and the kind) IS the event's address, so changing it does not edit the
 * item — it points at a different item and leaves the original exactly where it
 * was. This section is built around making that impossible to do by accident:
 *
 *  - the live address is always on screen, so you can see what you are about to
 *    replace;
 *  - once a published event is loaded, `d` locks. Editing it requires pressing
 *    "Create as a new item", which is a decision with a name rather than a
 *    stray keystroke;
 *  - the slug helper never rewrites what you typed on its own. It normalizes on
 *    demand, because a field that silently mangles input is worse than one that
 *    lets you publish an unconventional `d` on purpose.
 */

import { Lock, Sparkles, Unlock } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  ITEM_TYPE_OPTIONS,
  type ItemFormState,
  slugifyDTag,
} from '@/tools/game-items/item-form-model';

import { Field, Section, TextField } from './EditorPrimitives';

const CUSTOM_TYPE = '__custom__';

export interface ItemIdentitySectionProps {
  form: ItemFormState;
  patch: (patch: Partial<ItemFormState>) => void;
  fieldErrors: Readonly<Record<string, string>>;
  /** The `31632:<pubkey>:<d>` this form would publish to, when it forms one. */
  address: string | null;
  /** True while `d` is locked because a published event is loaded. */
  dLocked: boolean;
  onCreateAsNew: () => void;
}

export function ItemIdentitySection({
  form,
  patch,
  fieldErrors,
  address,
  dLocked,
  onCreateAsNew,
}: ItemIdentitySectionProps) {
  const typeIsKnown = ITEM_TYPE_OPTIONS.includes(form.type);
  const typeSelectValue = form.type === '' ? '' : typeIsKnown ? form.type : CUSTOM_TYPE;

  return (
    <Section
      title="Identity"
      description="What this item is called, and the address it lives at forever."
    >
      <Field
        id="item-d"
        label="d — item identifier"
        required
        error={fieldErrors.d}
        hint={
          <>
            Recommended shape <code>&lt;namespace&gt;:&lt;category&gt;:&lt;slug&gt;</code>, e.g.{' '}
            <code>blobbi:accessory:party-hat</code>.
          </>
        }
      >
        <div className="flex gap-2">
          <Input
            id="item-d"
            value={form.d}
            disabled={dLocked}
            placeholder="blobbi:accessory:party-hat"
            className="h-9 font-mono"
            onChange={(event) => patch({ d: event.target.value })}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 shrink-0 gap-1.5"
            disabled={dLocked || form.d.trim() === ''}
            onClick={() => patch({ d: slugifyDTag(form.d) })}
            title="Lowercase, hyphenate and trim — colons are kept"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Normalize
          </Button>
        </div>
      </Field>

      {dLocked ? (
        <div className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 sm:flex-row sm:items-center sm:justify-between dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          <p className="flex items-start gap-2">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              Editing a published item. Publishing replaces this address; changing{' '}
              <code>d</code> would create a different item instead.
            </span>
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5"
            onClick={onCreateAsNew}
          >
            <Unlock className="h-3.5 w-3.5" />
            Create as a new item
          </Button>
        </div>
      ) : (
        form.d.trim() !== '' && (
          <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            The <code>d</code> tag is this item&rsquo;s identity. Publishing with a
            different <code>d</code> creates a new item and leaves any previous one
            untouched.
          </p>
        )
      )}

      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Full address
        </p>
        <p className="break-all rounded-lg bg-muted px-3 py-2 font-mono text-xs">
          {address ??
            `31632:${form.d.trim() === '' ? '<d required>' : '<sign in to resolve>'}:${form.d.trim() || '…'}`}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="item-name"
          label="name"
          required
          value={form.name}
          error={fieldErrors.name}
          placeholder="Party Hat"
          onChange={(name) => patch({ name })}
        />

        <Field id="item-type" label="type" required error={fieldErrors.type}>
          <div className="space-y-2">
            <Select
              value={typeSelectValue}
              onValueChange={(value) =>
                patch({ type: value === CUSTOM_TYPE ? '' : value })
              }
            >
              <SelectTrigger id="item-type" className="h-9">
                <SelectValue placeholder="Choose a type" />
              </SelectTrigger>
              <SelectContent>
                {ITEM_TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM_TYPE}>custom…</SelectItem>
              </SelectContent>
            </Select>
            {typeSelectValue === CUSTOM_TYPE || (form.type !== '' && !typeIsKnown) ? (
              <Input
                value={form.type}
                placeholder="custom-type"
                className="h-9 font-mono"
                onChange={(event) => patch({ type: event.target.value })}
              />
            ) : null}
          </div>
        </Field>
      </div>

      <Field
        id="item-alt"
        label="alt"
        hint="Shown by generic Nostr clients that cannot render an item definition."
      >
        <Textarea
          id="item-alt"
          value={form.alt}
          rows={2}
          placeholder="Game item: Party Hat — a cosmetic accessory for Blobbi."
          onChange={(event) => patch({ alt: event.target.value })}
        />
      </Field>
    </Section>
  );
}
