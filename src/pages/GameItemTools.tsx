/**
 * `/tools/game-items` — the internal Game Item authoring and diagnostic tool.
 *
 * ## Access policy
 *
 * The page ships in the production bundle and is reachable by direct URL. It is
 * NOT linked from anywhere in the game, but that is discoverability, not
 * security: the real boundary is that publishing requires a signature from an
 * account the user controls, and the game's catalog independently rejects every
 * definition not signed by `OFFICIAL_ITEM_ISSUER_PUBKEY`. Hiding a link would
 * add nothing to either.
 *
 * Signed out, everything works except publishing and Blossom uploads. Signed in
 * with a key that is not the official issuer, publishing works and is labelled
 * as third-party in the header, in the review dialog and on every browser row —
 * see `signer-identity.ts` for why allowing that is the honest behavior.
 *
 * ## Owning the shared state
 *
 * The three tabs are separate components but share one editor: opening an item
 * from the browser or the inventory inspector loads it into the studio and
 * switches tabs. That is why `useItemStudio` is mounted here rather than inside
 * `ItemStudio` — the tab that hands work to the editor must be able to reach it.
 *
 * Nothing on this page reloads. Publishing writes into the query cache, and
 * every list is a TanStack query that reacts to a newer event, an account
 * change or a relay change on its own.
 */

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

import { InventoryInspector } from '@/components/tools/game-items/InventoryInspector';
import { ItemStudio } from '@/components/tools/game-items/ItemStudio';
import { PublishedItemsBrowser } from '@/components/tools/game-items/PublishedItemsBrowser';
import { SignerBanner } from '@/components/tools/game-items/SignerBanner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/hooks/useToast';
import { OFFICIAL_ITEM_ISSUER_PUBKEY } from '@/inventory/constants';
import { useIslandInventory, inventoryQueryKey } from '@/inventory/useIslandInventory';
import { asNewItem, eventToForm } from '@/tools/game-items/form-event-conversion';
import { buildInspectorRows } from '@/tools/game-items/inventory-inspection';
import { describeSigner } from '@/tools/game-items/signer-identity';
import {
  useItemDefinitionsByAddress,
  useItemDefinitionsByAuthor,
  useRefreshDefinitions,
  useToolRelayUrls,
  type PublishedDefinitionRecord,
} from '@/tools/game-items/useItemDefinitions';
import { useItemStudio } from '@/tools/game-items/useItemStudio';

type ToolTab = 'studio' | 'published' | 'inventory';

export function GameItemTools() {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const identity = useMemo(() => describeSigner(user?.pubkey), [user?.pubkey]);
  const relayUrls = useToolRelayUrls();
  const studio = useItemStudio(user?.pubkey);
  const [tab, setTab] = useState<ToolTab>('studio');

  // The browser always shows the official issuer's items, plus the signer's own
  // when they are somebody else. One query, one key.
  const authors = useMemo(
    () =>
      [...new Set([OFFICIAL_ITEM_ISSUER_PUBKEY, user?.pubkey].filter(Boolean))] as string[],
    [user?.pubkey],
  );
  const definitions = useItemDefinitionsByAuthor(authors);
  const refreshDefinitions = useRefreshDefinitions();

  // --- Inventory inspector data -------------------------------------------
  const inventory = useIslandInventory();
  const inventoryAddresses = useMemo(
    () => inventory.data?.items.map((item) => item.address) ?? [],
    [inventory.data],
  );
  const inventoryDefinitions = useItemDefinitionsByAddress(inventoryAddresses);
  const inventoryRows = useMemo(
    () => buildInspectorRows(inventory.data, inventoryDefinitions.data),
    [inventory.data, inventoryDefinitions.data],
  );

  const openInEditor = (record: PublishedDefinitionRecord) => {
    const result = studio.loadEvent(record.event, record.relays);
    if (!result.ok) {
      toast({
        title: 'Could not open that item',
        description: result.error,
        variant: 'destructive',
      });
      return;
    }
    setTab('studio');
    toast({ title: `Editing ${record.definition.name}` });
  };

  const useAsTemplate = (record: PublishedDefinitionRecord) => {
    const parsed = eventToForm(record.event, { relays: record.relays });
    if (!parsed.ok) {
      toast({
        title: 'Could not use that item as a template',
        description: parsed.error,
        variant: 'destructive',
      });
      return;
    }
    studio.replaceForm(asNewItem(parsed.form, { derivedFrom: record.address }));
    setTab('studio');
    toast({
      title: `Template from ${record.definition.name}`,
      description: 'A based_on reference was added. Change the d tag before publishing.',
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50/60 to-background dark:from-slate-950 dark:to-background">
      <div className="mx-auto w-full max-w-[1400px] space-y-4 p-3 sm:p-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
              Game Item Tools
            </h1>
            <p className="text-xs text-muted-foreground">
              Author kind:31632 definitions and inspect kind:31633 inventories.
              Internal tooling — not part of the game.
            </p>
          </div>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs hover:bg-accent"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to the island
          </Link>
        </header>

        <SignerBanner identity={identity} relayUrls={relayUrls} />

        <Tabs value={tab} onValueChange={(value) => setTab(value as ToolTab)}>
          <TabsList className="grid w-full grid-cols-3 sm:max-w-lg">
            <TabsTrigger value="studio">Item Studio</TabsTrigger>
            <TabsTrigger value="published">Published Items</TabsTrigger>
            <TabsTrigger value="inventory">Inventory Inspector</TabsTrigger>
          </TabsList>

          <TabsContent value="studio" className="pt-4">
            <ItemStudio studio={studio} identity={identity} relayUrls={relayUrls} />
          </TabsContent>

          <TabsContent value="published" className="pt-4">
            <PublishedItemsBrowser
              records={definitions.data ?? []}
              isLoading={definitions.isLoading}
              isFetching={definitions.isFetching}
              error={definitions.error as Error | null}
              signerPubkey={identity.pubkey}
              onRefresh={refreshDefinitions}
              onOpenInEditor={openInEditor}
              onUseAsTemplate={useAsTemplate}
            />
          </TabsContent>

          <TabsContent value="inventory" className="pt-4">
            <InventoryInspector
              inventory={inventory.data}
              rows={inventoryRows}
              ownerPubkey={identity.pubkey}
              isLoading={inventory.isLoading || inventoryDefinitions.isLoading}
              isFetching={inventory.isFetching || inventoryDefinitions.isFetching}
              error={(inventory.error ?? inventoryDefinitions.error) as Error | null}
              signerPubkey={identity.pubkey}
              onRefresh={() => {
                queryClient.invalidateQueries({
                  queryKey: inventoryQueryKey(identity.pubkey ?? undefined),
                });
                refreshDefinitions();
              }}
              onOpenInEditor={openInEditor}
              onUseAsTemplate={useAsTemplate}
            />
          </TabsContent>
        </Tabs>

        <footer className="pb-6 pt-2 text-center text-[11px] text-muted-foreground">
          Vibed with{' '}
          <a
            href="https://soapbox.pub/mkstack"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-foreground"
          >
            MKStack
          </a>
        </footer>
      </div>
    </div>
  );
}

export default GameItemTools;
