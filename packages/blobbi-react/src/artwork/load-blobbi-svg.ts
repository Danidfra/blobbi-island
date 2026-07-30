/**
 * Synchronous Blobbi SVG loading using Ditto-compatible inlined SVG pipeline.
 * Replaces the old fetch-based customizeSvg.ts.
 */
import { getAdultBaseSvg, getAdultSleepingSvg, customizeAdultSvg, isValidAdultForm, getDefaultAdultForm } from './adult-blobbi';
import type { AdultForm } from './adult-blobbi';
import { getBabyBaseSvg, getBabySleepingSvg, customizeBabySvg } from './baby-blobbi';
import { applyRearView, type BlobbiView } from '../svg';

export type { BlobbiView };

/**
 * Load and customize a Blobbi SVG synchronously (no network fetch).
 * Drop-in replacement for the old async loadCustomizedBlobbiSvg.
 *
 * `view` selects WHICH DRAWING to produce, in the same spirit as `isSleeping`
 * selecting the sleeping artwork: `'rear'` derives the back of the character
 * from the front artwork by dropping its face blocks (see `svg/rear-view.ts`).
 * Colours, silhouette, accessorial body parts and particles are preserved, so a
 * rear Blobbi is still recognisably the same Blobbi.
 */
export function loadBlobbiSvg(
  stage: string,
  adultType?: string,
  baseColor?: string,
  secondaryColor?: string,
  eyeColor?: string,
  isSleeping?: boolean,
  instanceId?: string,
  view: BlobbiView = 'front',
): string {
  const customized = (() => {
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
  })();

  return view === 'rear' ? applyRearView(customized) : customized;
}
