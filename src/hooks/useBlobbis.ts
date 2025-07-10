import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from './useCurrentUser';

export interface Blobbi {
  id: string;
  stage: 'egg' | 'baby' | 'adult';
  generation: number;
  hunger: number;
  happiness: number;
  health: number;
  hygiene: number;
  energy: number;
  experience: number;
  careStreak: number;
  baseColor?: string;
  secondaryColor?: string;
  pattern?: string;
  eyeColor?: string;
  specialMark?: string;
  personality?: string[];
  traits?: string[];
  mood?: string;
  favoriteFood?: string;
  voiceType?: string;
  size?: string;
  title?: string;
  skill?: string;
  name?: string;
  adultType?: string; // For adult stage Blobbis (bloomi, breezy, etc.)
}

export function useBlobbis() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  return useQuery({
    queryKey: ['blobbis', user?.pubkey],
    queryFn: async (c) => {
      if (!user?.pubkey) {
        throw new Error('User not logged in');
      }

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(3000)]);

      // Query for kind 31124 events (Blobbi Current State)
      const events = await nostr.query([{
        kinds: [31124],
        authors: [user.pubkey],
        limit: 50
      }], { signal });

      // Transform events to Blobbi objects
      const blobbis: Blobbi[] = events
        .filter(event => {
          // Only include Blobbis that are not in egg stage (as per spec)
          const stage = event.tags.find(([name]) => name === 'stage')?.[1];
          return stage && stage !== 'egg';
        })
        .map(event => {
          const getTag = (name: string) => event.tags.find(([tagName]) => tagName === name)?.[1];
          const getTags = (name: string) => event.tags.filter(([tagName]) => tagName === name).map(([, value]) => value);

          return {
            id: getTag('d') || event.id,
            stage: (getTag('stage') as 'baby' | 'adult') || 'baby',
            generation: parseInt(getTag('generation') || '1'),
            hunger: parseInt(getTag('hunger') || '50'),
            happiness: parseInt(getTag('happiness') || '50'),
            health: parseInt(getTag('health') || '50'),
            hygiene: parseInt(getTag('hygiene') || '50'),
            energy: parseInt(getTag('energy') || '50'),
            experience: parseInt(getTag('experience') || '0'),
            careStreak: parseInt(getTag('care_streak') || '0'),
            baseColor: getTag('base_color'),
            secondaryColor: getTag('secondary_color'),
            pattern: getTag('pattern'),
            eyeColor: getTag('eye_color'),
            specialMark: getTag('special_mark'),
            personality: getTags('personality'),
            traits: getTags('trait'),
            mood: getTag('mood'),
            favoriteFood: getTag('favorite_food'),
            voiceType: getTag('voice_type'),
            size: getTag('size'),
            title: getTag('title'),
            skill: getTag('skill'),
            name: event.content || getTag('d') || event.id,
            adultType: getTag('adult_type'),
          };
        });

      return blobbis;
    },
    enabled: !!user?.pubkey,
    staleTime: 30000, // 30 seconds
    refetchInterval: 60000, // 1 minute
  });
}