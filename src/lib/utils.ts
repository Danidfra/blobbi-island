import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Shared "Enter Island" primary CTA style — the cozy, game-like purple pill with
 * a warm vertical gradient, cream border and layered depth shadow. Matches the
 * pre-login screen's primary button so all primary actions feel consistent.
 */
export const islandCtaButtonClass =
  "w-full rounded-full border-2 border-island-cream/80 bg-gradient-to-b from-[#A07EF0] to-island-purple px-5 py-3 text-base font-bold tracking-wide text-white [text-shadow:0_1px_2px_rgba(58,42,26,0.45)] shadow-[0_6px_0_#6B4FC4,0_10px_18px_rgba(58,42,26,0.35)] transition-all duration-150 ease-cozy hover:-translate-y-0.5 hover:from-[#AB8BF3] hover:to-[#9476EC] active:translate-y-0.5 active:shadow-[0_3px_0_#6B4FC4,0_6px_12px_rgba(58,42,26,0.3)] disabled:pointer-events-none disabled:opacity-60"
