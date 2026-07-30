/**
 * The Item Studio: editor on the left, live preview on the right, publish bar
 * at the bottom.
 *
 * This component composes; it does not compute. Form state, event building and
 * validation all live in `useItemStudio`, which is why each section below can
 * be handed a slice and a setter and stay unaware that a Nostr event exists.
 *
 * On a narrow screen the two columns stack, preview first-after-editor rather
 * than hidden — an authoring tool that drops the preview on mobile is a tool
 * you cannot check your work in.
 */

import { useState } from 'react';
import {
  CircleAlert,
  Copy,
  Download,
  FilePlus2,
  Save,
  Send,
  Trash2,
} from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/useToast';
import { blankItemForm } from '@/tools/game-items/item-form-model';
import { asNewItem } from '@/tools/game-items/form-event-conversion';
import { useItemImageUpload } from '@/tools/game-items/image-upload';
import { usePublishItemDefinition } from '@/tools/game-items/usePublishItemDefinition';
import {
  useLoadItemDefinition,
  type PublishedDefinitionRecord,
} from '@/tools/game-items/useItemDefinitions';
import type { ItemStudioApi } from '@/tools/game-items/useItemStudio';
import type { SignerIdentity } from '@/tools/game-items/signer-identity';

import { AdvancedTagsSection } from './AdvancedTagsSection';
import { ClassificationSection } from './ClassificationSection';
import { ContentEditor } from './ContentEditor';
import { DerivationSection } from './DerivationSection';
import { ImageManager } from './ImageManager';
import { ItemIdentitySection } from './ItemIdentitySection';
import { ItemPreviewPanel } from './ItemPreviewPanel';
import { EventValidationPanel } from './EventValidationPanel';
import { LoadItemDialog } from './LoadItemDialog';
import { MediaSection } from './MediaSection';
import { PublishReviewDialog } from './PublishReviewDialog';
import { RawEventInspector } from './RawEventInspector';

export interface ItemStudioProps {
  studio: ItemStudioApi;
  identity: SignerIdentity;
  relayUrls: readonly string[];
}

export function ItemStudio({ studio, identity, relayUrls }: ItemStudioProps) {
  const { toast } = useToast();
  const { form, patch, replaceForm, validation, previewEvent, address, drafts, probes } =
    studio;

  const [reviewOpen, setReviewOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);

  const uploads = useItemImageUpload();
  const publish = usePublishItemDefinition();
  const loadDefinition = useLoadItemDefinition();

  const isReadOnlyAuthor =
    form.loaded !== null &&
    identity.pubkey !== null &&
    form.loaded.pubkey !== identity.pubkey;

  const handleLoaded = (record: PublishedDefinitionRecord) => {
    const result = studio.loadEvent(record.event, record.relays);
    if (!result.ok) {
      toast({
        title: 'Could not load that item',
        description: result.error,
        variant: 'destructive',
      });
      return;
    }
    toast({
      title: `Loaded ${record.definition.name}`,
      description:
        result.value.length > 0
          ? `${result.value.length} parser warning(s) — see the validation panel.`
          : 'All fields populated. Unknown tags are preserved.',
    });
  };

  return (
    <div className="space-y-4">
      {/* --- Draft / load toolbar ------------------------------------------ */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card px-3 py-2 shadow-sm">
        <Badge variant="outline" className="gap-1.5 text-[10px]">
          <Save className="h-3 w-3" />
          {drafts.savedAt
            ? `Draft saved ${new Date(drafts.savedAt).toLocaleTimeString()}`
            : 'Not saved yet'}
        </Badge>

        {form.loaded && (
          <Badge variant="secondary" className="text-[10px]">
            editing {form.loaded.eventId.slice(0, 10)}…
          </Badge>
        )}

        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setLoadOpen(true)}
          >
            <Download className="h-3.5 w-3.5" />
            Load published
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              drafts.duplicateActiveDraft(form);
              toast({ title: 'Draft duplicated' });
            }}
          >
            <Copy className="h-3.5 w-3.5" />
            Duplicate draft
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              replaceForm(blankItemForm());
              drafts.clearActiveDraft();
              toast({ title: 'Editor cleared' });
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </Button>
        </div>
      </div>

      {drafts.restoreError && (
        <Alert variant="destructive">
          <CircleAlert className="h-4 w-4" />
          <AlertDescription className="text-xs">{drafts.restoreError}</AlertDescription>
        </Alert>
      )}

      {isReadOnlyAuthor && (
        <Alert className="border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40">
          <CircleAlert className="h-4 w-4" />
          <AlertDescription className="space-y-2 text-xs">
            <p>
              This definition was published by another key. You cannot replace
              somebody else&rsquo;s addressable event — publishing would create your
              own item at your own address.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                replaceForm(
                  asNewItem(form, { derivedFrom: form.loaded?.address }),
                );
                toast({
                  title: 'Derived item created',
                  description: 'A based_on reference to the original was added.',
                });
              }}
            >
              <FilePlus2 className="h-3.5 w-3.5" />
              Use as template (adds based_on)
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* --- Editor + preview ---------------------------------------------- */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-4">
          <ItemIdentitySection
            form={form}
            patch={patch}
            fieldErrors={validation.fieldErrors}
            address={address}
            dLocked={form.loaded !== null}
            onCreateAsNew={() => {
              replaceForm(asNewItem(form));
              toast({
                title: 'Now creating a new item',
                description: 'Change the d tag to give it its own identity.',
              });
            }}
          />

          <ClassificationSection
            form={form}
            patch={patch}
            fieldErrors={validation.fieldErrors}
          />

          <ImageManager
            images={form.images}
            actions={studio.images}
            probes={probes}
            uploads={uploads}
            canUpload={identity.mode !== 'unauthenticated'}
          />

          <ContentEditor
            content={form.content}
            onChange={(content) => patch({ content })}
            error={validation.fieldErrors.content}
          />

          <MediaAndDerivation
            form={form}
            patch={patch}
            fieldErrors={validation.fieldErrors}
          />

          <AdvancedTagsSection
            extraTags={form.extraTags}
            onChange={(extraTags) => patch({ extraTags })}
          />
        </div>

        <div className="min-w-0 space-y-4 xl:sticky xl:top-4 xl:self-start">
          <section className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm">
            <h3 className="text-sm font-semibold tracking-tight">Live preview</h3>
            <ItemPreviewPanel form={form} probes={probes} />
          </section>

          <section className="rounded-2xl border bg-card p-4 shadow-sm">
            <EventValidationPanel validation={validation} />
          </section>

          <RawEventInspector
            event={previewEvent}
            title="Unsigned event"
            warnings={[]}
          />
        </div>
      </div>

      {/* --- Publish bar ---------------------------------------------------- */}
      <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 rounded-2xl border bg-card/95 px-4 py-3 shadow-lg backdrop-blur">
        <div className="min-w-0 flex-1 text-xs">
          {identity.mode === 'unauthenticated' ? (
            <span className="text-muted-foreground">
              Sign in to publish. Everything else on this page works signed out.
            </span>
          ) : !validation.isPublishable ? (
            <span className="text-destructive">
              {validation.blocking.length} blocking error(s) — see the validation panel.
            </span>
          ) : (
            <span className="break-all font-mono text-muted-foreground">{address}</span>
          )}
        </div>
        <Button
          type="button"
          className="gap-1.5"
          disabled={
            identity.mode === 'unauthenticated' ||
            !validation.isPublishable ||
            !address
          }
          onClick={() => setReviewOpen(true)}
        >
          <Send className="h-4 w-4" />
          Review publication
        </Button>
      </div>

      <PublishReviewDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        identity={identity}
        address={address}
        itemName={form.name}
        updatesLoadedAddress={studio.updatesLoadedAddress}
        validation={validation}
        previewEvent={previewEvent}
        relayUrls={relayUrls}
        isPublishing={publish.isPending}
        onPublish={async () => {
          if (!studio.build.ok) throw new Error(studio.build.error);
          const result = await publish.mutateAsync({ template: studio.build.value });
          if (result.reachedAnyRelay) {
            toast({
              title: 'Published',
              description: `Accepted by ${result.acceptedRelays.length} relay(s).`,
            });
            // Rebind the editor to the event that now exists, so a follow-up
            // publish is understood as replacing this address rather than
            // creating a new one.
            studio.loadEvent(result.event, result.acceptedRelays);
          } else {
            toast({
              title: 'No relay accepted the event',
              description: 'The form is untouched — you can try again.',
              variant: 'destructive',
            });
          }
          return result;
        }}
      />

      <LoadItemDialog
        open={loadOpen}
        onOpenChange={setLoadOpen}
        signerPubkey={identity.pubkey}
        isLoading={loadDefinition.isPending}
        onLoad={(value) => loadDefinition.mutateAsync(value)}
        onLoaded={handleLoaded}
        hasUnsavedWork={studio.isDirty && drafts.hasMeaningfulDraft(form)}
      />
    </div>
  );
}

/** Media and derivation share a row on wide screens; both are short. */
function MediaAndDerivation({
  form,
  patch,
  fieldErrors,
}: {
  form: ItemStudioApi['form'];
  patch: ItemStudioApi['patch'];
  fieldErrors: Readonly<Record<string, string>>;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <MediaSection form={form} patch={patch} />
      <DerivationSection form={form} patch={patch} fieldErrors={fieldErrors} />
    </div>
  );
}
