import { useMemo, useState } from "react";
import { AlertTriangle, Check, Loader2, Palette, Plus, Sparkles, WifiOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { useThemeSelection } from "@/hooks/useThemeSelection";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { BlobbiModal } from "@/components/ui/blobbi-modal";
import { StateCard } from "@/components/ui/state-card";
import { Button } from "@/components/ui/button";
import { RelaySelector } from "@/components/RelaySelector";
import { islandThemeDeclarations, type IslandTheme } from "@/lib/island-themes";
import { useFullscreenPortalContainer } from "@/contexts/FullscreenPortalContext";
import { useCommunityThemes, useMyThemes } from "@/hooks/useNostrThemes";
import { contrastFailures } from "@/lib/island-theme-adapter";
import type { CoreThemeColors, NostrThemeDefinition } from "@/lib/nostr-theme";
import { ThemeCreateDialog } from "@/components/shell/ThemeCreateDialog";

/**
 * ThemePicker — Settings › Appearance › Themes.
 *
 * ## Where this sits
 *
 * Blobbi Island has no Settings *page*; the account menu IS the settings
 * surface, and it is a 288px dropdown on desktop and a compact modal in
 * landscape. Neither has room for a grid of theme cards, and a theme is chosen
 * by looking at it, so the browser is its own modal opened from an Appearance
 * row.
 *
 * ## Three sections, because a theme's provenance changes what you do with it
 *
 * ```
 *   Built in       ships with the game, always available, never unreachable
 *   Yours          kind:36767 events you published — editable, removable
 *   Community      kind:36767 events anyone published — usable, not yours
 * ```
 *
 * They are sections of one list rather than tabs because the question the
 * player is answering ("which island do I want") does not change between them,
 * and a tab would hide two thirds of the answer behind a click.
 *
 * ## The previews theme themselves
 *
 * Each card writes the theme's OWN palette onto itself as inline custom
 * properties, then renders a miniature of the real thing out of the same
 * `island-*` tokens every surface in the game uses. Nothing is hand-coloured,
 * so a preview cannot drift from what choosing the theme actually does; if a
 * card looks wrong, the theme IS wrong. This is the same scoping trick as
 * Ditto's `ScopedTheme`, applied to a card instead of a container — and,
 * crucially, it is scoped: looking at a community theme cannot repaint the app.
 * Only pressing it does.
 */

/** The miniature island. Pure token references; the scope decides the colours. */
function ThemeMiniature() {
  return (
    <div className="flex flex-col gap-1.5 p-2.5">
      {/* plaque */}
      <div className="mx-auto h-2 w-16 rounded-full bg-island-sand" />
      {/* panel with two text lines and a CTA row */}
      <div className="space-y-1.5 rounded-md border border-island-wood/30 bg-island-cream p-1.5 shadow-cozy-soft">
        <div className="h-1 w-3/4 rounded-full bg-island-ink" />
        <div className="h-1 w-1/2 rounded-full bg-island-ink-soft" />
        <div className="flex items-center gap-1 pt-0.5">
          <div className="h-2.5 w-9 rounded-full bg-island-wood-dark" />
          <div className="h-2.5 w-6 rounded-full bg-island-purple" />
          <div className="h-2.5 w-4 rounded-full bg-island-grass" />
        </div>
      </div>
    </div>
  );
}

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

  // A community theme is a stranger's three colours run through the adapter.
  // The adapter solves for contrast, but a genuinely impossible palette (a
  // mid-grey everything) can still come out short — so the card says so rather
  // than letting the player find out after applying it.
  const failures = useMemo(() => contrastFailures(theme.palette), [theme.palette]);

  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={`theme-card-${theme.id}`}
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
      {/* `aria-hidden` because the card's name and state below already say
          everything a screen reader needs; the picture is for the eye. */}
      <div
        style={scope}
        aria-hidden
        className="overflow-hidden rounded-lg border border-island-wood/30 bg-island-page"
      >
        <ThemeMiniature />
      </div>

      <div className="flex items-start gap-1.5 px-0.5">
        <span aria-hidden className="text-base leading-none">
          {theme.emoji}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-island-ink">{theme.name}</span>
          <span className="block line-clamp-2 text-xs leading-snug text-island-ink-soft">
            {theme.description || (theme.source === 'nostr' ? 'A theme from Nostr.' : '')}
          </span>
          {failures.length > 0 && (
            <span className="mt-1 inline-flex items-center gap-1 text-[0.6875rem] font-medium text-island-danger">
              <AlertTriangle aria-hidden className="size-3" />
              Low contrast
            </span>
          )}
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

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-2">
        <h3 className="text-[0.6875rem] font-bold uppercase tracking-wider text-island-ink-soft">
          {title}
        </h3>
        {hint ? <span className="text-[0.6875rem] text-island-ink-soft/80">{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function ThemePicker({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { theme: active, themeId, themes, selectTheme, isUnavailable, isResolving } =
    useThemeSelection();
  const container = useFullscreenPortalContainer();
  const { user } = useCurrentUser();
  const community = useCommunityThemes();
  const mine = useMyThemes();
  const [createOpen, setCreateOpen] = useState(false);

  /**
   * Apply a Nostr theme.
   *
   * The definition's ORIGINAL three colours are handed along so the published
   * selection carries the author's values rather than Island's derivation of
   * them — a round trip through sixteen and back to three would drift the
   * theme a little every time it was chosen.
   */
  const selectNostr = (theme: IslandTheme, definitions: Map<string, NostrThemeDefinition>) => {
    const colors: CoreThemeColors | undefined = theme.address
      ? definitions.get(theme.address)?.colors
      : undefined;
    selectTheme(theme, colors);
  };

  // The player's own themes are excluded from the community list — they are
  // already in "Yours" above it, and the same card twice reads as a duplicate.
  const communityThemes = useMemo(() => {
    const ownAddresses = new Set((mine.data?.themes ?? []).map((t) => t.id));
    return (community.data?.themes ?? []).filter((t) => !ownAddresses.has(t.id));
  }, [community.data, mine.data]);

  const myThemes = mine.data?.themes ?? [];

  return (
    <>
      <BlobbiModal
        open={open}
        onOpenChange={onOpenChange}
        container={container}
        size="lg"
        title="Themes"
        description="Choose how the island looks. Your Blobbi, your world and everything you are doing stay exactly as they are."
        icon={<Palette />}
        footer={
          <Button
            type="button"
            onClick={() => setCreateOpen(true)}
            disabled={!user}
            data-testid="open-theme-create"
          >
            <Plus aria-hidden className="size-4" />
            {user ? 'Create a theme' : 'Sign in to create a theme'}
          </Button>
        }
      >
        <div className="space-y-6">
          {/*
            The one state worth interrupting for: the stored selection is a
            community theme that could not be read AND was never cached, so the
            island is showing something the player did not choose. Every other
            unavailability is survived silently by the cached palette.
          */}
          {isUnavailable && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-xl border border-island-warn/40 bg-island-warn/10 p-3 text-xs text-island-ink"
            >
              <WifiOff aria-hidden className="mt-0.5 size-3.5 shrink-0 text-island-warn" />
              <div className="space-y-1">
                <p className="font-semibold">Your theme could not be loaded</p>
                <p className="text-island-ink-soft">
                  The island is showing {active.name} for now. Your choice is remembered — it will
                  come back when the relay does.
                </p>
              </div>
            </div>
          )}

          <Section title="Built in" hint="always available">
            <div role="radiogroup" aria-label="Built-in themes" className="grid grid-cols-2 gap-3">
              {themes.map((t) => (
                <ThemeCard
                  key={t.id}
                  theme={t}
                  selected={t.id === active.id && !isUnavailable}
                  onSelect={() => selectTheme(t)}
                />
              ))}
            </div>
          </Section>

          {user && (
            <Section title="Yours" hint="published from this account">
              {mine.isLoading ? (
                <StateCard kind="loading" compact title="Looking for your themes…" />
              ) : myThemes.length === 0 ? (
                <p className="rounded-xl border border-dashed border-island-wood/30 p-4 text-center text-xs text-island-ink-soft">
                  You have not published a theme yet.
                </p>
              ) : (
                <div role="radiogroup" aria-label="Your themes" className="grid grid-cols-2 gap-3">
                  {myThemes.map((t) => (
                    <ThemeCard
                      key={t.id}
                      theme={t}
                      selected={t.id === themeId}
                      onSelect={() => selectNostr(t, mine.data!.definitions)}
                    />
                  ))}
                </div>
              )}
            </Section>
          )}

          <Section title="From the community" hint="published on Nostr">
            {community.isLoading ? (
              <StateCard kind="loading" compact title="Looking for themes…" />
            ) : communityThemes.length === 0 ? (
              // The island's standard empty state: no themes found is very often
              // "this relay has none", and the fix is a different relay.
              <div className="space-y-3 rounded-xl border border-dashed border-island-wood/30 p-4 text-center">
                <p className="text-xs text-island-ink-soft">
                  No themes found here yet. Try another relay?
                </p>
                <RelaySelector className="w-full" />
              </div>
            ) : (
              <div
                role="radiogroup"
                aria-label="Community themes"
                className="grid grid-cols-2 gap-3"
              >
                {communityThemes.map((t) => (
                  <ThemeCard
                    key={t.id}
                    theme={t}
                    selected={t.id === themeId}
                    onSelect={() => selectNostr(t, community.data!.definitions)}
                  />
                ))}
              </div>
            )}
          </Section>

          {isResolving && (
            <p className="flex items-center justify-center gap-2 text-xs text-island-ink-soft">
              <Loader2 aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />
              Checking your theme for updates…
            </p>
          )}

          {/*
            Applied on click, with no Save and no confirmation. A theme is a
            display preference that is fully described by looking at the result,
            and it is reversible in one more click — a commit step would only add
            a decision to a choice that is already visible.
          */}
          <p className="flex items-center justify-center gap-1.5 text-center text-xs text-island-ink-soft">
            <Sparkles aria-hidden className="size-3" />
            {user
              ? 'Themes apply straight away, and your choice follows you to other devices.'
              : 'Themes apply straight away and are remembered on this device.'}
          </p>
        </div>
      </BlobbiModal>

      <ThemeCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
