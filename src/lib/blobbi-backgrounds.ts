export const BLOBBI_BACKGROUNDS: Record<string, string> = {
  'blobbi-bg-default': '/assets/scenario/blobbi-bg/blobbi-bg-default.png',
};

export function getBlobbiBackground(key: string): string {
  return BLOBBI_BACKGROUNDS[key] || '';
}