import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { BlobbiModal } from '@/components/ui/blobbi-modal';
import { ItemTile } from '@/components/ui/item-tile';
import { cn } from '@/lib/utils';
import {
  BADGE_ACQUISITION_LABELS,
  BADGE_CATALOG,
  acquireBadge,
  badgesByAcquisition,
  stockedAcquisitions,
  type BadgeAcquisition,
  type BadgeRecord,
} from '@/badges';

/**
 * The Badges Store's shop window.
 *
 * ## Built for three acquisition types, stocked with none
 *
 * The store is designed to sell Purchasable badges, hand over Achievement
 * badges you have earned, and hand over Mission badges you have completed. The
 * card, the tabs, the states and the action button all exist for those three.
 *
 * What does not exist is a badge protocol. `src/badges/badge-catalog.ts` carries
 * the full audit: no badge kind, no award event, no claim semantics, no mission
 * system, and no badge category inside kind:31632. So {@link BADGE_CATALOG} is
 * empty and this modal shows an empty state that says exactly that.
 *
 * Inventing six plausible badges would have filled the screen and put fiction
 * where a player reads facts, and unlike a layout mistake, a fabricated badge
 * that reaches a relay cannot be edited back out. The Clothing Store hit the
 * same wall from the other side and answered it the same way.
 *
 * ## Which tabs appear
 *
 * Only the acquisition types actually stocked, and only when there is more than
 * one. A "Missions" tab over an empty list implies a mission system exists,
 * which is the impression this store must not create. With an empty catalog
 * there are no tabs at all.
 *
 * ## Opening this is write-free
 *
 * This module imports no publisher, no signer, no wallet and no inventory
 * mutation. The only door out is {@link acquireBadge}, which is itself
 * write-free today and refuses every branch with a reason. Browsing cannot
 * publish anything, and there is no local ownership store to drift out of sync,
 * `owned` comes from the record or stays `null`, which means UNKNOWN and is
 * rendered as unknown rather than as "no".
 */

interface BadgesStoreModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ALL = 'all';

/** What a card's action button is currently saying. */
type CardState = 'owned' | 'unavailable' | 'locked' | 'available';

function cardState(badge: BadgeRecord): CardState {
  if (badge.owned) return 'owned';
  if (badge.acquisition === 'purchase') {
    return badge.price === undefined ? 'unavailable' : 'available';
  }
  // Earned badges are claimable only when the source says the requirement is
  // met. Unknown progress is LOCKED, never "ready": a claim button that might
  // not work is worse than one that says why it cannot.
  return badge.progress === 1 ? 'available' : 'locked';
}

export function BadgesStoreModal({ isOpen, onClose }: BadgesStoreModalProps) {
  const [tab, setTab] = useState<BadgeAcquisition | typeof ALL>(ALL);
  const [notice, setNotice] = useState<string | null>(null);

  const tabs = useMemo(() => stockedAcquisitions(BADGE_CATALOG), []);
  const visible = useMemo(
    () =>
      tab === ALL ? BADGE_CATALOG : badgesByAcquisition(BADGE_CATALOG, tab),
    [tab],
  );

  /**
   * Every action button routes here, and here routes to the domain adapter.
   *
   * The branch on acquisition type lives in `src/badges/badge-acquisition.ts`,
   * not in this file: a modal that knew how to publish a purchase would be the
   * first place the next one gets written too.
   */
  const handleAcquire = (badge: BadgeRecord) => {
    const result = acquireBadge({
      badgeId: badge.id,
      acquisition: badge.acquisition,
    });
    setNotice(result.outcome === 'unsupported' ? result.reason : null);
  };

  if (!isOpen) return null;

  return (
    <BlobbiModal
      open={isOpen}
      onOpenChange={(next) => !next && onClose()}
      presentation="in-frame"
      size="lg"
      title="Badges Store"
      description="Earn it. Show it. Be proud."
      icon="🏅"
      bodyClassName="flex min-h-0 flex-col gap-3 p-3 sm:p-4"
      footer={
        <Button variant="soft" onClick={onClose} className="min-h-[44px]">
          Done
        </Button>
      }
    >
      {notice && (
        <p
          role="status"
          data-badges-store-notice
          className="shrink-0 rounded-panel bg-island-danger/10 px-3 py-2 text-center text-sm text-island-danger"
        >
          {notice}
        </p>
      )}

      {tabs.length > 1 && (
        <div
          role="radiogroup"
          aria-label="Badge type"
          className="flex shrink-0 gap-1.5 overflow-x-auto [scrollbar-width:thin]"
        >
          {[ALL, ...tabs].map((key) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={tab === key}
              data-badges-store-tab={key}
              onClick={() => setTab(key as BadgeAcquisition | typeof ALL)}
              className={cn(
                'min-h-[44px] shrink-0 rounded-full border-2 px-3 text-xs font-bold',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
                tab === key
                  ? 'border-accent bg-accent text-accent-foreground'
                  : 'border-island-wood/30 bg-island-cream/70 text-island-ink',
              )}
            >
              {key === ALL
                ? 'All'
                : BADGE_ACQUISITION_LABELS[key as BadgeAcquisition]}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {BADGE_CATALOG.length === 0 ? (
          /*
            The intentional empty state. It says what the store is for, and it
            says plainly that no badge exists to hand over yet, rather than
            filling the case with invented merchandise.
          */
          <div
            data-badges-store-empty
            className="flex h-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-island-wood/30 p-6 text-center"
          >
            <span aria-hidden className="text-4xl">
              🏅
            </span>
            <p role="status" className="text-sm text-island-ink-soft">
              The cases are polished and empty. No badges have been minted yet,
              when they are, this is where you will buy them, claim the ones you
              have earned, and collect your mission rewards.
            </p>
            <p className="text-[0.6875rem] text-island-ink-soft">
              Nothing here is bought or awarded today. Browsing changes nothing.
            </p>
          </div>
        ) : (
          <ul className="grid list-none grid-cols-2 gap-2.5 sm:grid-cols-3">
            {visible.map((badge) => {
              const state = cardState(badge);
              return (
                <li key={badge.id} className="min-w-0">
                  <ItemTile
                    data-badges-store-item={badge.id}
                    data-acquisition={badge.acquisition}
                    data-state={state}
                    name={badge.name}
                    price={badge.price}
                    selected={badge.owned === true}
                    art={
                      badge.image ? (
                        <img src={badge.image} alt="" />
                      ) : (
                        <span>{badge.symbol}</span>
                      )
                    }
                    footnote={
                      badge.requirement ??
                      BADGE_ACQUISITION_LABELS[badge.acquisition]
                    }
                  >
                    <p className="mt-1 text-[0.6875rem] text-island-ink-soft">
                      {badge.description}
                    </p>
                    <Button
                      variant={state === 'owned' ? 'soft' : 'accent'}
                      onClick={() => handleAcquire(badge)}
                      disabled={state !== 'available'}
                      className="mt-1 min-h-[36px] w-full text-xs"
                      data-badges-store-action={badge.id}
                    >
                      {state === 'owned'
                        ? 'Owned'
                        : state === 'unavailable'
                          ? 'Not for sale'
                          : state === 'locked'
                            ? 'Not earned yet'
                            : badge.acquisition === 'purchase'
                              ? `Buy for ${badge.price}`
                              : 'Claim'}
                    </Button>
                  </ItemTile>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </BlobbiModal>
  );
}
