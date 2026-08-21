import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/useTheme";
import { BlobbiModal } from "@/components/ui/blobbi-modal";
import { islandThemeDeclarations, type IslandTheme } from "@/lib/island-themes";
import { useFullscreenPortalContainer } from "@/contexts/FullscreenPortalContext";

/**
 * ThemePicker — Settings › Appearance › Theme.
 *
 * ## Where this sits
 *
 * Blobbi Island has no Settings *page*; the account menu IS the settings
 * surface, and it is a 288px dropdown on desktop and a compact modal in
 * landscape. Neither has room for a grid of theme cards, and a theme is chosen
 * by looking at it, so the picker is its own modal opened from an Appearance
 * row. That also leaves room for this to grow into a real theme browser
 * (categories, seasonal sets, a preview of the world) without the menu having
 * to grow with it.
 *
 * ## The previews theme themselves
 *
 * Each card writes the theme's OWN palette onto itself as inline custom
 * properties, then renders a miniature of the real thing — page, panel, plaque,
 * button, muted line — out of the same `island-*` tokens every surface in the
 * game uses. Nothing is hand-coloured, so a preview cannot drift from what
 * choosing the theme actually does; if a card looks wrong, the theme IS wrong.
 * This is the same scoping trick as Ditto's ScopedTheme, applied to a card
 * instead of a container.
 */

function ThemeCard({
  theme,
  selected,
  onSelect,
}: {
  theme: IslandTheme;
  selected: boolean;
  onSelect: () => void;
}) {
  // The palette, scoped to this card. Everything inside resolves `--island-*`
  // to THIS theme rather than to the active one.
  const scope = Object.fromEntries(islandThemeDeclarations(theme)) as React.CSSProperties;

  return (
    <button
      type="button"
      onClick={onSelect}
      // `radio` + `aria-checked`, not `aria-pressed`: inside the radiogroup
      // below this is one of a set of mutually exclusive choices, and a toggle
      // role would have a screen reader announce it as independently on/off.
      role="radio"
      aria-checked={selected}
      className={cn(
        "group relative flex w-full flex-col gap-2 rounded-panel border-2 p-2 text-left",
        "transition-transform duration-150 ease-cozy hover:-translate-y-0.5 active:scale-[0.98]",
        "motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-island-cream",
        selected
          ? "border-island-purple bg-island-cream-2 shadow-cozy-raised"
          : "border-island-wood/25 bg-island-cream/60 hover:border-island-wood/45",
      )}
    >
      {/* Miniature of the island under this theme. `aria-hidden` because the
          card's name and state below already say everything a screen reader
          needs; the picture is for the eye. */}
      <div
        style={scope}
        aria-hidden
        className="overflow-hidden rounded-lg border border-island-wood/30 bg-island-page"
      >
        <div className="flex flex-col gap-1.5 p-2.5">
          {/* plaque */}
          <div className="mx-auto h-2 w-16 rounded-full bg-island-sand" />
          {/* panel with two text lines and a CTA */}
          <div className="space-y-1.5 rounded-md border border-island-wood/30 bg-island-cream p-1.5 shadow-cozy-soft">
            <div className="h-1 w-3/4 rounded-full bg-island-ink" />
            <div className="h-1 w-1/2 rounded-full bg-island-ink-soft" />
            <div className="flex items-center gap-1 pt-0.5">
              <div className="h-2.5 w-9 rounded-full bg-island-wood" />
              <div className="h-2.5 w-6 rounded-full bg-island-purple" />
              <div className="h-2.5 w-4 rounded-full bg-island-grass" />
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-start gap-1.5 px-0.5">
        <span aria-hidden className="text-base leading-none">
          {theme.emoji}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-island-ink">{theme.name}</span>
          <span className="block text-xs leading-snug text-island-ink-soft">{theme.description}</span>
        </span>
        {selected && (
          <span
            className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-island-purple text-island-cream"
            aria-hidden
          >
            <Check className="size-3.5" />
          </span>
        )}
      </div>
    </button>
  );
}

export function ThemePicker({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { theme: active, themes, setTheme } = useTheme();
  const container = useFullscreenPortalContainer();

  return (
    <BlobbiModal
      open={open}
      onOpenChange={onOpenChange}
      container={container}
      title="Theme"
      description="Choose how the island looks. Your Blobbi, your world and everything you are doing stay exactly as they are."
    >
      {/*
        A radiogroup rather than a list of buttons: it is a single-choice
        control, and the role is what lets a screen reader announce "2 of 2,
        selected" instead of reading two unrelated toggles. Arrow-key roving
        is not implemented — with two to a handful of cards, Tab is the
        expected and sufficient traversal, and a half-built roving tabindex
        would be worse than none.
      */}
      <div role="radiogroup" aria-label="Island theme" className="grid grid-cols-2 gap-3">
        {themes.map((t) => (
          <ThemeCard
            key={t.id}
            theme={t}
            selected={t.id === active.id}
            onSelect={() => setTheme(t.id)}
          />
        ))}
      </div>

      {/*
        Applied on click, with no Save and no confirmation. A theme is a
        display preference that is fully described by looking at the result,
        and it is reversible in one more click — a commit step would only add
        a decision to a choice that is already visible.
      */}
      <p className="mt-4 text-center text-xs text-island-ink-soft">
        Themes apply straight away and are remembered on this device.
      </p>
    </BlobbiModal>
  );
}
