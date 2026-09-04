/**
 * The Nostr Hub: the Nostr Station's one interface.
 *
 * A Tron-styled terminal over the room with four sections the player expands
 * in place: Educational, Connected Experiences, Social and the Future Box.
 * Connected Experiences is the live one: it holds Nostr Farm, the first
 * independent Nostr app that works with Blobbi Island
 * (`nostr-station/ConnectedExperiencesSection.tsx`). The other three keep
 * their place as the Station's promise of what comes next.
 *
 * The VR chairs open the hub straight into a section (`initialSection`), so
 * sitting down at a terminal lands the player on the thing the terminal is
 * for. Everything about the frame, the section navigation, the close button,
 * the backdrop and the Escape key lives here and only here; a section owns
 * its content and nothing about the window.
 */
import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import { ConnectedExperiencesSection } from '@/components/blobbi/nostr-station/ConnectedExperiencesSection';

export type NostrHubSectionId = 'educational' | 'connected-experiences' | 'social' | 'futuristic';

interface NostrHubModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The section to open expanded, if any. Read each time the hub opens. */
  initialSection?: NostrHubSectionId | null;
}

// Tron-inspired animation classes
const tronGlow = 'transition-all duration-500 ease-out hover:shadow-[0_0_20px_currentColor] hover:shadow-cyan-400/50';
const tronPulse = 'animate-pulse hover:animate-none';
const tronBorder = 'border border-cyan-400/30 hover:border-cyan-400/80 shadow-[0_0_10px_rgba(34,211,238,0.3)]';

// Card data structure with Tron-inspired styling
interface HubCard {
  id: NostrHubSectionId;
  title: string;
  description: string;
  icon: string;
  primaryColor: string;
  glowColor: string;
  borderColor: string;
  /** The section's content when expanded; absent for a section not yet built. */
  content?: React.ComponentType;
}

const hubCards: HubCard[] = [
  {
    id: 'educational',
    title: 'Educational',
    description: 'Learn & Explore',
    icon: '/assets/ui/icons/nostr-hub/books.png',
    primaryColor: 'text-purple-300',
    glowColor: 'shadow-purple-400/50',
    borderColor: 'border-purple-400/30 hover:border-purple-400/80',
  },
  {
    // The games section, now the Station's first real destination: independent
    // Nostr games and apps that share the player's inventory with the island.
    id: 'connected-experiences',
    title: 'Connected Experiences',
    description: 'Games & apps that work with Blobbi Island',
    icon: '/assets/ui/icons/nostr-hub/controller.png',
    primaryColor: 'text-cyan-300',
    glowColor: 'shadow-cyan-400/50',
    borderColor: 'border-cyan-400/30 hover:border-cyan-400/80',
    content: ConnectedExperiencesSection,
  },
  {
    id: 'social',
    title: 'Social',
    description: 'Connect & Share',
    icon: '/assets/ui/icons/nostr-hub/map.png',
    primaryColor: 'text-orange-300',
    glowColor: 'shadow-orange-400/50',
    borderColor: 'border-orange-400/30 hover:border-orange-400/80',
  },
  {
    id: 'futuristic',
    title: 'Future Box',
    description: 'Tomorrow\'s Tech',
    icon: '/assets/ui/icons/nostr-hub/star.png',
    primaryColor: 'text-yellow-300',
    glowColor: 'shadow-yellow-400/50',
    borderColor: 'border-yellow-400/30 hover:border-yellow-400/80',
  },
];

export function NostrHubModal({ isOpen, onClose, initialSection = null }: NostrHubModalProps) {
  const [expandedCard, setExpandedCard] = useState<NostrHubSectionId | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Each opening starts on the requested section (a chair lands on Connected
  // Experiences); a plain open starts on the overview.
  useEffect(() => {
    if (isOpen) setExpandedCard(initialSection);
  }, [isOpen, initialSection]);

  const handleCardClick = (cardId: NostrHubSectionId) => {
    setExpandedCard(expandedCard === cardId ? null : cardId);
  };

  const handleClose = () => {
    setExpandedCard(null);
    onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only close if clicking the backdrop, not the modal content
    if (e.target === e.currentTarget && isOpen) {
      setExpandedCard(null);
      onClose();
    }
  };

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      // A window opened over the hub (the egress confirmation) takes the key
      // first and marks it handled; the hub must not close underneath it.
      if (e.key === 'Escape' && isOpen && !e.defaultPrevented) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={modalRef}
      className={cn(
        "absolute inset-0 z-50 flex items-center justify-center backdrop-blur-sm p-4",
        isOpen && "hover:cursor-blobbi-neon"
      )}
      style={{
        // Tron-inspired dark backdrop with subtle grid pattern
        background: 'radial-gradient(ellipse at center, rgba(0,20,40,0.95) 0%, rgba(0,0,0,0.98) 100%)',
        position: 'absolute',
      }}
      onClick={handleBackdropClick}
    >
      {/* Tron-style Modal Container */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="nostr-hub-title"
        data-testid="nostr-hub"
        data-hub-section={expandedCard ?? undefined}
        className="w-[90%] h-full max-w-4xl rounded-xl shadow-2xl flex flex-col max-h-[90vh] relative overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, rgba(0,15,30,0.95) 0%, rgba(0,5,15,0.98) 100%)',
          border: '1px solid rgba(34,211,238,0.3)',
          boxShadow: '0 0 30px rgba(34,211,238,0.2), inset 0 0 30px rgba(34,211,238,0.05)',
        }}
      >
        {/* Tron Grid Pattern Overlay */}
        <div
          className="absolute inset-0 opacity-10 pointer-events-none"
          style={{
            backgroundImage: `
              linear-gradient(rgba(34,211,238,0.1) 1px, transparent 1px),
              linear-gradient(90deg, rgba(34,211,238,0.1) 1px, transparent 1px)
            `,
            backgroundSize: '20px 20px',
          }}
        />

        {/* Animated Border Glow */}
        <div className="absolute inset-0 rounded-xl pointer-events-none">
          <div
            className="absolute inset-0 rounded-xl opacity-60 animate-pulse"
            style={{
              background: 'linear-gradient(45deg, transparent, rgba(34,211,238,0.1), transparent, rgba(168,85,247,0.1), transparent)',
            }}
          />
        </div>

        {/* Modal Header */}
        <div className="relative p-6 border-b border-cyan-400/20">
          <div className="text-center">
            <h2 id="nostr-hub-title" className="text-4xl font-bold mb-2 tracking-wider">
              <span
                className="bg-gradient-to-r from-cyan-300 via-blue-300 to-purple-300 bg-clip-text text-transparent"
                style={{
                  textShadow: '0 0 20px rgba(34,211,238,0.5)',
                  fontFamily: 'monospace',
                }}
              >
                NOSTR HUB
              </span>
            </h2>
            <div className="flex items-center justify-center space-x-2">
              <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse" />
              <p className="text-cyan-300/80 text-sm tracking-wide font-mono uppercase">
                Digital Neural Network
              </p>
              <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse" />
            </div>
          </div>

          {/* Tron-style Close Button */}
          <button
            type="button"
            aria-label="Close"
            onClick={handleClose}
            className={cn(
              "absolute top-4 right-4 w-10 h-10 rounded-lg",
              "bg-gray-900/50 border border-cyan-400/30 hover:border-cyan-400/80",
              "text-cyan-300 hover:text-cyan-100",
              "transition-all duration-300 ease-out",
              "hover:shadow-[0_0_15px_rgba(34,211,238,0.4)]",
              "flex items-center justify-center group cursor-blobbi-neon"
            )}
          >
            <X className="w-5 h-5 group-hover:scale-110 transition-transform duration-200 cursor-blobbi-neon" />
          </button>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-6 relative">
          {/* Grid Layout for Main Cards */}
          <div className={cn(
            "grid gap-6 transition-all duration-700 ease-out h-full",
            expandedCard ? "grid-cols-1" : "grid-cols-2"
          )}>
            {hubCards.map((card) => {
              const expanded = expandedCard === card.id;
              const Content = card.content;
              return (
              <div key={card.id} className={cn(
                "relative group transition-all duration-700 ease-out",
                expandedCard && !expanded ? "hidden opacity-0 scale-0" : "opacity-100 scale-100"
              )}>
                {/* Main Card - Tron Style */}
                <div
                  className={cn(
                    "relative overflow-hidden rounded-lg cursor-blobbi-neon transition-all duration-500 ease-out h-full",
                    "bg-gray-900/30 backdrop-blur-sm",
                    "hover:bg-gray-900/50",
                    expanded ? "scale-100 z-10" : "hover:scale-105",
                    card.borderColor || tronBorder,
                    tronGlow
                  )}
                  data-testid={`hub-section-${card.id}`}
                  data-expanded={expanded ? 'true' : undefined}
                  onClick={() => handleCardClick(card.id)}
                  style={{
                    boxShadow: `0 0 15px ${card.glowColor.includes('cyan') ? 'rgba(34,211,238,0.2)' :
                      card.glowColor.includes('purple') ? 'rgba(168,85,247,0.2)' :
                      card.glowColor.includes('orange') ? 'rgba(251,146,60,0.2)' :
                      card.glowColor.includes('yellow') ? 'rgba(250,204,21,0.2)' :
                      'rgba(59,130,246,0.2)'}`,
                  }}
                >
                  {/* Tron-style Inner Glow */}
                  <div className="absolute inset-0 bg-gradient-to-br from-cyan-400/5 via-transparent to-blue-400/5 opacity-50" />

                  {/* Animated Corner Accents */}
                  <div className="absolute top-0 left-0 w-4 h-4">
                    <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-cyan-400 to-transparent opacity-60" />
                    <div className="absolute top-0 left-0 h-full w-0.5 bg-gradient-to-b from-cyan-400 to-transparent opacity-60" />
                  </div>
                  <div className="absolute top-0 right-0 w-4 h-4">
                    <div className="absolute top-0 right-0 w-full h-0.5 bg-gradient-to-l from-cyan-400 to-transparent opacity-60" />
                    <div className="absolute top-0 right-0 h-full w-0.5 bg-gradient-to-b from-cyan-400 to-transparent opacity-60" />
                  </div>

                  <CardContent className={cn(
                    "relative z-10 text-center flex flex-col items-center justify-center",
                    expanded ? "p-8 sm:p-10" : "p-6"
                  )}>
                    {/* Icon with Tron Glow */}
                    <div className={cn(
                      "transition-all [transition-duration:2000ms]",
                      tronPulse,
                      expanded ? "w-20 h-20" : "w-16 h-16"
                    )}
                    style={{
                      filter: 'drop-shadow(0 0 10px rgba(34,211,238,0.6))',
                    }}>
                      <img
                        src={card.icon}
                        alt=""
                        className="w-full h-full object-contain"
                      />
                    </div>

                    {/* Title */}
                    <h3 className={cn(
                      "font-bold mb-2 tracking-wide font-mono uppercase transition-all duration-300",
                      card.primaryColor,
                      expanded ? "text-2xl mt-4" : "text-xl"
                    )}>
                      {card.title}
                    </h3>

                    {/* Description */}
                    <p className={cn(
                      "opacity-80 font-mono tracking-wide transition-all duration-300",
                      card.primaryColor,
                      expanded ? "text-base" : "text-sm"
                    )}>
                      {card.description}
                    </p>

                    {/* The section's own content, once expanded. */}
                    {expanded && Content && (
                      <div className="mt-6 flex w-full justify-center" data-testid={`hub-section-${card.id}-content`}>
                        <Content />
                      </div>
                    )}

                    {/* Expand/Collapse Indicator */}
                    <div className="mt-4">
                      <div className={cn(
                        "text-xs opacity-60 font-mono tracking-wider uppercase",
                        card.primaryColor,
                        "flex items-center justify-center space-x-2 transition-all duration-300",
                        expanded ? "text-sm" : "text-xs"
                      )}>
                        <div className="w-1 h-1 bg-current rounded-full animate-pulse" />
                        <span>{expanded ? "▲ COLLAPSE" : "▼ EXPAND"}</span>
                        <div className="w-1 h-1 bg-current rounded-full animate-pulse" />
                      </div>
                    </div>
                  </CardContent>
                </div>
              </div>
              );
            })}
          </div>
        </div>

        {/* Tron-style Footer */}
        <div className="relative p-4 border-t border-cyan-400/20">
          <div className="flex justify-center">
            <Button
              variant="outline"
              onClick={handleClose}
              className={cn(
                "border-cyan-400/40 text-cyan-300 hover:text-cyan-100 cursor-blobbi-neon",
                "bg-gray-900/30 hover:bg-gray-900/50",
                "font-mono tracking-wider uppercase text-sm",
                "transition-all duration-300 ease-out",
                "hover:shadow-[0_0_15px_rgba(34,211,238,0.4)]",
                "hover:border-cyan-400/80"
              )}
            >
              <span className="flex items-center space-x-2">
                <div className="w-1 h-1 bg-cyan-400 rounded-full animate-pulse" />
                <span>EXIT HUB</span>
                <div className="w-1 h-1 bg-cyan-400 rounded-full animate-pulse" />
              </span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
