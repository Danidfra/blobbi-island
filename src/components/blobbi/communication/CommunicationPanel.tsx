/**
 * Communication V2: the one surface a player says anything from.
 *
 * ## What replaced what
 *
 * The dock used to transform in place into a single text field. That gave
 * everyone exactly one way to communicate, typing, which is slow on a phone,
 * impossible for a child who cannot yet spell, and the only class of message
 * that can carry anything at all. This panel adds three faster ways to say the
 * common things and keeps typing as the fourth.
 *
 * The Family consequence falls out of that rather than being bolted onto it:
 * when `freeTextChat` is off, the Message tab is **absent** and the other three
 * are untouched. Not a disabled box, not an explanation of what the player may
 * not do: three tabs of things they can. A restricted experience that reads as
 * a punishment is one a child works around.
 *
 * ## Why the tabs are built from the policy, not hidden by it
 *
 * `TABS` is derived from capabilities before render, so a tab that is not
 * allowed does not exist in the tablist, has no panel, and cannot be reached by
 * arrow keys or by a stale `value`. Hiding it with CSS would leave a composer
 * mounted, and a mounted composer is one `onSend` away from being reachable.
 *
 * This is presentation only. Nothing here is a security boundary: the send path
 * checks the same capability again (`MultiplayerLayer.sendMessage`), and the
 * receive path checks it for messages this client never sent. See
 * `docs/communication-v2.md`.
 *
 * ## One layout for both pointers
 *
 * A bottom-anchored sheet on a phone and a bottom-anchored panel on a desktop
 * are the same component with a width cap. Nothing depends on hover, every
 * target is at least 44 px, and the panel sits inside the game frame rather than
 * in a portal, the island can be fullscreen, and a portalled overlay would land
 * outside it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Send, X } from 'lucide-react';

import {
  EMOTES,
  QUICK_PHRASES,
  type IslandMessage,
} from '@/communication';
import { CHAT_MAX_LEN } from '@/lib/chat-config';
import { cn } from '@/lib/utils';
import { useIslandSafetyPolicy } from '@/safety';

import { PhraseBuilder } from './PhraseBuilder';

type TabId = 'quick' | 'phrases' | 'emotes' | 'message';

interface Tab {
  readonly id: TabId;
  readonly label: string;
}

interface CommunicationPanelProps {
  open: boolean;
  onClose: () => void;
  /** Publishes the message. Resolves to whether it was actually sent. */
  onSend: (message: IslandMessage) => void | Promise<unknown>;
  className?: string;
}

export function CommunicationPanel({ open, onClose, onSend, className }: CommunicationPanelProps) {
  const policy = useIslandSafetyPolicy();
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');

  const tabs = useMemo<readonly Tab[]>(() => {
    const available: Tab[] = [];
    if (policy.predefinedPhrases) {
      available.push({ id: 'quick', label: 'Quick' });
      available.push({ id: 'phrases', label: 'Phrases' });
    }
    if (policy.emotes) available.push({ id: 'emotes', label: 'Emotes' });
    if (policy.freeTextChat) available.push({ id: 'message', label: 'Message' });
    return available;
  }, [policy]);

  const [active, setActive] = useState<TabId>(() => tabs[0]?.id ?? 'quick');

  // A capability change (or an empty tab list) must never leave a tab selected
  // that no longer exists, the panel would render nothing at all.
  useEffect(() => {
    if (!tabs.some((tab) => tab.id === active)) setActive(tabs[0]?.id ?? 'quick');
  }, [tabs, active]);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  const send = useCallback(
    (outgoing: IslandMessage) => {
      void onSend(outgoing);
      // One-tap classes are one-shot: sending closes the panel so the player is
      // looking at the world when their bubble appears, and so a grid of emotes
      // is not sitting under a finger that is already tapping.
      if (outgoing.type !== 'text') onClose();
    },
    [onSend, onClose],
  );

  const sendText = useCallback(() => {
    const trimmed = message.trim().replace(/\s+/g, ' ');
    if (!trimmed) return;
    send({ type: 'text', text: trimmed.slice(0, CHAT_MAX_LEN) });
    // Typing is a conversation: clear the field and keep it focused rather than
    // closing, so a reply does not cost another two taps.
    setMessage('');
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [message, send]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Communication"
      tabIndex={-1}
      data-block-move
      data-testid="communication-panel"
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
      className={cn(
        'pointer-events-auto w-full max-w-[28rem] rounded-2xl',
        'border border-island-wood/30 bg-island-cream-2/97 shadow-cozy-raised backdrop-blur-sm',
        'animate-in fade-in slide-in-from-bottom-2 duration-200',
        'focus:outline-none',
        className,
      )}
    >
      <div className="flex items-center gap-1 border-b border-island-wood/15 px-1.5 py-1.5">
        <div role="tablist" aria-label="Ways to talk" className="flex min-w-0 flex-1 gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`communication-tab-${tab.id}`}
              aria-selected={active === tab.id}
              aria-controls={`communication-panel-${tab.id}`}
              onClick={() => setActive(tab.id)}
              className={cn(
                'min-h-[2.25rem] flex-1 rounded-full px-2 text-xs font-semibold',
                'transition-transform duration-150 ease-cozy active:scale-95',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                // Both states use pairs the theme contract guarantees
                // (`contrastReport`): cream on wood-dark for the selected tab,
                // cream on ocean was 1.9:1 in Cozy Day, and ink on the
                // cream panel for the rest.
                active === tab.id
                  ? 'bg-island-wood-dark text-island-cream'
                  : 'text-island-ink hover:bg-island-cream',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close communication"
          className={cn(
            'inline-flex size-9 shrink-0 items-center justify-center rounded-full',
            'text-island-ink transition-transform duration-150 ease-cozy',
            'hover:bg-island-cream active:scale-95',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      <div
        role="tabpanel"
        id={`communication-panel-${active}`}
        aria-labelledby={`communication-tab-${active}`}
        className="max-h-[45vh] overflow-y-auto p-2"
      >
        {active === 'quick' && (
          <ul className="grid grid-cols-2 gap-1.5">
            {QUICK_PHRASES.map((phrase) => (
              <li key={phrase.id}>
                <button
                  type="button"
                  onClick={() => send({ type: 'quick', phrase: phrase.id })}
                  className={cn(
                    'w-full rounded-xl px-3 py-2.5 text-sm font-medium',
                    'min-h-[2.75rem] border border-island-wood/25 bg-island-cream/70 text-island-ink',
                    'transition-transform duration-150 ease-cozy hover:bg-island-cream active:scale-[0.98]',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  )}
                >
                  {phrase.text}
                </button>
              </li>
            ))}
          </ul>
        )}

        {active === 'phrases' && <PhraseBuilder onSend={send} />}

        {active === 'emotes' && (
          <ul className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
            {EMOTES.map((emote) => (
              <li key={emote.id}>
                <button
                  type="button"
                  onClick={() => send({ type: 'emote', emote: emote.id })}
                  // The glyph is decorative; the label IS the control's name.
                  // Without this an emote grid is seven identically-named
                  // buttons to a screen reader.
                  aria-label={emote.label}
                  title={emote.label}
                  className={cn(
                    'flex size-full min-h-[2.75rem] items-center justify-center rounded-xl text-2xl',
                    'border border-island-wood/25 bg-island-cream/70',
                    'transition-transform duration-150 ease-cozy hover:bg-island-cream active:scale-95',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  )}
                >
                  <span aria-hidden="true">{emote.glyph}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {active === 'message' && (
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              sendText();
            }}
          >
            <label htmlFor="communication-message" className="sr-only">
              Message
            </label>
            <input
              id="communication-message"
              ref={inputRef}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              // The world listens for keystrokes; this field must not feed it.
              onKeyDown={(event) => event.stopPropagation()}
              placeholder="Type a message..."
              maxLength={CHAT_MAX_LEN}
              autoComplete="off"
              className={cn(
                'min-h-[2.75rem] min-w-0 flex-1 rounded-xl border border-island-wood/25 bg-island-cream/70 px-3 text-sm',
                'text-island-ink placeholder:text-island-ink-soft',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
            />
            <button
              type="submit"
              disabled={!message.trim()}
              aria-label="Send message"
              className={cn(
                'inline-flex size-11 shrink-0 items-center justify-center rounded-full',
                'bg-island-wood-dark text-island-cream transition-transform duration-150 ease-cozy',
                'hover:brightness-105 active:scale-95',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'disabled:pointer-events-none disabled:opacity-40',
              )}
            >
              <Send className="size-4" aria-hidden="true" />
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
