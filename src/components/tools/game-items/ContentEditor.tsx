/**
 * The `content` editor: a structured form over the recommended shape, plus a
 * raw JSON mode for everything the structured form does not model.
 *
 * ```json
 * { "description": "", "effects": {}, "metadata": {}, "visual": {} }
 * ```
 *
 * ## Switching modes is lossless in one direction and refused in the other
 *
 * structured → JSON always works: the structured state serializes, gets pretty
 * printed, and becomes the text you edit.
 *
 * JSON → structured works only when the text is a valid JSON *object*. A bare
 * array or string is valid content that the structured fields cannot represent,
 * so the switch is refused with a message rather than quietly throwing the
 * content away. Same for a syntax error.
 *
 * Either way, keys the structured editor does not know about survive: they are
 * kept in `content.extra` (and `visual.extra`) and re-emitted on publish. That
 * is what makes it safe to edit a definition published by a newer client.
 *
 * ## Effects are context-keyed
 *
 * `effects` is `{ "<context>": { "<stat>": <value> } }`, not a flat bag. The
 * suggestions are Blobbi's stats because this is Blobbi's tool, but the context
 * and the key are both free text — an item that affects another game's stats is
 * a perfectly good item.
 */

import { useState } from 'react';
import { Braces, ListTree, Plus, RotateCcw, Trash2, Wand2 } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
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
  buildContentString,
  contentStringToFormState,
} from '@/tools/game-items/form-event-conversion';
import {
  BLOBBI_EFFECT_VISUAL_KIND,
  type ContentFormState,
  EFFECT_CATEGORY,
  EFFECT_KEY_SUGGESTIONS,
  EFFECT_SLOT_SUGGESTIONS,
  FORM_SUGGESTIONS,
  METADATA_KEY_SUGGESTIONS,
  SLOT_SUGGESTIONS,
  blankContent,
  isEffectVisual,
  nextRowId,
} from '@/tools/game-items/item-form-model';

import { Field, Section, SuggestionChips } from './EditorPrimitives';
import { EFFECT_ID_SUGGESTIONS, slotForEffectId } from './effect-vocabulary';
import { TagListEditor } from './TagListEditor';

const RECOMMENDED_SHAPE = `{
  "description": "",
  "effects": {},
  "metadata": {},
  "visual": {}
}`;

export interface ContentEditorProps {
  content: ContentFormState;
  onChange: (content: ContentFormState) => void;
  /** Blocking content error from the validation pass, if any. */
  error?: string;
  /**
   * The item's `category` tag.
   *
   * Read for ONE purpose: choosing which `visual` shape to show first for an
   * item whose visual is still blank. It is never written into content and
   * never overrides a visual the author has already claimed — `visual.kind`
   * decides that, exactly as it does for a reader.
   */
  category?: string;
}

export function ContentEditor({
  content,
  onChange,
  error,
  category,
}: ContentEditorProps) {
  const [switchError, setSwitchError] = useState<string | null>(null);

  const toJsonMode = () => {
    const built = buildContentString(content);
    if (!built.ok) {
      setSwitchError(built.error);
      return;
    }
    setSwitchError(null);
    const pretty = built.value === '' ? '' : safePretty(built.value);
    onChange({ ...content, mode: 'json', raw: pretty });
  };

  const toStructuredMode = () => {
    const parsed = contentStringToFormState(content.raw);
    if (!parsed.ok) {
      setSwitchError(parsed.error);
      return;
    }
    setSwitchError(null);
    onChange({ ...parsed.value, mode: 'structured' });
  };

  return (
    <Section
      title="Content"
      description="The JSON body. Tag-owned fields (name, type, category…) are not duplicated here."
      action={
        <div className="flex gap-1 rounded-lg border p-0.5">
          <Button
            type="button"
            variant={content.mode === 'structured' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={toStructuredMode}
            disabled={content.mode === 'structured'}
          >
            <ListTree className="h-3.5 w-3.5" />
            Structured
          </Button>
          <Button
            type="button"
            variant={content.mode === 'json' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={toJsonMode}
            disabled={content.mode === 'json'}
          >
            <Braces className="h-3.5 w-3.5" />
            JSON
          </Button>
        </div>
      }
    >
      {switchError && (
        <Alert variant="destructive">
          <AlertDescription className="text-xs">{switchError}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      )}
      {content.rawOnly && (
        <Alert>
          <AlertDescription className="text-xs">
            This item&rsquo;s content is not a JSON object, so it stays in raw mode
            and is republished byte for byte.
          </AlertDescription>
        </Alert>
      )}

      {content.mode === 'json' ? (
        <JsonMode content={content} onChange={onChange} />
      ) : (
        <StructuredMode content={content} onChange={onChange} category={category} />
      )}

      {Object.keys(content.extra).length > 0 && (
        <div className="rounded-xl border border-dashed p-3">
          <p className="text-xs font-medium">
            Preserved content keys ({Object.keys(content.extra).length})
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            The structured editor does not model these, and republishing keeps them
            exactly as they are:{' '}
            <span className="font-mono">{Object.keys(content.extra).join(', ')}</span>
          </p>
        </div>
      )}
    </Section>
  );
}

function JsonMode({
  content,
  onChange,
}: {
  content: ContentFormState;
  onChange: (content: ContentFormState) => void;
}) {
  const parseError = jsonError(content.raw);

  return (
    <div className="space-y-2">
      <Textarea
        value={content.raw}
        rows={14}
        spellCheck={false}
        className="font-mono text-xs"
        aria-label="Raw content JSON"
        aria-invalid={parseError ? true : undefined}
        onChange={(event) => onChange({ ...content, raw: event.target.value })}
      />
      {parseError && (
        <p className="text-xs text-destructive" role="alert">
          {parseError}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={!!parseError || content.raw.trim() === ''}
          onClick={() => onChange({ ...content, raw: safePretty(content.raw) })}
        >
          <Wand2 className="h-3.5 w-3.5" />
          Format
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => onChange({ ...content, raw: RECOMMENDED_SHAPE, rawOnly: false })}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset to recommended shape
        </Button>
      </div>
    </div>
  );
}

function StructuredMode({
  content,
  onChange,
  category,
}: {
  content: ContentFormState;
  onChange: (content: ContentFormState) => void;
  category?: string;
}) {
  return (
    <div className="space-y-5">
      <Field id="content-description" label="description">
        <Textarea
          id="content-description"
          value={content.description}
          rows={3}
          placeholder="A jaunty paper hat. Purely decorative."
          onChange={(event) => onChange({ ...content, description: event.target.value })}
        />
      </Field>

      {/* --- Effects ------------------------------------------------------- */}
      <div className="space-y-2 border-t pt-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h4 className="text-xs font-semibold">effects</h4>
            <p className="text-[11px] text-muted-foreground">
              Grouped by context: <code>effects[&quot;game:blobbi&quot;].hunger</code>
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() =>
              onChange({
                ...content,
                effects: [
                  ...content.effects,
                  {
                    id: nextRowId('effect'),
                    context: content.effects.at(-1)?.context ?? 'game:blobbi',
                    key: '',
                    value: '',
                    valueType: 'number',
                  },
                ],
              })
            }
          >
            <Plus className="h-3.5 w-3.5" />
            Add effect
          </Button>
        </div>

        {content.effects.length === 0 ? (
          <p className="text-xs text-muted-foreground">No effects.</p>
        ) : (
          <ul className="space-y-2">
            {content.effects.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-2">
                <Input
                  value={row.context}
                  placeholder="game:blobbi"
                  className="h-8 w-40 font-mono text-xs"
                  aria-label="Effect context"
                  onChange={(event) =>
                    onChange({
                      ...content,
                      effects: content.effects.map((r) =>
                        r.id === row.id ? { ...r, context: event.target.value } : r,
                      ),
                    })
                  }
                />
                <Input
                  value={row.key}
                  placeholder="hunger"
                  className="h-8 w-32 font-mono text-xs"
                  aria-label="Effect key"
                  onChange={(event) =>
                    onChange({
                      ...content,
                      effects: content.effects.map((r) =>
                        r.id === row.id ? { ...r, key: event.target.value } : r,
                      ),
                    })
                  }
                />
                <Select
                  value={row.valueType}
                  onValueChange={(valueType) =>
                    onChange({
                      ...content,
                      effects: content.effects.map((r) =>
                        r.id === row.id
                          ? { ...r, valueType: valueType as typeof r.valueType }
                          : r,
                      ),
                    })
                  }
                >
                  <SelectTrigger className="h-8 w-24 text-xs" aria-label="Effect value type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="number">number</SelectItem>
                    <SelectItem value="string">string</SelectItem>
                    <SelectItem value="boolean">boolean</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={row.value}
                  placeholder={row.valueType === 'boolean' ? 'true' : '10'}
                  className="h-8 w-24 font-mono text-xs"
                  aria-label="Effect value"
                  onChange={(event) =>
                    onChange({
                      ...content,
                      effects: content.effects.map((r) =>
                        r.id === row.id ? { ...r, value: event.target.value } : r,
                      ),
                    })
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Remove effect"
                  onClick={() =>
                    onChange({
                      ...content,
                      effects: content.effects.filter((r) => r.id !== row.id),
                    })
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <SuggestionChips
          values={EFFECT_KEY_SUGGESTIONS}
          onPick={(key) =>
            onChange({
              ...content,
              effects: [
                ...content.effects,
                {
                  id: nextRowId('effect'),
                  context: content.effects.at(-1)?.context ?? 'game:blobbi',
                  key,
                  value: '',
                  valueType: 'number',
                },
              ],
            })
          }
        />
      </div>

      {/* --- Metadata ------------------------------------------------------ */}
      <div className="space-y-2 border-t pt-4">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-xs font-semibold">metadata</h4>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() =>
              onChange({
                ...content,
                metadata: [
                  ...content.metadata,
                  { id: nextRowId('metadata'), key: '', value: '', valueType: 'string' },
                ],
              })
            }
          >
            <Plus className="h-3.5 w-3.5" />
            Add entry
          </Button>
        </div>

        {content.metadata.length === 0 ? (
          <p className="text-xs text-muted-foreground">No metadata.</p>
        ) : (
          <ul className="space-y-2">
            {content.metadata.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-2">
                <Input
                  value={row.key}
                  placeholder="stackable"
                  className="h-8 w-40 font-mono text-xs"
                  aria-label="Metadata key"
                  onChange={(event) =>
                    onChange({
                      ...content,
                      metadata: content.metadata.map((r) =>
                        r.id === row.id ? { ...r, key: event.target.value } : r,
                      ),
                    })
                  }
                />
                <Select
                  value={row.valueType}
                  onValueChange={(valueType) =>
                    onChange({
                      ...content,
                      metadata: content.metadata.map((r) =>
                        r.id === row.id
                          ? { ...r, valueType: valueType as typeof r.valueType }
                          : r,
                      ),
                    })
                  }
                >
                  <SelectTrigger className="h-8 w-24 text-xs" aria-label="Metadata value type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="string">string</SelectItem>
                    <SelectItem value="number">number</SelectItem>
                    <SelectItem value="boolean">boolean</SelectItem>
                    <SelectItem value="json">JSON</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={row.value}
                  placeholder={row.valueType === 'json' ? '{"a":1}' : 'true'}
                  className="h-8 min-w-40 flex-1 font-mono text-xs"
                  aria-label="Metadata value"
                  onChange={(event) =>
                    onChange({
                      ...content,
                      metadata: content.metadata.map((r) =>
                        r.id === row.id ? { ...r, value: event.target.value } : r,
                      ),
                    })
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Remove metadata entry"
                  onClick={() =>
                    onChange({
                      ...content,
                      metadata: content.metadata.filter((r) => r.id !== row.id),
                    })
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <SuggestionChips
          values={METADATA_KEY_SUGGESTIONS}
          onPick={(key) =>
            onChange({
              ...content,
              metadata: [
                ...content.metadata,
                { id: nextRowId('metadata'), key, value: '', valueType: 'string' },
              ],
            })
          }
        />
      </div>

      {/* --- Visual -------------------------------------------------------- */}
      <VisualFields content={content} onChange={onChange} category={category} />

      <div className="border-t pt-4">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs"
          onClick={() => onChange({ ...blankContent(), mode: 'structured' })}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Clear content
        </Button>
      </div>
    </div>
  );
}

/**
 * The `visual` block — TWO SHAPES behind one heading.
 *
 * A wearable answers "where on the body does this sit?" (`slot`); a visual
 * effect answers "which locally-implemented effect does this grant?" (`kind`,
 * `effect`, `effectSlot`). Asking both sets of questions at once would produce
 * definitions carrying a body slot for something that has no body position, so
 * the editor picks a shape and shows only its fields.
 *
 * Which shape is shown follows `visual.kind`, the same discriminator a reader
 * uses. The `category` prop only decides the default for a visual nobody has
 * claimed yet — it never overrides what the author actually typed.
 */
function VisualFields({
  content,
  onChange,
  category,
}: {
  content: ContentFormState;
  onChange: (content: ContentFormState) => void;
  category?: string;
}) {
  const { visual } = content;
  const isEffect =
    isEffectVisual(visual) ||
    (visual.slot.trim() === '' &&
      visual.kind.trim() === '' &&
      category?.trim().toLowerCase() === EFFECT_CATEGORY);

  const patchVisual = (patch: Partial<typeof visual>) =>
    onChange({ ...content, visual: { ...visual, ...patch } });

  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-xs font-semibold">visual</h4>
          <p className="text-[11px] text-muted-foreground">
            {isEffect
              ? 'Names the effect this item grants. The effect itself is implemented locally — an event never carries animation code.'
              : 'Describes where a wearable sits. It never says who is wearing it — that is inventory data, not a definition.'}
          </p>
        </div>
        <div className="flex gap-1 rounded-lg border p-0.5">
          <Button
            type="button"
            variant={isEffect ? 'ghost' : 'secondary'}
            size="sm"
            className="h-7 text-xs"
            aria-pressed={!isEffect}
            onClick={() =>
              // Leaving effect mode clears the effect fields, so the published
              // content cannot claim to be an effect and a wearable at once.
              patchVisual({ kind: '', effect: '', effectSlot: '' })
            }
          >
            Wearable
          </Button>
          <Button
            type="button"
            variant={isEffect ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 text-xs"
            aria-pressed={isEffect}
            onClick={() =>
              patchVisual({ kind: BLOBBI_EFFECT_VISUAL_KIND, slot: '' })
            }
          >
            Visual effect
          </Button>
        </div>
      </div>

      {isEffect ? (
        <>
          <Field
            id="visual-kind"
            label="kind"
            hint={`The discriminator a reader uses. "${BLOBBI_EFFECT_VISUAL_KIND}" for a Blobbi visual effect.`}
          >
            <Input
              id="visual-kind"
              value={visual.kind}
              placeholder={BLOBBI_EFFECT_VISUAL_KIND}
              className="h-9 font-mono text-xs"
              onChange={(event) => patchVisual({ kind: event.target.value })}
            />
          </Field>

          <Field
            id="visual-effect"
            label="effect"
            hint="An effect NAME, never an implementation. Island only runs it for an item address it trusts."
          >
            <Input
              id="visual-effect"
              value={visual.effect}
              placeholder="golden-sparkles"
              className="h-9 font-mono text-xs"
              onChange={(event) => patchVisual({ effect: event.target.value })}
            />
          </Field>
          <SuggestionChips
            values={EFFECT_ID_SUGGESTIONS}
            active={(value) => visual.effect === value}
            onPick={(effect) => {
              if (visual.effect === effect) {
                patchVisual({ effect: '' });
                return;
              }
              // Picking a known effect fills the slot it actually occupies, so
              // the two cannot silently disagree. An already-typed slot is left
              // alone — the author may be publishing for a different client.
              const slot = slotForEffectId(effect);
              patchVisual({
                effect,
                effectSlot:
                  visual.effectSlot.trim() === '' ? slot : visual.effectSlot,
              });
            }}
          />

          <Field
            id="visual-effect-slot"
            label="effectSlot"
            hint="Which slot the effect competes for. One effect per slot."
          >
            <Input
              id="visual-effect-slot"
              value={visual.effectSlot}
              placeholder="ambient-particles"
              className="h-9 font-mono text-xs"
              onChange={(event) => patchVisual({ effectSlot: event.target.value })}
            />
          </Field>
          <SuggestionChips
            values={EFFECT_SLOT_SUGGESTIONS}
            active={(value) => visual.effectSlot === value}
            onPick={(effectSlot) =>
              patchVisual({
                effectSlot: visual.effectSlot === effectSlot ? '' : effectSlot,
              })
            }
          />
        </>
      ) : (
        <>
          <Field id="visual-slot" label="slot">
            <Input
              id="visual-slot"
              value={visual.slot}
              placeholder="headwear"
              className="h-9 font-mono text-xs"
              onChange={(event) => patchVisual({ slot: event.target.value })}
            />
          </Field>
          <SuggestionChips
            values={SLOT_SUGGESTIONS}
            active={(value) => visual.slot === value}
            onPick={(slot) =>
              patchVisual({ slot: visual.slot === slot ? '' : slot })
            }
          />
        </>
      )}

      <TagListEditor
        id="visual-forms"
        label="forms"
        values={visual.forms}
        suggestions={FORM_SUGGESTIONS}
        placeholder="adult"
        onChange={(forms) => patchVisual({ forms })}
      />

      {Object.keys(visual.extra).length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Preserved <code>visual</code> keys:{' '}
          <span className="font-mono">{Object.keys(visual.extra).join(', ')}</span>
        </p>
      )}
    </div>
  );
}

/** Pretty-print JSON, or return the input unchanged when it does not parse. */
function safePretty(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function jsonError(raw: string): string | null {
  if (raw.trim() === '') return null;
  try {
    JSON.parse(raw);
    return null;
  } catch (error) {
    return `Invalid JSON: ${(error as Error).message}`;
  }
}
