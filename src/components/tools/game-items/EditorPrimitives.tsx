/**
 * The small shared vocabulary every editor section is built from.
 *
 * Sections are visually consistent because they are literally the same
 * components, not because each one repeats the same Tailwind classes. The
 * warm, rounded look is Blobbi Island's, deliberately: this is an authoring
 * tool inside a game, not a database console bolted onto the side of one.
 */

import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/** A titled card grouping one part of the form. */
export function Section({
  title,
  description,
  children,
  action,
  className,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'space-y-4 rounded-2xl border bg-card p-4 shadow-sm sm:p-5',
        className,
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
          {description && (
            <p className="max-w-prose text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

/** A labelled control with optional hint and inline error. */
export function Field({
  id,
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id} className="flex items-center gap-1.5 text-xs font-medium">
        {label}
        {required && <span className="text-destructive">*</span>}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

/** A plain text field wired to the `Field` shell. */
export function TextField({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  error,
  required,
  className,
  inputClassName,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
  inputClassName?: string;
}) {
  return (
    <Field id={id} label={label} hint={hint} error={error} required={required} className={className}>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={cn('h-9', inputClassName)}
        aria-invalid={error ? true : undefined}
      />
    </Field>
  );
}

/**
 * Clickable suggestions.
 *
 * Every place this appears, the underlying field remains free text, the chips
 * are a shortcut, never a closed vocabulary. That distinction matters for
 * `category`, `type` and topics, where a closed list would block whatever the
 * next accessory needs.
 */
export function SuggestionChips({
  values,
  onPick,
  active,
  className,
}: {
  values: readonly string[];
  onPick: (value: string) => void;
  active?: (value: string) => boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {values.map((value) => (
        <button key={value} type="button" onClick={() => onPick(value)}>
          <Badge
            variant={active?.(value) ? 'default' : 'outline'}
            className="cursor-pointer text-[10px] font-normal hover:bg-accent"
          >
            {value}
          </Badge>
        </button>
      ))}
    </div>
  );
}

/** A dense monospace value with a muted label, for addresses and ids. */
export function MonoValue({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 space-y-0.5', className)}>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="break-all font-mono text-xs">{value}</p>
    </div>
  );
}
