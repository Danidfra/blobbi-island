/**
 * The preserved tags; everything on a loaded event that no form field owns.
 *
 * This section exists so unknown-tag preservation is VISIBLE rather than
 * merely promised. When you load somebody's definition that carries a tag this
 * build has never heard of, it shows up here, it publishes back out unchanged,
 * and you can see that happening. A silent guarantee is one nobody can check.
 *
 * Removal is possible and deliberately unglamorous: one button per tag, in an
 * advanced section, with no bulk clear. Dropping a tag you do not understand is
 * a real decision, and the UI should make it feel like one.
 */

import { Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { MANAGED_TAG_NAMES } from '@/tools/game-items/form-event-conversion';

import { Section } from './EditorPrimitives';

export interface AdvancedTagsSectionProps {
  extraTags: readonly string[][];
  onChange: (tags: string[][]) => void;
}

export function AdvancedTagsSection({ extraTags, onChange }: AdvancedTagsSectionProps) {
  return (
    <Section
      title="Preserved tags"
      description={
        <>
          Tags this editor does not manage. They are republished verbatim. Managed
          names ({[...MANAGED_TAG_NAMES].join(', ')}) are always rebuilt from the
          fields above.
        </>
      }
    >
      {extraTags.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nothing preserved. Every tag on this item maps to a field above.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {extraTags.map((tag, index) => (
            <li
              key={`${index}-${tag.join('|')}`}
              className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5"
            >
              <span className="min-w-0 flex-1 break-all font-mono text-xs">
                {JSON.stringify(tag)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 hover:text-destructive"
                aria-label={`Remove preserved tag ${tag[0]}`}
                onClick={() => onChange(extraTags.filter((_, i) => i !== index))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
