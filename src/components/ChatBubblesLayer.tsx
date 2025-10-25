import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

export interface ChatBubble {
  id: string;
  playerKey: string;
  text: string;
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
    setVisibleBubbles(next);
  }, [bubbles, getAnchorEl]); // não precisamos de RAF; seguimos o DOM da âncora

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

  return (
    <div className={cn("absolute inset-0 pointer-events-none z-[25]", className)}>
      {Array.from(visibleBubbles.values()).map(({ bubble, anchorEl, isExpiring }) =>
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
      <div className={cn(
        "relative max-w-[220px] px-3 py-2",
        "bg-white border border-gray-200 rounded-2xl shadow-lg",
        "text-sm text-gray-900 break-words"
      )}>
        {/* Bubble content */}
        <div className="whitespace-pre-wrap">
          {bubble.text}
        </div>

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