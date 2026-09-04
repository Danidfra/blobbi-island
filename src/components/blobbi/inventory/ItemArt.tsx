import { useState } from 'react';

import { primaryItemImageUrl } from '@/inventory/item-image-resolution';
import type { ResolvedBlobbiItemDefinition } from '@/inventory/catalog-fallback';

/**
 * An item's artwork, following the catalog's documented resolution order:
 * definition PRIMARY image → `emoji`.
 *
 * "Primary" is load-bearing now that a definition may publish several `image`
 * tags: an inventory cell is a compact, unposed collection cell, so it always
 * wants the item's default picture and never a pose-specific view, a hat's
 * `side-left` artwork in a grid would misrepresent the item. See
 * `docs/game-item-image-views.md`.
 *
 * Generic on purpose: it takes a resolved definition and knows nothing about
 * which item it is drawing, so every current and future item with artwork gets
 * the same treatment.
 *
 * The image is a REMOTE asset, so it can fail (host down, offline, blocked). A
 * failed load falls back to the emoji rather than leaving a broken-image glyph,
 * matching how the rest of the catalog always degrades to something renderable.
 * Art is the first thing this inventory shows, so it must never show nothing.
 */
export function ItemArt({ definition }: { definition: ResolvedBlobbiItemDefinition }) {
  const [failed, setFailed] = useState(false);
  const url = primaryItemImageUrl(definition);

  if (url && !failed) {
    return (
      <img
        src={url}
        alt=""
        aria-hidden
        className="h-full w-auto object-contain"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span role="img" aria-label={definition.name}>
      {definition.emoji}
    </span>
  );
}
