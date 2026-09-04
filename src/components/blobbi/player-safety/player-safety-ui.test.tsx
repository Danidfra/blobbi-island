/**
 * The safety controls a player actually touches.
 *
 * Three things these assert that the ingest tests cannot: the actions are
 * reachable and correctly labelled, the confirmation says what Block really does
 * (and does not overclaim), and the report flow captures evidence without
 * silently blocking anyone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  clearAllRelationships,
  clearRecentMessages,
  clearStoredReports,
  isBlocked,
  isMuted,
  listReports,
  rememberMessage,
  resetSafetyAccount,
  setPlayerBlocked,
  setPlayerMuted,
  setSafetyAccount,
} from '@/player-safety';

import { PlayerSafetyActions } from './PlayerSafetyActions';
import { SafetySettingsDialog } from './SafetySettingsDialog';
import { playerShortId } from './player-label';

const RUDE = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const ME = 'c'.repeat(64);

function messageEvent(): NostrEvent {
  return {
    id: 'e'.repeat(64),
    kind: 21201,
    pubkey: RUDE,
    created_at: 1_800_000_000,
    sig: 's'.repeat(128),
    content: JSON.stringify({ type: 'chat', text: 'be quiet', location: 'town', ts: 1 }),
    tags: [],
  };
}

function actions(onBlocked = vi.fn()) {
  render(
    <PlayerSafetyActions
      pubkey={RUDE}
      islandId="1"
      location="town"
      reporterPubkey={ME}
      onBlocked={onBlocked}
    />,
  );
  return { onBlocked };
}

beforeEach(() => {
  localStorage.clear();
  resetSafetyAccount();
  setSafetyAccount(ME);
  clearAllRelationships();
  clearStoredReports();
  clearRecentMessages();
});

afterEach(() => {
  localStorage.clear();
  resetSafetyAccount();
  vi.restoreAllMocks();
});

describe('mute', () => {
  it('acts immediately, with no confirmation', () => {
    // Friction here is charged to the person being bothered. Mute is small and
    // obviously reversible, so it just happens.
    actions();
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));

    expect(isMuted(RUDE)).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('relabels itself so the state is readable, not just visual', () => {
    actions();
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));

    const unmute = screen.getByRole('button', { name: 'Unmute' });
    expect(unmute).toHaveAttribute('aria-pressed', 'true');
  });

  it('unmutes on a second press', () => {
    actions();
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unmute' }));

    expect(isMuted(RUDE)).toBe(false);
  });

  it('does not block', () => {
    actions();
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(isBlocked(RUDE)).toBe(false);
  });

  it('reports a storage failure instead of pretending it worked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('nope');
    });
    actions();
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

describe('block', () => {
  it('confirms first, because the effect is larger', () => {
    actions();
    fireEvent.click(screen.getByRole('button', { name: 'Block' }));

    expect(screen.getByRole('dialog', { name: 'Block this player?' })).toBeInTheDocument();
    expect(isBlocked(RUDE)).toBe(false);
  });

  it('explains what it does and what it does not', () => {
    // The honest limit. Blocking is local perception filtering: this client
    // stops showing them, but their client keeps receiving public presence.
    // Claiming otherwise would promise privacy the architecture cannot give.
    actions();
    fireEvent.click(screen.getByRole('button', { name: 'Block' }));

    const dialog = screen.getByRole('dialog', { name: 'Block this player?' });
    expect(dialog.textContent).toContain('It does not hide you from them');
    expect(dialog.textContent).toContain('Settings');
  });

  it('blocks on confirmation and tells the caller to close the card', () => {
    const { onBlocked } = actions();
    fireEvent.click(screen.getByRole('button', { name: 'Block' }));
    fireEvent.click(screen.getByRole('button', { name: 'Block player' }));

    expect(isBlocked(RUDE)).toBe(true);
    expect(onBlocked).toHaveBeenCalledTimes(1);
  });

  it('does nothing on cancel', () => {
    const { onBlocked } = actions();
    fireEvent.click(screen.getByRole('button', { name: 'Block' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(isBlocked(RUDE)).toBe(false);
    expect(onBlocked).not.toHaveBeenCalled();
  });
});

describe('report', () => {
  const openReport = () => {
    actions();
    fireEvent.click(screen.getByRole('button', { name: 'Report' }));
    return screen.getByRole('dialog', { name: 'Report a player' });
  };

  it('offers readable categories rather than protocol vocabulary', () => {
    openReport();
    // The player never sees "profanity" or "nudity"; those are the NIP-56 types
    // the record maps onto underneath.
    expect(screen.getByRole('radio', { name: /Being mean/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Made me feel unsafe/ })).toBeInTheDocument();
    expect(screen.queryByText(/profanity/i)).toBeNull();
  });

  it('will not send without a category', () => {
    openReport();
    fireEvent.click(screen.getByRole('button', { name: 'Save report' }));
    expect(listReports()).toHaveLength(0);
  });

  it('offers the message that is about to disappear, unticked', () => {
    rememberMessage(RUDE, {
      event: messageEvent(),
      messageClass: 'text',
      renderedText: 'be quiet',
      receivedAt: 1,
    });
    openReport();

    // Shown, so the reporter can see what they would be attaching, and NOT
    // attached, because opening a card is not a decision about a message.
    expect(screen.getByTestId('report-evidence').textContent).toBe('be quiet');
    expect(screen.getByTestId('report-include-message')).not.toBeChecked();

    fireEvent.click(screen.getByRole('radio', { name: /Being mean/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save report' }));

    const [stored] = listReports();
    expect(stored.category).toBe('mean');
    expect(stored.evidence).toBeNull();
  });

  it('keeps the message when the reporter asks for it', () => {
    rememberMessage(RUDE, {
      event: messageEvent(),
      messageClass: 'text',
      renderedText: 'be quiet',
      receivedAt: 1,
    });
    openReport();

    fireEvent.click(screen.getByTestId('report-include-message'));
    fireEvent.click(screen.getByRole('radio', { name: /Being mean/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save report' }));

    const [stored] = listReports();
    // A pointer and the rendered meaning; not the event.
    expect(stored.evidence?.eventId).toBe('e'.repeat(64));
    expect(stored.evidence?.renderedText).toBe('be quiet');
    expect(JSON.stringify(stored)).not.toContain('s'.repeat(128));
  });

  it('still files a report when they have not said anything', () => {
    openReport();
    fireEvent.click(screen.getByRole('radio', { name: /Spam/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save report' }));

    const [stored] = listReports();
    expect(stored.evidence).toBeNull();
  });

  it('does NOT block on its own', () => {
    // A control that quietly does a second thing is one the player cannot
    // reason about.
    openReport();
    fireEvent.click(screen.getByRole('radio', { name: /Being mean/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save report' }));

    expect(listReports()).toHaveLength(1);
    expect(isBlocked(RUDE)).toBe(false);
  });

  it('blocks when that is the button chosen, exactly once', () => {
    const { onBlocked } = actions();
    fireEvent.click(screen.getByRole('button', { name: 'Report' }));
    fireEvent.click(screen.getByRole('radio', { name: /Being mean/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save and block' }));

    expect(listReports()).toHaveLength(1);
    expect(isBlocked(RUDE)).toBe(true);
    expect(onBlocked).toHaveBeenCalledTimes(1);
  });

  it('does not promise that anyone will read it', () => {
    // The copy is load-bearing: "our team will review this" is the sentence a
    // distressed child would take at face value, and nothing consumes reports.
    const dialog = openReport();
    expect(dialog.textContent).toContain('saved on this device');
    expect(dialog.textContent?.toLowerCase()).not.toMatch(/our team|will review|moderator/);
  });
});

describe('settings', () => {
  const openSettings = () => {
    render(<SafetySettingsDialog open onOpenChange={() => {}} />);
    return screen.getByRole('dialog', { name: 'Safety' });
  };

  it('has an empty state that says where the controls are', () => {
    const dialog = openSettings();
    expect(dialog.textContent).toContain('Nobody is blocked');
    expect(dialog.textContent).toContain('tap their Blobbi');
  });

  it('lists blocked and muted players separately', () => {
    setPlayerBlocked(RUDE, true);
    setPlayerMuted(OTHER, true);
    openSettings();

    expect(screen.getByRole('button', { name: `Unblock ${playerShortId(RUDE)}` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Unmute ${playerShortId(OTHER)}` })).toBeInTheDocument();
  });

  it('identifies players by key, never by a name they chose', () => {
    // A list built to stop showing you someone's words must not show you their
    // words: and a blocked player could otherwise write into this screen by
    // renaming their Blobbi.
    setPlayerBlocked(RUDE, true);
    const dialog = openSettings();

    expect(dialog.textContent).toContain(playerShortId(RUDE));
    expect(playerShortId(RUDE).startsWith('npub1')).toBe(true);
  });

  it('lists a blocked-and-muted player once, under Blocked', () => {
    // Two rows would offer an Unmute that appears to do nothing, because
    // blocking already silences them.
    setPlayerMuted(RUDE, true);
    setPlayerBlocked(RUDE, true);
    openSettings();

    expect(screen.getByRole('button', { name: `Unblock ${playerShortId(RUDE)}` })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `Unmute ${playerShortId(RUDE)}` })).toBeNull();
  });

  it('unblocks', () => {
    setPlayerBlocked(RUDE, true);
    openSettings();
    fireEvent.click(screen.getByRole('button', { name: `Unblock ${playerShortId(RUDE)}` }));

    expect(isBlocked(RUDE)).toBe(false);
  });

  it('unmutes', () => {
    setPlayerMuted(OTHER, true);
    openSettings();
    fireEvent.click(screen.getByRole('button', { name: `Unmute ${playerShortId(OTHER)}` }));

    expect(isMuted(OTHER)).toBe(false);
  });

  it('is honest about the re-key limitation', () => {
    setPlayerBlocked(RUDE, true);
    const dialog = openSettings();
    expect(dialog.textContent).toContain('brand-new account');
  });
});

describe('accessibility', () => {
  it('gives every safety action a real button and a readable name', () => {
    actions();
    for (const name of ['Mute', 'Block', 'Report']) {
      const button = screen.getByRole('button', { name });
      expect(button.tagName).toBe('BUTTON');
    }
  });

  it('names each list button with the player it acts on', () => {
    // Otherwise a screen reader hears a column of identical "Unblock"s.
    setPlayerBlocked(RUDE, true);
    setPlayerBlocked(OTHER, true);
    render(<SafetySettingsDialog open onOpenChange={() => {}} />);

    expect(screen.getAllByRole('button', { name: /^Unblock npub/ })).toHaveLength(2);
  });

  it('distinguishes the destructive confirmation by its label, not only colour', () => {
    actions();
    fireEvent.click(screen.getByRole('button', { name: 'Block' }));

    expect(screen.getByRole('button', { name: 'Block player' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });
});
