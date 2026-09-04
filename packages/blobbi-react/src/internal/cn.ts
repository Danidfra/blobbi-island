/**
 * Package-local `cn()`.
 *
 * A deliberate 4-line copy rather than an import of the host application's
 * `@/lib/utils`: that module also exports Island button themes, so importing it
 * would drag Island styling vocabulary into a package that must not have any.
 * The two dependencies here (`clsx`, `tailwind-merge`) were already the
 * renderer's only className dependencies, and `tailwind-merge` semantics are
 * part of the renderer's public contract, callers override the canonical box
 * through `className` (see `blobbi-render-size.ts`), which only works because
 * later utility classes win over earlier ones.
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
