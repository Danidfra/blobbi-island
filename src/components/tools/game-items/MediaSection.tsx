/**
 * The non-image media tags: `model_3d` and `audio`.
 *
 * URL inputs only. There is no upload button here on purpose — the app's
 * Blossom helper is a generic file uploader, but a 3D model and a sound file
 * are not artwork that this tool can preview, validate, or size-check, and an
 * upload control that can produce a broken reference nobody can inspect is
 * worse than a field you paste a known-good URL into. The audio field does get
 * a real `<audio>` preview, because that costs nothing and proves the URL.
 */

import { Music, Box } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { type ItemFormState, isHttpUrl } from '@/tools/game-items/item-form-model';

import { Field, Section } from './EditorPrimitives';

export interface MediaSectionProps {
  form: ItemFormState;
  patch: (patch: Partial<ItemFormState>) => void;
}

export function MediaSection({ form, patch }: MediaSectionProps) {
  const invalid = (value: string) =>
    value.trim() !== '' && !isHttpUrl(value.trim())
      ? 'This is not an http(s) URL.'
      : undefined;

  return (
    <Section
      title="Other media"
      description="Optional references for clients that can use them."
    >
      <Field
        id="item-model-3d"
        label="model_3d"
        error={invalid(form.model3d)}
        hint="A URL to a 3D model. Blobbi Island does not render one."
      >
        <div className="flex gap-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-muted-foreground">
            <Box className="h-4 w-4" />
          </span>
          <Input
            id="item-model-3d"
            value={form.model3d}
            placeholder="https://…/party-hat.glb"
            className="h-9 font-mono text-xs"
            onChange={(event) => patch({ model3d: event.target.value })}
          />
          {form.model3d !== '' && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9"
              onClick={() => patch({ model3d: '' })}
            >
              Clear
            </Button>
          )}
        </div>
      </Field>

      <Field
        id="item-audio"
        label="audio"
        error={invalid(form.audio)}
        hint="A URL to a sound played when the item is used."
      >
        <div className="space-y-2">
          <div className="flex gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-muted-foreground">
              <Music className="h-4 w-4" />
            </span>
            <Input
              id="item-audio"
              value={form.audio}
              placeholder="https://…/crunch.mp3"
              className="h-9 font-mono text-xs"
              onChange={(event) => patch({ audio: event.target.value })}
            />
            {form.audio !== '' && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9"
                onClick={() => patch({ audio: '' })}
              >
                Clear
              </Button>
            )}
          </div>
          {isHttpUrl(form.audio.trim()) && (
            <audio controls preload="none" src={form.audio.trim()} className="h-8 w-full">
              <track kind="captions" />
            </audio>
          )}
        </div>
      </Field>
    </Section>
  );
}
