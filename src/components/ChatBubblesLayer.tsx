import React, { useEffect, useState, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { bubbleTextEquivalent, type CommunicationBubble } from '@/communication';

export interface ChatBubble {
  id: string;
  playerKey: string;
  /**
   * The RESOLVED presentation model; never a raw event payload.
   *
   * Structured messages (quick phrases, templates, emotes) are reconstructed
   * from this build's own catalogs before they get here, so nothing in this
   * component can render a string an author chose. Free text is the one class
   * whose words come from the sender, which is exactly what the `freeTextChat`
   * capability governs.
   */
  content: CommunicationBubble;
  expiresAt: number;
  createdAt: number;
}

interface ChatBubblesLayerProps {
  bubbles: Map<string, ChatBubble>;
  getAnchorEl: (playerKey: string) => HTMLElement | null;
  className?: string;
}

interface BubbleState {
  bubble: ChatBubble;
  isExpiring: boolean;
  anchorEl: HTMLElement | null;
}

export function ChatBubblesLayer({
  bubbles,
  getAnchorEl,
  className
}: ChatBubblesLayerProps) {
  const [visibleBubbles, setVisibleBubbles] = useState<Map<string, BubbleState>>(new Map());
  const timeoutRefs = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const mapsAreShallowEqual = (
    a: Map<string, BubbleState>,
    b: Map<string, BubbleState>
  ) => {
    if (a.size !== b.size) return false;
    for (const [key, va] of a) {
      const vb = b.get(key);
      if (!vb) return false;
      // Compara identidade do bubble (id), flag e âncora
      if (
        va.bubble.id !== vb.bubble.id ||
        va.isExpiring !== vb.isExpiring ||
        va.anchorEl !== vb.anchorEl
      ) {
        return false;
      }
    }
    return true;
  };

  useEffect(() => {
    const now = Date.now();
    const next = new Map<string, BubbleState>();
    for (const [key, bubble] of bubbles) {
      if (now > bubble.expiresAt) continue;
      next.set(key, {
        bubble,
        isExpiring: visibleBubbles.get(key)?.isExpiring ?? false,
        anchorEl: getAnchorEl(bubble.playerKey),
      });
    }
    setVisibleBubbles(prev => (mapsAreShallowEqual(prev, next) ? prev : next));
  }, [bubbles, getAnchorEl]);

  // Handle bubble lifecycle (show/hide with animations)
  useEffect(() => {
    for (const [key, bubble] of bubbles) {
      if (timeoutRefs.current.has(key)) {
        continue; // Already scheduled
      }

      const now = Date.now();
      const timeUntilExpiry = bubble.expiresAt - now;

      if (timeUntilExpiry <= 0) {
        continue; // Already expired
      }

      // Schedule fade-out animation before expiry
      const fadeOutDelay = Math.max(0, timeUntilExpiry - 300); // Start fade 300ms before expiry
      const fadeOutTimeout = setTimeout(() => {
        setVisibleBubbles(prev => {
          const updated = new Map(prev);
          const existing = updated.get(key);
          if (existing) {
            updated.set(key, { ...existing, isExpiring: true });
          }
          return updated;
        });

        // Remove completely after fade animation
        setTimeout(() => {
          setVisibleBubbles(prev => {
            const updated = new Map(prev);
            updated.delete(key);
            return updated;
          });
          timeoutRefs.current.delete(key);
        }, 300);
      }, fadeOutDelay);

      timeoutRefs.current.set(key, fadeOutTimeout);
    }

    // Clean up timeouts for removed bubbles
    for (const [key, timeout] of timeoutRefs.current) {
      if (!bubbles.has(key)) {
        clearTimeout(timeout);
        timeoutRefs.current.delete(key);
      }
    }

    return () => {
      // Clean up all timeouts on unmount
      for (const timeout of timeoutRefs.current.values()) {
        clearTimeout(timeout);
      }
      timeoutRefs.current.clear();
    };
  }, [bubbles]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      for (const timeout of timeoutRefs.current.values()) {
        clearTimeout(timeout);
      }
      timeoutRefs.current.clear();
    };
  }, []);

  const renderList = useMemo(() => Array.from(visibleBubbles.values()), [visibleBubbles]);

  return (
    <div className={cn("absolute inset-0 pointer-events-none z-[25]", className)}>
      {renderList.map(({ bubble, anchorEl, isExpiring }) =>
        anchorEl
          ? createPortal(
              <ChatBubbleElement key={bubble.id} bubble={bubble} isExpiring={isExpiring} />,
              anchorEl
            )
          : null
      )}
    </div>
  );
}

interface ChatBubbleElementProps { bubble: ChatBubble; isExpiring: boolean; }

function ChatBubbleElement({ bubble, isExpiring }: ChatBubbleElementProps) {
  const [isVisible, setIsVisible] = useState(false);
  const content = bubble.content;
  const isEmote = content.type === 'emote';

  // Trigger entrance animation
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      className={cn(
        "absolute left-1/2 top-0 -translate-x-1/2 -translate-y-full",
        "pointer-events-none", // não bloqueia interação
        "transition-opacity duration-300 ease-out",
        isVisible && !isExpiring ? "opacity-100" : "opacity-0"
      )}
      style={{ marginTop: '-18px' }}
    >
      {/* Speech bubble */}
      <div
        className={cn(
          "relative max-w-[220px]",
          "bg-white border border-gray-200 rounded-2xl shadow-lg",
          "text-sm text-gray-900 break-words",
          // An emote is a picture, not a sentence: it gets a tighter, squarer
          // bubble so a single glyph does not sit in a paragraph-shaped box.
          isEmote ? "px-3 py-1.5" : "px-3 py-2",
        )}
        // The whole bubble is one utterance. Announcing it as a labelled group
        // is what makes an emote, which has no readable text node at all,
        // reach a screen reader as "Clap" rather than as a stray glyph.
        role="status"
        aria-label={bubbleTextEquivalent(content)}
      >
        {/* Bubble content */}
        {content.type === 'emote' ? (
          <div className="text-2xl leading-none text-center" aria-hidden="true">
            {content.glyph}
          </div>
        ) : (
          <div className="whitespace-pre-wrap">{content.text}</div>
        )}

        {/* Speech bubble tail */}
        <div className={cn(
          "absolute top-full left-1/2 -translate-x-1/2",
          "w-0 h-0 border-l-[8px] border-r-[8px] border-t-[8px]",
          "border-l-transparent border-r-transparent border-t-white"
        )} />

        {/* Tail border */}
        <div className={cn(
          "absolute top-full left-1/2 -translate-x-1/2 translate-y-[-1px]",
          "w-0 h-0 border-l-[9px] border-r-[9px] border-t-[9px]",
          "border-l-transparent border-r-transparent border-t-gray-200"
        )} />
      </div>
    </div>
  );
}