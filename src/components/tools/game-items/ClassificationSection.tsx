/**
 * Classification: the descriptive tags that are neither identity nor artwork —
 * `category`, `symbol`, `rarity`, `max_stack`, `version`.
 *
 * `category` is free text with suggestions rather than a select, and that is a
 * decision rather than an omission: the wire format places no constraint on it,
 * Blobbi Island's own registry has already grown a category since this protocol
 * landed, and a closed dropdown here would mean editing this file every time
 * artwork invents a new one.
 *
 * `max_stack` is typed as a number and published as a string, which is what the
 * spec asks for. The numeric input is a convenience for the human; the tag
 * carries `"10"`, not `10`.
 */

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  CATEGORY_SUGGESTIONS,
  CONTEXT_SUGGESTIONS,
  type ItemFormState,
  RARITY_OPTIONS,
  TOPIC_SUGGESTIONS,
} from '@/tools/game-items/item-form-model';

import { Field, Section, SuggestionChips, TextField } from './EditorPrimitives';
import { TagListEditor } from './TagListEditor';

const NO_RARITY = '__none__';

export interface ClassificationSectionProps {
  form: ItemFormState;
  patch: (patch: Partial<ItemFormState>) => void;
  fieldErrors: Readonly<Record<string, string>>;
}

export function ClassificationSection({
  form,
  patch,
  fieldErrors,
}: ClassificationSectionProps) {
  return (
    <Section
      title="Classification"
      description="Grouping and display metadata. None of it changes what the item does."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <TextField
            id="item-category"
            label="category"
            value={form.category}
            placeholder="headwear"
            onChange={(category) => patch({ category })}
          />
          <SuggestionChips
            values={CATEGORY_SUGGESTIONS}
            active={(value) => form.category === value}
            onPick={(category) =>
              patch({ category: form.category === category ? '' : category })
            }
          />
        </div>

        <Field
          id="item-rarity"
          label="rarity"
          hint="Display metadata only — it grants nothing."
        >
          <Select
            value={form.rarity === '' ? NO_RARITY : form.rarity}
            onValueChange={(value) =>
              patch({ rarity: value === NO_RARITY ? '' : value })
            }
          >
            <SelectTrigger id="item-rarity" className="h-9">
              <SelectValue placeholder="none" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_RARITY}>none</SelectItem>
              {RARITY_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          id="item-symbol"
          label="symbol"
          value={form.symbol}
          placeholder="🎩"
          onChange={(symbol) => patch({ symbol })}
          hint="A short glyph for dense UI."
        />

        <Field
          id="item-max-stack"
          label="max_stack"
          error={fieldErrors.maxStack}
          hint="Positive whole number. Published as a string."
        >
          <Input
            id="item-max-stack"
            type="number"
            min={1}
            step={1}
            value={form.maxStack}
            placeholder="1"
            className="h-9"
            onChange={(event) => patch({ maxStack: event.target.value })}
            aria-invalid={fieldErrors.maxStack ? true : undefined}
          />
        </Field>

        <TextField
          id="item-version"
          label="version"
          value={form.version}
          placeholder="1"
          onChange={(version) => patch({ version })}
          hint="Your own revision marker."
        />
      </div>

      <div className="grid gap-5 border-t pt-4 sm:grid-cols-2">
        <TagListEditor
          id="item-contexts"
          label="context — which games this item belongs to"
          values={form.contexts}
          onChange={(contexts) => patch({ contexts })}
          suggestions={CONTEXT_SUGGESTIONS}
          placeholder="game:blobbi"
          hint="Type or paste comma-separated values; Enter commits."
        />

        <TagListEditor
          id="item-topics"
          label="t — topics"
          values={form.topics}
          onChange={(topics) => patch({ topics })}
          suggestions={TOPIC_SUGGESTIONS}
          placeholder="equipable"
          hint="Single-letter t tags are what relays actually index."
        />
      </div>
    </Section>
  );
}
