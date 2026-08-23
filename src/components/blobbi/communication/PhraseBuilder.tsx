/**
 * The phrase builder: pick a sentence, fill its holes from closed lists.
 *
 * Deliberately not a grammar engine. A template is a fixed sequence of literal
 * fragments and named holes (`src/communication/templates.ts`), every hole draws
 * from a small catalog, and there is no free-text slot anywhere — which is what
 * lets the whole feature be available in a profile that refuses free text.
 *
 * ## Native `<select>`, on purpose
 *
 * Not a styled listbox. Three reasons, in order of weight: it is the best touch
 * control on every phone without any work; it is keyboard- and
 * screen-reader-correct by default; and it renders in place rather than through
 * a portal, which matters because the island runs inside a fullscreen container
 * and portalled overlays land outside it.
 *
 * ## The preview is the message
 *
 * The sentence shown above the Send button is produced by `renderTemplateText`
 * — the same function the RECEIVER uses. A preview built by different code from
 * the one that renders the received message is a preview that can lie about
 * what you are about to say.
 */

import { useCallback, useMemo, useState } from 'react';
import { ChevronLeft, Send } from 'lucide-react';

import {
  PHRASE_TEMPLATES,
  renderTemplateText,
  templateParamValues,
  type IslandMessage,
  type PhraseTemplate,
} from '@/communication';
import { cn } from '@/lib/utils';

interface PhraseBuilderProps {
  onSend: (message: IslandMessage) => void;
}

/** The first allowed value of every parameter — a template always starts valid. */
function initialParams(template: PhraseTemplate): Record<string, string> {
  const params: Record<string, string> = {};
  for (const param of template.params) {
    params[param.name] = templateParamValues(param.catalog)[0]?.id ?? '';
  }
  return params;
}

export function PhraseBuilder({ onSend }: PhraseBuilderProps) {
  const [template, setTemplate] = useState<PhraseTemplate | null>(null);
  const [params, setParams] = useState<Record<string, string>>({});

  const choose = useCallback((next: PhraseTemplate) => {
    setTemplate(next);
    setParams(initialParams(next));
  }, []);

  const preview = useMemo(
    () => (template ? renderTemplateText(template, params) : null),
    [template, params],
  );

  if (!template) {
    return (
      <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {PHRASE_TEMPLATES.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              onClick={() => choose(entry)}
              className={cn(
                'w-full rounded-xl px-3 py-2.5 text-left text-sm font-medium',
                'min-h-[2.75rem] border border-island-wood/25 bg-island-cream/70 text-island-ink',
                'transition-transform duration-150 ease-cozy hover:bg-island-cream active:scale-[0.98]',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
            >
              {entry.label}
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="space-y-2.5">
      <button
        type="button"
        onClick={() => setTemplate(null)}
        className={cn(
          'inline-flex min-h-[2.25rem] items-center gap-1 rounded-full px-2 py-1',
          'text-xs font-semibold text-island-wood-dark',
          'transition-transform duration-150 ease-cozy hover:bg-island-cream active:scale-95',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        <ChevronLeft className="size-3.5" aria-hidden="true" />
        All phrases
      </button>

      <div className="flex flex-wrap items-end gap-2">
        {template.params.map((param) => (
          <label key={param.name} className="flex min-w-[8rem] flex-1 flex-col gap-1">
            <span className="px-1 text-[0.7rem] font-semibold uppercase tracking-wide text-island-ink-soft">
              {param.prompt}
            </span>
            <select
              value={params[param.name] ?? ''}
              onChange={(event) =>
                setParams((prev) => ({ ...prev, [param.name]: event.target.value }))
              }
              className={cn(
                'min-h-[2.75rem] w-full rounded-xl border border-island-wood/25 bg-island-cream/70 px-2.5 text-sm',
                'text-island-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
            >
              {templateParamValues(param.catalog).map((value) => (
                <option key={value.id} value={value.id}>
                  {value.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <p
          className="min-w-0 flex-1 rounded-xl bg-island-cream/60 px-3 py-2 text-sm text-island-ink"
          data-testid="phrase-preview"
        >
          {preview}
        </p>
        <button
          type="button"
          disabled={!preview}
          onClick={() => onSend({ type: 'template', template: template.id, params })}
          aria-label={preview ? `Send: ${preview}` : 'Send phrase'}
          className={cn(
            'inline-flex size-11 shrink-0 items-center justify-center rounded-full',
            'bg-island-ocean text-island-cream transition-transform duration-150 ease-cozy',
            'hover:brightness-105 active:scale-95',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:pointer-events-none disabled:opacity-40',
          )}
        >
          <Send className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
