/**
 * Synchronous Blobbi SVG loading using Ditto-compatible inlined SVG pipeline.
 * Replaces the old fetch-based customizeSvg.ts.
 */
import { getAdultBaseSvg, getAdultSleepingSvg, customizeAdultSvg, isValidAdultForm, getDefaultAdultForm } from '@/blobbi/adult-blobbi';
import type { AdultForm } from '@/blobbi/adult-blobbi';
import { getBabyBaseSvg, getBabySleepingSvg, customizeBabySvg } from '@/blobbi/baby-blobbi';

/**
 * Load and customize a Blobbi SVG synchronously (no network fetch).
 * Drop-in replacement for the old async loadCustomizedBlobbiSvg.
 */
export function loadBlobbiSvg(
  stage: string,
  adultType?: string,
  baseColor?: string,
  secondaryColor?: string,
  eyeColor?: string,
  isSleeping?: boolean,
  instanceId?: string,
): string {
  if (stage === 'adult') {
    const form: AdultForm = (adultType && isValidAdultForm(adultType))
      ? adultType as AdultForm
      : getDefaultAdultForm();
    const rawSvg = isSleeping ? getAdultSleepingSvg(form) : getAdultBaseSvg(form);
    return customizeAdultSvg(rawSvg, form, { baseColor, secondaryColor, eyeColor }, isSleeping ?? false, instanceId);
  }

  // Baby stage (also used as fallback for egg/unknown)
  const rawSvg = isSleeping ? getBabySleepingSvg() : getBabyBaseSvg();
  return customizeBabySvg(rawSvg, { baseColor, secondaryColor, eyeColor }, isSleeping ?? false, instanceId);
}
