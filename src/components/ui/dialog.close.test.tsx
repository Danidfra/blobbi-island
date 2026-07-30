/**
 * The shared Dialog's built-in close control.
 *
 * WHY THIS FILE EXISTS. `DialogContent` used to render a native `<button>`
 * INSIDE `DialogPrimitive.Close` — which is itself a `<button>`. React reported
 * it every time such a dialog opened (`validateDOMNesting: <button> cannot
 * appear as a descendant of <button>`), and beyond the warning it was two
 * overlapping hit targets carrying two accessible names for one action.
 *
 * The regression is easy to reintroduce, because the wrapper looks harmless:
 * styling the Close directly and styling a child of it render almost
 * identically. So the assertions below are about STRUCTURE (one button, no
 * nesting) as well as behavior, and the console spy fails on React's warning
 * itself rather than on a snapshot of the markup.
 *
 * The warning is never suppressed. `expectNoDomNestingWarnings` asserts React
 * stayed quiet; it does not filter React's output.
 *
 * ON KEYBOARD ACTIVATION. jsdom does not synthesize a click from Enter/Space on
 * a native button the way a browser does, so a `keyDown` assertion here would
 * test jsdom, not the fix. What actually earns keyboard activation is BEING a
 * native, enabled, focusable `<button>` — which is exactly what the nested
 * markup put at risk and what the test asserts. Real keyboard activation is
 * covered in the browser pass.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog';

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

/** Fail on React's DOM-nesting complaint, whatever else was logged. */
function expectNoDomNestingWarnings() {
  const offending = consoleError.mock.calls.filter((call) =>
    call.some(
      (arg) =>
        typeof arg === 'string' &&
        (arg.includes('validateDOMNesting') ||
          arg.includes('cannot appear as a descendant')),
    ),
  );
  expect(offending).toEqual([]);
}

/** The close control is a single, un-nested, natively activatable button. */
async function expectSoleUnnestedCloseButton() {
  const close = await screen.findByRole('button', { name: 'Close' });

  expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(1);
  expect(close.tagName).toBe('BUTTON');
  expect(close.querySelector('button')).toBeNull();
  expect(close.parentElement?.closest('button')).toBeNull();
  expect(close).not.toBeDisabled();
  expect(close.getAttribute('tabindex')).not.toBe('-1');

  expectNoDomNestingWarnings();
  return close;
}

function BasicDialog({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  return (
    <Dialog defaultOpen onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Example</DialogTitle>
        </DialogHeader>
        <p>Body copy</p>
      </DialogContent>
    </Dialog>
  );
}

describe('DialogContent close control', () => {
  it('renders one un-nested close button and logs no DOM-nesting warning', async () => {
    render(<BasicDialog />);
    await expectSoleUnnestedCloseButton();
  });

  it('closes on click', async () => {
    const onOpenChange = vi.fn();
    render(<BasicDialog onOpenChange={onOpenChange} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(screen.queryByText('Body copy')).not.toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const onOpenChange = vi.fn();
    render(<BasicDialog onOpenChange={onOpenChange} />);

    await screen.findByText('Body copy');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('accepts focus, so a keyboard user can reach and activate it', async () => {
    render(<BasicDialog />);

    const close = await expectSoleUnnestedCloseButton();
    close.focus();
    expect(close).toHaveFocus();
  });

  it('restores focus to the trigger after closing', async () => {
    render(
      <Dialog>
        <DialogTrigger data-testid="opener">Open</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Example</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    );

    const opener = screen.getByTestId('opener');
    fireEvent.click(opener);

    const close = await screen.findByRole('button', { name: 'Close' });
    fireEvent.click(close);

    await waitFor(() => expect(opener).toHaveFocus());
    expectNoDomNestingWarnings();
  });

  it('omits the close control for in-frame dialogs', async () => {
    render(
      <Dialog defaultOpen>
        <DialogContent inFrame>
          <DialogTitle>Framed</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    await screen.findByText('Framed');
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    expectNoDomNestingWarnings();
  });

  it('omits the close control when hideDefaultClose is set', async () => {
    render(
      <Dialog defaultOpen>
        <DialogContent hideDefaultClose>
          <DialogTitle>Own controls</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    await screen.findByText('Own controls');
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Real consumers
//
// Every dialog below renders the DEFAULT close control (no `inFrame`, no
// `hideDefaultClose`), so each one emitted the nested-button warning before the
// fix. The auth dialogs are excluded on purpose: they pass `inFrame` and supply
// their own `DialogClose`, so they never rendered the wrapper at all.
// ---------------------------------------------------------------------------

describe('Publish Review dialog', () => {
  it('renders one un-nested close control', async () => {
    const { PublishReviewDialog } = await import(
      '@/components/tools/game-items/PublishReviewDialog'
    );

    const issuer = 'a'.repeat(64);
    const previewEvent: NostrEvent = {
      id: 'e'.repeat(64),
      pubkey: issuer,
      created_at: 1_700_000_000,
      kind: 31632,
      tags: [['d', 'blobbi:cosmetic:example']],
      content: '{}',
      sig: 'f'.repeat(128),
    };

    render(
      <PublishReviewDialog
        open
        onOpenChange={() => undefined}
        identity={{
          mode: 'official',
          pubkey: issuer,
          npub: 'npub1example',
          shortHex: 'aaaaaaaa…aaaaaa',
          isOfficialIssuer: true,
        }}
        address={`31632:${issuer}:blobbi:cosmetic:example`}
        itemName="Example"
        updatesLoadedAddress={false}
        validation={{
          blocking: [],
          protocol: [],
          image: [],
          authoring: [],
          isPublishable: true,
          fieldErrors: {},
        }}
        previewEvent={previewEvent}
        relayUrls={['wss://relay.one']}
        isPublishing={false}
        onPublish={() =>
          Promise.resolve({
            event: previewEvent,
            record: null,
            outcomes: [],
            acceptedRelays: [],
            rejectedRelays: [],
            reachedAnyRelay: false,
          })
        }
      />,
    );

    await expectSoleUnnestedCloseButton();
  });
});

describe('Load Item dialog', () => {
  it('renders one un-nested close control', async () => {
    const { LoadItemDialog } = await import(
      '@/components/tools/game-items/LoadItemDialog'
    );

    render(
      <LoadItemDialog
        open
        onOpenChange={() => undefined}
        signerPubkey={'a'.repeat(64)}
        isLoading={false}
        onLoad={() => Promise.reject(new Error('not used'))}
        onLoaded={() => undefined}
        hasUnsavedWork={false}
      />,
    );

    await expectSoleUnnestedCloseButton();
  });
});

describe('AccessoryRemovalModal (non-tool consumer)', () => {
  it('renders one un-nested close control', async () => {
    const { AccessoryRemovalModal } = await import(
      '@/components/blobbi/AccessoryRemovalModal'
    );

    render(
      <AccessoryRemovalModal
        isOpen
        onClose={() => undefined}
        accessory={{
          code: 'headwear-1',
          x: 50,
          y: 50,
          scale: 1,
          rot: 0,
          flipX: false,
          refw: 100,
          refh: 100,
          form: 'default',
          url: 'https://fixtures.invalid/hat.png',
          slot: 'headwear',
        }}
      />,
    );

    await expectSoleUnnestedCloseButton();
  });
});
