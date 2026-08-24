import { useMemo, useState } from "react";
import { AlertTriangle, Paintbrush } from "lucide-react";

import { cn } from "@/lib/utils";
import { BlobbiModal } from "@/components/ui/blobbi-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/useToast";
import { useThemeSelection } from "@/hooks/useThemeSelection";
import { useFullscreenPortalContainer } from "@/contexts/FullscreenPortalContext";
import { usePublishTheme } from "@/hooks/useThemePublish";
import { contrastReport, paletteFromCoreColors } from "@/lib/island-theme-adapter";
import { islandThemeDeclarations, islandThemeFromNostr } from "@/lib/island-themes";
import {
  THEME_DESCRIPTION_MAX,
  THEME_TITLE_MAX,
  hexToHslTriplet,
  hslTripletToHex,
  isValidHexColor,
  titleToSlug,
  type CoreThemeColors,
} from "@/lib/nostr-theme";

/**
 * ThemeCreateDialog — "Create a theme".
 *
 * ## Three colours, not sixteen
 *
 * The form edits exactly what the public protocol carries: `background`, `text`
 * and `primary`. Island's other thirteen palette roles are an implementation
 * detail of this client — derived, deterministic, never published — and putting
 * them in this form would produce themes only Blobbi Island could read, which
 * is the opposite of the point. A theme made here is a plain kind:36767 event
 * that Ditto renders as its author intended.
 *
 * ## The preview is the real thing, scoped
 *
 * The colours are run through the same adapter the applier uses and written
 * onto a container as custom properties, so what the player is looking at while
 * they drag a colour picker IS the island they will get. Nothing global changes
 * until they publish and select — editing a draft must not repaint the app.
 *
 * ## Contrast is reported, not enforced
 *
 * Publishing is never blocked. The adapter already solves each role for
 * readability, so a bad input mostly produces a legible-but-ugly island rather
 * than an unusable one; where it cannot, the form says which pairing is short
 * and by how much before the player publishes. Blocking would mean Island
 * refusing to create themes Ditto happily accepts.
 */

const DEFAULT_DRAFT = {
  background: '#fff8ec',
  text: '#3a2a1a',
  primary: '#6b4fd6',
};

function ColorField({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-semibold text-island-ink">
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="size-9 shrink-0 cursor-pointer rounded-lg border border-island-wood/30 bg-island-cream p-0.5"
        />
        <Input
          aria-label={`${label} hex value`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          className="h-9 font-mono text-xs"
        />
      </div>
      <p className="text-[0.6875rem] leading-snug text-island-ink-soft">{hint}</p>
    </div>
  );
}

export function ThemeCreateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const container = useFullscreenPortalContainer();
  const { toast } = useToast();
  const { selectTheme } = useThemeSelection();
  const publish = usePublishTheme();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [draft, setDraft] = useState(DEFAULT_DRAFT);

  /**
   * The draft as core colours, with each field falling back to the default when
   * it is mid-edit.
   *
   * A half-typed `#ab` must not blank the preview — the player is watching it
   * while they type — so an invalid field keeps the last valid default rather
   * than propagating `NaN` into a custom property.
   */
  const colors: CoreThemeColors = useMemo(
    () => ({
      background: hexToHslTriplet(
        isValidHexColor(draft.background) ? draft.background : DEFAULT_DRAFT.background,
      ),
      text: hexToHslTriplet(isValidHexColor(draft.text) ? draft.text : DEFAULT_DRAFT.text),
      primary: hexToHslTriplet(
        isValidHexColor(draft.primary) ? draft.primary : DEFAULT_DRAFT.primary,
      ),
    }),
    [draft],
  );

  const palette = useMemo(() => paletteFromCoreColors(colors), [colors]);
  const findings = useMemo(() => contrastReport(palette), [palette]);
  const failures = findings.filter((f) => !f.passes);

  const scope = useMemo(
    () =>
      Object.fromEntries(
        islandThemeDeclarations({
          id: 'draft',
          name: title || 'Untitled',
          description,
          emoji: '✨',
          palette,
          source: 'nostr',
        }),
      ) as React.CSSProperties,
    [palette, title, description],
  );

  const slug = titleToSlug(title);
  const canPublish = !!slug && !publish.isPending;

  const handlePublish = async () => {
    try {
      const result = await publish.mutateAsync({ title, description, colors });
      // Apply it immediately — the player just designed this island, showing it
      // to them is the entire point, and the selection publish carries the
      // ORIGINAL three colours rather than a re-derivation.
      selectTheme(
        islandThemeFromNostr({
          address: result.address,
          pubkey: result.address.split(':')[1],
          title: title.trim(),
          description,
          palette,
        }),
        colors,
      );
      toast({
        title: 'Theme published',
        description: `${title.trim()} is live and applied.`,
      });
      onOpenChange(false);
      setTitle('');
      setDescription('');
      setDraft(DEFAULT_DRAFT);
    } catch (error) {
      toast({
        title: 'Could not publish',
        description: error instanceof Error ? error.message : 'The relay would not take it.',
        variant: 'destructive',
      });
    }
  };

  return (
    <BlobbiModal
      open={open}
      onOpenChange={onOpenChange}
      container={container}
      size="lg"
      title="Create a theme"
      description="Three colours. The island works out the rest — and so does any other client that reads Nostr themes."
      icon={<Paintbrush />}
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handlePublish}
            disabled={!canPublish}
            data-testid="publish-theme"
          >
            {publish.isPending ? 'Publishing…' : 'Publish & apply'}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="theme-title" className="text-xs font-semibold text-island-ink">
              Name
            </Label>
            <Input
              id="theme-title"
              value={title}
              maxLength={THEME_TITLE_MAX}
              placeholder="Harbour Dusk"
              onChange={(e) => setTitle(e.target.value)}
            />
            <p className="text-[0.6875rem] leading-snug text-island-ink-soft">
              {slug
                ? `Published as ${slug} — republishing with the same name updates this theme.`
                : 'Needed. Also becomes the theme’s identifier.'}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="theme-description" className="text-xs font-semibold text-island-ink">
              Description
            </Label>
            <Input
              id="theme-description"
              value={description}
              maxLength={THEME_DESCRIPTION_MAX}
              placeholder="Optional"
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <ColorField
            id="theme-background"
            label="Background"
            hint="The page. Everything else is spaced away from it."
            value={draft.background}
            onChange={(background) => setDraft((d) => ({ ...d, background }))}
          />
          <ColorField
            id="theme-text"
            label="Text"
            hint="Body text. Adjusted if it would be unreadable on a panel."
            value={draft.text}
            onChange={(text) => setDraft((d) => ({ ...d, text }))}
          />
          <ColorField
            id="theme-primary"
            label="Primary"
            hint="Buttons, prices, the frame and the focus ring come from this."
            value={draft.primary}
            onChange={(primary) => setDraft((d) => ({ ...d, primary }))}
          />
        </div>

        <div className="space-y-3">
          <p className="text-[0.6875rem] font-bold uppercase tracking-wider text-island-ink-soft">
            Preview
          </p>
          {/* Scoped, not global: designing a theme must not repaint the app. */}
          <div
            style={scope}
            data-testid="theme-draft-preview"
            className="overflow-hidden rounded-panel border-2 border-island-wood/30 bg-island-page"
          >
            <div className="space-y-2 p-3">
              <div className="mx-auto h-2.5 w-20 rounded-full bg-island-sand" />
              <div className="space-y-2 rounded-lg border border-island-wood/30 bg-island-cream p-2.5 shadow-cozy-soft">
                <div className="h-2 w-3/4 rounded-full bg-island-ink" />
                <div className="h-1.5 w-1/2 rounded-full bg-island-ink-soft" />
                <div className="flex items-center gap-1.5 pt-1">
                  <div className="h-5 w-16 rounded-full bg-island-wood-dark" />
                  <div className="h-5 w-12 rounded-full bg-island-purple" />
                  <div className="h-5 w-8 rounded-full bg-island-grass" />
                </div>
              </div>
              <div className="rounded-lg border border-island-wood/30 bg-island-cream-2 p-2">
                <div className="h-1.5 w-2/3 rounded-full bg-island-ink-soft" />
              </div>
            </div>
          </div>

          <ul className="space-y-1">
            {findings.map((finding) => (
              <li
                key={finding.what}
                className={cn(
                  'flex items-center justify-between gap-2 text-[0.6875rem]',
                  finding.passes ? 'text-island-ink-soft' : 'text-island-danger',
                )}
              >
                <span className="truncate">{finding.what}</span>
                <span className="shrink-0 font-mono">
                  {finding.ratio}:1 / {finding.min}
                </span>
              </li>
            ))}
          </ul>

          {failures.length > 0 && (
            <p className="flex items-start gap-1.5 rounded-lg border border-island-danger/30 bg-island-danger/10 p-2 text-[0.6875rem] text-island-danger">
              <AlertTriangle aria-hidden className="mt-0.5 size-3 shrink-0" />
              <span>
                {failures.length} pairing{failures.length === 1 ? '' : 's'} below AA. You can still
                publish — other clients derive their own colours from yours.
              </span>
            </p>
          )}

          <p className="text-[0.6875rem] leading-snug text-island-ink-soft">
            Published as a Nostr theme (kind 36767), so Ditto and any other client that reads them
            can use it too. Colours are stored as{' '}
            <code className="font-mono">{hslTripletToHex(colors.primary)}</code>-style hex.
          </p>
        </div>
      </div>
    </BlobbiModal>
  );
}
