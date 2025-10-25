import React, { useState, useCallback, useRef } from 'react';
import { Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CHAT_MAX_LEN } from '@/lib/chat-config';

interface ChatInputBarProps {
  onSend: (text: string) => Promise<void>;
  disabled?: boolean;
  className?: string;
}

export function ChatInputBar({ onSend, disabled = false, className }: ChatInputBarProps) {
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSend = useCallback(async () => {
    if (isSending || disabled) return;

    // Trim and collapse whitespace
    const trimmed = message.trim().replace(/\s+/g, ' ');
    
    // Prevent empty messages
    if (!trimmed) return;

    // Enforce max length
    const finalText = trimmed.slice(0, CHAT_MAX_LEN);

    try {
      setIsSending(true);
      await onSend(finalText);
      setMessage('');
      // Return focus to input after sending
      inputRef.current?.focus();
    } catch (error) {
      console.error('Failed to send chat message:', error);
    } finally {
      setIsSending(false);
    }
  }, [message, onSend, disabled, isSending]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Stop propagation to prevent triggering world movement
    e.stopPropagation();
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    // Stop propagation to prevent triggering world movement
    e.stopPropagation();
  }, []);

  const isInputDisabled = disabled || isSending;

  return (
    <div
      className={cn(
        "absolute left-1/2 -translate-x-1/2 bottom-3 z-[30]",
        "flex items-center gap-2 p-2 bg-background/95 backdrop-blur-sm",
        "border border-border rounded-full shadow-lg",
        "min-w-[300px] max-w-[400px]",
        className
      )}
      data-block-move
      onPointerDown={handlePointerDown}
      onTouchStart={handleTouchStart}
    >
      <Input
        ref={inputRef}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={isInputDisabled ? "Sending..." : "Type a message..."}
        disabled={isInputDisabled}
        maxLength={CHAT_MAX_LEN}
        className={cn(
          "flex-1 border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0",
          "placeholder:text-muted-foreground"
        )}
        onPointerDown={handlePointerDown}
        onTouchStart={handleTouchStart}
      />
      
      <Button
        onClick={handleSend}
        disabled={isInputDisabled || !message.trim()}
        size="sm"
        className={cn(
          "h-8 w-8 p-0 rounded-full shrink-0",
          "bg-primary hover:bg-primary/90 text-primary-foreground"
        )}
        onPointerDown={handlePointerDown}
        onTouchStart={handleTouchStart}
      >
        <Send className="h-4 w-4" />
        <span className="sr-only">Send message</span>
      </Button>
      
      {/* Character counter */}
      {message.length > CHAT_MAX_LEN * 0.8 && (
        <div className={cn(
          "absolute -top-6 right-2 text-xs",
          message.length >= CHAT_MAX_LEN ? "text-destructive" : "text-muted-foreground"
        )}>
          {message.length}/{CHAT_MAX_LEN}
        </div>
      )}
    </div>
  );
}