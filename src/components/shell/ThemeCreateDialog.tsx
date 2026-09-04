import { useMemo, useState } from "react";
import { AlertTriangle, Paintbrush } from "lucide-react";

import { cn } from "@/lib/utils";
import { playerFacingMessage } from "@/lib/player-facing-error";
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
import { previewFontStack } from "@/lib/island-theme-media";
import {
  THEME_DESCRIPTION_MAX,
  THEME_TITLE_MAX,
  hexToHslTriplet,
  isValidHexColor,
  sanitizeCssIdentifier,
  sanitizeThemeUrl,
  titleToSlug,
  type CoreThemeColors,
  type ThemeConfig,
} from "@/lib/nostr-theme";

/**
 * ThemeCreateDialog — "Create a theme".
 *
 * ## The interoperable schema, not Island's internals
 *
 * The form edits exactly what the public protocol carries: three colours, an
 * optional body font, and an optional background image. Island's other thirteen
 * palette roles are an implementation detail of this client — derived,
 * deterministic, never published — and putting them in this form would produce
 * themes only Blobbi Island could read, which is the opposite of the point. A
 * theme made here is a plain kind:36767 event that Ditto renders as its author
 * intended, font and wallpaper included.
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

/** Background display modes, as Ditto defines them. */
const BACKGROUND_MODES = [
  { value: 'cover' as const, label: 'Cover' },
  { value: 'tile' as const, label: 'Tile' },
];

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
  /** Ditto's `font.family` — a CSS family name, not a stylesheet URL. */
  const [fontFamily, setFontFamily] = useState('');
  /** Ditto's `font.url` — a direct link to a font FILE, https only. */
  const [fontUrl, setFontUrl] = useState('');
  const [backgroundUrl, setBackgroundUrl] = useState('');
  const [backgroundMode, setBackgroundMode] = useState<'cover' | 'tile'>('cover');

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

  /**
   * The draft as the interoperable `ThemeConfig` that gets published.
   *
   * Font and background are included only when they are USABLE: an https URL,
   * a family that survives the CSS allowlist. A half-typed value simply is not
   * in the config yet, which is also why the preview never flickers through an
   * invalid state.
   */
  const config: ThemeConfig = useMemo(() => {
    const next: ThemeConfig = { title: title.trim() || undefined, colors };
    const family = sanitizeCssIdentifier(fontFamily);
    if (family) {
      const url = sanitizeThemeUrl(fontUrl);
      next.font = url ? { family, url } : { family };
    }
    const bg = sanitizeThemeUrl(backgroundUrl);
    if (bg) next.background = { url: bg, mode: backgroundMode };
    return next;
  }, [title, colors, fontFamily, fontUrl, backgroundUrl, backgroundMode]);

  const palette = useMemo(() => paletteFromCoreColors(colors), [colors]);
  const findings = useMemo(() => contrastReport(palette), [palette]);
  const failures = findings.filter((f) => !f.passes);

  // The draft's own type, scoped to the preview — so a font typed into the form
  // is visible before it is published, and only inside the preview box.
  const previewBodyFont = previewFontStack(config.font);

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
      const result = await publish.mutateAsync({ title, description, config });
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
          config,
        }),
      );
      toast({
        title: 'Theme published',
        description: `${title.trim()} is live and applied.`,
      });
      onOpenChange(false);
      setTitle('');
      setDescription('');
      setDraft(DEFAULT_DRAFT);
      setFontFamily('');
      setFontUrl('');
      setBackgroundUrl('');
      setBackgroundMode('cover');
    } catch (error) {
      toast({
        title: 'Could not publish',
        description: playerFacingMessage(error, "We couldn't publish your theme right now. Try again in a moment."),
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

          {/*
            Font and background are the other two fields the protocol carries.
            Both are optional, both are published exactly as Ditto publishes
            them, and both are validated before they enter the config — an
            unusable value is simply absent rather than silently broken.
          */}
          <div className="space-y-1.5">
            <Label htmlFor="theme-font-family" className="text-xs font-semibold text-island-ink">
              Font <span className="font-normal text-island-ink-soft">(optional)</span>
            </Label>
            <Input
              id="theme-font-family"
              value={fontFamily}
              maxLength={64}
              placeholder="Playfair Display"
              onChange={(e) => setFontFamily(e.target.value)}
            />
            <Input
              aria-label="Font file URL"
              value={fontUrl}
              maxLength={512}
              placeholder="https://…/font.woff2"
              spellCheck={false}
              onChange={(e) => setFontUrl(e.target.value)}
              className="font-mono text-xs"
            />
            <p className="text-[0.6875rem] leading-snug text-island-ink-soft">
              A CSS family name, and a direct https link to a font file (.woff2, .ttf, .otf) — not
              a stylesheet. Without a link the font only shows for people who have it installed.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="theme-bg-url" className="text-xs font-semibold text-island-ink">
              Background image <span className="font-normal text-island-ink-soft">(optional)</span>
            </Label>
            <Input
              id="theme-bg-url"
              value={backgroundUrl}
              maxLength={512}
              placeholder="https://…/wallpaper.jpg"
              spellCheck={false}
              onChange={(e) => setBackgroundUrl(e.target.value)}
              className="font-mono text-xs"
            />
            <div role="radiogroup" aria-label="Background mode" className="flex gap-1.5">
              {BACKGROUND_MODES.map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  role="radio"
                  aria-checked={backgroundMode === mode.value}
                  onClick={() => setBackgroundMode(mode.value)}
                  className={cn(
                    'rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    backgroundMode === mode.value
                      ? 'border-island-purple bg-island-purple/10 text-island-ink'
                      : 'border-island-wood/30 text-island-ink-soft hover:border-island-wood/50',
                  )}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            <p className="text-[0.6875rem] leading-snug text-island-ink-soft">
              https only. On the island it dresses the page around the game window — the world
              keeps its own art.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-[0.6875rem] font-bold uppercase tracking-wider text-island-ink-soft">
            Preview
          </p>
          {/* Scoped, not global: designing a theme must not repaint the app. */}
          <div
            style={{ ...scope, fontFamily: previewBodyFont }}
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
            Published as a Nostr theme (kind 36767) — colours as hex, the font as an{' '}
            <code className="font-mono">f</code> tag and the image as a{' '}
            <code className="font-mono">bg</code> tag, exactly as Ditto writes them. Any client
            that reads Nostr themes can use it.
          </p>
        </div>
      </div>
    </BlobbiModal>
  );
}
