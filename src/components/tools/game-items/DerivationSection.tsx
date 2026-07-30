/**
 * `based_on` derivation references: `["a", "31632:<pubkey>:<d>", "<relay>", "based_on"]`.
 *
 * What this tag means, stated plainly because it is easy to over-read: it says
 * "this item was derived from that one". It does NOT say the other issuer
 * approved it, that this item is official because its ancestor was, or that any
 * ownership transferred. Nothing in Blobbi Island grants trust across a
 * `based_on` edge, and this section deliberately does not offer to.
 *
 * The marker is fixed. There is no marker field to edit, because an `a` tag
 * with a different marker is a different tag with different meaning, and the
 * form has no business emitting one under this heading.
 */

import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { blankDerivationRow, type ItemFormState } from '@/tools/game-items/item-form-model';
import { isItemDefinitionAddress } from '@/tools/game-items/form-event-conversion';

import { Section } from './EditorPrimitives';

export interface DerivationSectionProps {
  form: ItemFormState;
  patch: (patch: Partial<ItemFormState>) => void;
  fieldErrors: Readonly<Record<string, string>>;
}

export function DerivationSection({ form, patch, fieldErrors }: DerivationSectionProps) {
  const update = (id: string, changes: Partial<{ address: string; relay: string }>) =>
    patch({
      basedOn: form.basedOn.map((row) => (row.id === id ? { ...row, ...changes } : row)),
    });

  return (
    <Section
      title="Derived from"
      description="Lineage only. It records where this design came from, never who owns or endorses it."
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => patch({ basedOn: [...form.basedOn, blankDerivationRow()] })}
        >
          <Plus className="h-3.5 w-3.5" />
          Add reference
        </Button>
      }
    >
      {form.basedOn.length === 0 ? (
        <p className="text-xs text-muted-foreground">No derivation references.</p>
      ) : (
        <ul className="space-y-2">
          {form.basedOn.map((row) => {
            const address = row.address.trim();
            const error =
              fieldErrors[`basedOn:${row.id}`] ??
              (address !== '' && !isItemDefinitionAddress(address)
                ? 'Not a kind:31632 coordinate.'
                : undefined);
            return (
              <li key={row.id} className="space-y-1.5 rounded-xl border p-3">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={row.address}
                    placeholder="31632:<pubkey>:<d>"
                    className="h-9 flex-1 font-mono text-xs"
                    aria-label="Derivation address"
                    aria-invalid={error ? true : undefined}
                    onChange={(event) => update(row.id, { address: event.target.value })}
                  />
                  <Input
                    value={row.relay}
                    placeholder="wss://relay… (optional)"
                    className="h-9 font-mono text-xs sm:w-64"
                    aria-label="Derivation relay hint"
                    onChange={(event) => update(row.id, { relay: event.target.value })}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    aria-label="Remove derivation reference"
                    onClick={() =>
                      patch({ basedOn: form.basedOn.filter((r) => r.id !== row.id) })
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {error && (
                  <p className="text-xs text-destructive" role="alert">
                    {error}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground">
                  Marker is fixed to <code>based_on</code>.
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
