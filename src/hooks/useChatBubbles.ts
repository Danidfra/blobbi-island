import { useState, useCallback, useRef, useEffect } from 'react';
import { CHAT_BUBBLE_MS, CHAT_PLAYER_GRACE_MS } from '@/lib/chat-config';
import type { ChatBubble } from '@/components/ChatBubblesLayer';

interface QueuedBubble {
  playerKey: string;
  text: string;
  expiresAt: number;
  queuedAt: number;
}

export function useChatBubbles() {
  const [bubbles, setBubbles] = useState<Map<string, ChatBubble>>(new Map());
  const [queuedBubbles, setQueuedBubbles] = useState<QueuedBubble[]>([]);
  const gcIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const dedupeMapRef = useRef<Map<string, number>>(new Map());

  // Show a bubble for a specific player
  const showBubble = useCallback((playerKey: string, text: string, expiresAt?: number) => {
    const now = Date.now();
    const finalExpiresAt = expiresAt || (now + CHAT_BUBBLE_MS);
    
    // Generate a unique ID for this bubble
    const id = `${playerKey}-${now}-${Math.random().toString(36).substr(2, 9)}`;
    
    const bubble: ChatBubble = {
      id,
      playerKey,
      text,
      expiresAt: finalExpiresAt,
      createdAt: now,
    };

    setBubbles(prev => {
      const updated = new Map(prev);
      
      // Remove any existing bubble for this player
      for (const [existingId, existingBubble] of prev) {
        if (existingBubble.playerKey === playerKey) {
          updated.delete(existingId);
        }
      }
      
      // Add the new bubble
      updated.set(id, bubble);
      return updated;
    });

    return id;
  }, []);

  // Queue a bubble for a player that might not be visible yet
  const queueBubble = useCallback((playerKey: string, text: string, expiresAt?: number) => {
    const now = Date.now();
    const finalExpiresAt = expiresAt || (now + CHAT_BUBBLE_MS);
    
    const queuedBubble: QueuedBubble = {
      playerKey,
      text,
      expiresAt: finalExpiresAt,
      queuedAt: now,
    };

    setQueuedBubbles(prev => {
      // Remove any existing queued bubble for this player
      const filtered = prev.filter(b => b.playerKey !== playerKey);
      return [...filtered, queuedBubble];
    });
  }, []);

  // Try to show queued bubbles when players become available
  const processQueuedBubbles = useCallback((isPlayerVisible: (playerKey: string) => boolean) => {
    const now = Date.now();
    
    setQueuedBubbles(prev => {
      const remaining: QueuedBubble[] = [];
      
      for (const queuedBubble of prev) {
        // Check if bubble has expired while queued
        if (now > queuedBubble.expiresAt) {
          continue; // Drop expired bubbles
        }
        
        // Check if we've been waiting too long
        if (now - queuedBubble.queuedAt > CHAT_PLAYER_GRACE_MS) {
          continue; // Drop bubbles that have been queued too long
        }
        
        // Check if player is now visible
        if (isPlayerVisible(queuedBubble.playerKey)) {
          // Show the bubble
          showBubble(queuedBubble.playerKey, queuedBubble.text, queuedBubble.expiresAt);
        } else {
          // Keep in queue
          remaining.push(queuedBubble);
        }
      }
      
      return remaining;
    });
  }, [showBubble]);

  // Clear all bubbles
  const clearBubbles = useCallback(() => {
    setBubbles(new Map());
    setQueuedBubbles([]);
  }, []);

  // Remove a specific bubble
  const removeBubble = useCallback((id: string) => {
    setBubbles(prev => {
      const updated = new Map(prev);
      updated.delete(id);
      return updated;
    });
  }, []);

  // Dedupe messages by a key for a short window
  const isDuplicate = useCallback((dedupeKey: string, windowMs: number = 2000): boolean => {
    const now = Date.now();
    const lastSeen = dedupeMapRef.current.get(dedupeKey);
    
    if (lastSeen && (now - lastSeen) < windowMs) {
      return true; // Duplicate within window
    }
    
    dedupeMapRef.current.set(dedupeKey, now);
    
    // Clean up old entries
    for (const [key, timestamp] of dedupeMapRef.current) {
      if (now - timestamp > windowMs * 2) {
        dedupeMapRef.current.delete(key);
      }
    }
    
    return false;
  }, []);

  // Set up garbage collection for expired bubbles
  useEffect(() => {
    gcIntervalRef.current = setInterval(() => {
      const now = Date.now();
      
      setBubbles(prev => {
        const updated = new Map(prev);
        let hasChanges = false;
        
        for (const [id, bubble] of prev) {
          if (now > bubble.expiresAt) {
            updated.delete(id);
            hasChanges = true;
          }
        }
        
        return hasChanges ? updated : prev;
      });
      
      // Also clean up queued bubbles
      setQueuedBubbles(prev => {
        const filtered = prev.filter(b => now <= b.expiresAt && (now - b.queuedAt) <= CHAT_PLAYER_GRACE_MS);
        return filtered.length !== prev.length ? filtered : prev;
      });
    }, 1000);

    return () => {
      if (gcIntervalRef.current) {
        clearInterval(gcIntervalRef.current);
      }
    };
  }, []);

  return {
    bubbles,
    queuedBubbles,
    showBubble,
    queueBubble,
    processQueuedBubbles,
    clearBubbles,
    removeBubble,
    isDuplicate,
  };
}