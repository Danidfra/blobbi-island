/**
 * The editor for a repeatable single-value tag, `context` and `t` today.
 *
 * Small, but it carries three behaviors that are easy to get wrong and
 * annoying to live without:
 *
 *  - Enter commits, and so does a comma or a paste of comma-separated values.
 *    Copying `equipable, wearable, headwear` out of a spec and pasting it once
 *    should produce three topics, not one topic with commas in it.
 *  - Duplicates are refused silently rather than added and later warned about.
 *    A repeated `context` tag is meaningless, and the package would emit both.
 *  - Order is preserved and editable, because tag order is preserved on the
 *    wire and a diff between two versions of an item should not be noise.
 */

import { useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

import { splitTagInput } from '@/tools/game-items/item-form-model';

import { SuggestionChips } from './EditorPrimitives';

export interface TagListEditorProps {
  id: string;
  label: string;
  values: readonly string[];
  onChange: (values: string[]) => void;
  suggestions?: readonly string[];
  placeholder?: string;
  hint?: string;
  className?: string;
}

export function TagListEditor({
  id,
  label,
  values,
  onChange,
  suggestions = [],
  placeholder,
  hint,
  className,
}: TagListEditorProps) {
  const [draft, setDraft] = useState('');

  const commit = (raw: string) => {
    const additions = splitTagInput(raw).filter((value) => !values.includes(value));
    if (additions.length > 0) onChange([...values, ...additions]);
    setDraft('');
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commit(draft);
      return;
    }
    if (event.key === 'Backspace' && draft === '' && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={id} className="text-xs font-medium">
        {label}
      </Label>

      {values.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {values.map((value) => (
            <li key={value}>
              <Badge variant="secondary" className="gap-1 pr-1 font-mono text-[11px]">
                {value}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4 rounded-full hover:bg-destructive/20"
                  aria-label={`Remove ${value}`}
                  onClick={() => onChange(values.filter((v) => v !== value))}
                >
                  <X className="h-3 w-3" />
                </Button>
              </Badge>
            </li>
          ))}
        </ul>
      )}

      <Input
        id={id}
        value={draft}
        placeholder={placeholder}
        className="h-9"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => commit(draft)}
        onPaste={(event) => {
          const text = event.clipboardData.getData('text');
          if (/[,\n\t]/.test(text)) {
            event.preventDefault();
            commit(text);
          }
        }}
      />

      {suggestions.length > 0 && (
        <SuggestionChips
          values={suggestions}
          active={(value) => values.includes(value)}
          onPick={(value) =>
            values.includes(value)
              ? onChange(values.filter((v) => v !== value))
              : onChange([...values, value])
          }
        />
      )}

      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
