/**
 * Customizes a Blobbi SVG by replacing gradient colors with actual colors
 */
export function customizeSvg(
  svgContent: string,
  baseColor?: string,
  secondaryColor?: string,
  eyeColor?: string
): string {
  let customized = svgContent;

  // Customize body gradient colors if baseColor is provided
  if (baseColor) {
    // Create lighter and darker variants of the base color for gradient
    const lighterColor = secondaryColor ?? lightenColor(baseColor, 20);
    const darkerColor = darkenColor(baseColor, 20);

    // Replace the body gradient colors
    customized = customized.replace(
      /#8b5cf6/g, lighterColor
    ).replace(
      /#7c3aed/g, baseColor
    ).replace(
      /#6d28d9/g, darkerColor
    );
  }

  // Customize pupil colors if eyeColor is provided
  if (eyeColor) {
    customized = customized.replace(
      /#374151/g, eyeColor
    ).replace(
      /#1e293b/g, darkenColor(eyeColor, 30)
    );
  }

  return customized;
}

/**
 * Adds a suffix to SVG internal IDs (and references), avoiding collisions 
 * when multiple <svg> inline share the same ids (e.g., gradients).
 */
export function scopeSvgIds(svg: string, suffix?: string): string {
  if (!suffix) return svg;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svg, "image/svg+xml");
    const idMap = new Map<string, string>();

    // 1) renomeia todos os ids
    doc.querySelectorAll<HTMLElement>("[id]").forEach((el) => {
      const oldId = el.getAttribute("id");
      if (!oldId) return;
      const newId = `${oldId}-${suffix}`;
      idMap.set(oldId, newId);
      el.setAttribute("id", newId);
    });

    // 2) atributos que podem conter url(#id) ou #id
    const URL_ATTRS = [
      "fill","stroke","filter","mask","clip-path",
      "marker-start","marker-mid","marker-end"
    ];
    const HREF_ATTRS = ["href","xlink:href"];

    const replaceUrls = (val: string) =>
      val.replace(/url\(#([^)]+)\)/g, (m, id) =>
        idMap.has(id) ? `url(#${idMap.get(id)})` : m
      );
    const replaceHashRef = (val: string) => {
      if (val.startsWith("#")) {
        const id = val.slice(1);
        if (idMap.has(id)) return `#${idMap.get(id)}`;
      }
      return val;
    };

    // 3) aplica nas refs dos elementos
    doc.querySelectorAll<HTMLElement>("*").forEach((el) => {
      URL_ATTRS.forEach((attr) => {
        const v = el.getAttribute(attr);
        if (v) {
          const nv = replaceUrls(v);
          if (nv !== v) el.setAttribute(attr, nv);
        }
      });
      HREF_ATTRS.forEach((attr) => {
        const v = el.getAttribute(attr);
        if (v) {
          const nv = replaceHashRef(v);
          if (nv !== v) el.setAttribute(attr, nv);
        }
      });
      const style = el.getAttribute("style");
      if (style) {
        const ns = replaceUrls(style);
        if (ns !== style) el.setAttribute("style", ns);
      }
    });

    // 4) atualiza CSS embutido
    doc.querySelectorAll("style").forEach((node) => {
      const css = node.textContent || "";
      const css1 = css.replace(/url\(#([^)]+)\)/g, (m, id) =>
        idMap.has(id) ? `url(#${idMap.get(id)})` : m
      );
      // seletor por id: #oldId => #oldId-suffix
      const css2 = css1.replace(/#([A-Za-z_][\w.-]*)/g, (m, id) =>
        idMap.has(id) ? `#${idMap.get(id)}` : m
      );
      if (css2 !== css) node.textContent = css2;
    });

    const serializer = new XMLSerializer();
    return serializer.serializeToString(doc);
  } catch (e) {
    console.warn("[scopeSvgIds] DOM parse failed, returning original svg", e);
    return svg;
  }
}

/**
 * Lightens a hex color by a percentage
 */
export function lightenColor(hex: string, percent: number): string {
  const num = parseInt(hex.replace("#", ""), 16);
  const amt = Math.round(2.55 * percent);
  const R = (num >> 16) + amt;
  const G = (num >> 8 & 0x00FF) + amt;
  const B = (num & 0x0000FF) + amt;
  return "#" + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
    (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
    (B < 255 ? B < 1 ? 0 : B : 255)).toString(16).slice(1);
}

/**
 * Darkens a hex color by a percentage
 */
export function darkenColor(hex: string, percent: number): string {
  const num = parseInt(hex.replace("#", ""), 16);
  const amt = Math.round(2.55 * percent);
  const R = (num >> 16) - amt;
  const G = (num >> 8 & 0x00FF) - amt;
  const B = (num & 0x0000FF) - amt;
  return "#" + (0x1000000 + (R > 255 ? 255 : R < 0 ? 0 : R) * 0x10000 +
    (G > 255 ? 255 : G < 0 ? 0 : G) * 0x100 +
    (B > 255 ? 255 : B < 0 ? 0 : B)).toString(16).slice(1);
}

/**
 * Gets the SVG file path for a Blobbi based on its stage, adult type, and sleeping state
 */
function mapStageForAssets(stage?: string): 'baby' | 'adult' {
  if (stage === 'adult') return 'adult';
  return 'baby';
}

export function getBlobbiSvgPath(stage: string, adultType?: string, isSleeping?: boolean): string {
  const sleepingSuffix = isSleeping ? '-sleeping' : '-base';
  const mapped = mapStageForAssets(stage);

  if (mapped === 'adult') {
    const type = adultType && adultType.trim() ? adultType : 'bloomi';
    return `/assets/adult-stage/${type}/${type}${sleepingSuffix}.svg`;
  }

  return `/assets/baby-stage/baby/blobbi-baby${sleepingSuffix}.svg`;
}

/**
 * Loads and customizes a Blobbi SVG from the local assets
 */
export async function loadCustomizedBlobbiSvg(
  stage: string,
  adultType?: string,
  baseColor?: string,
  secondaryColor?: string,
  eyeColor?: string,
  isSleeping?: boolean,
  idSuffix?: string
): Promise<string> {
  const svgPath = getBlobbiSvgPath(stage, adultType, isSleeping);

  try {
    const response = await fetch(svgPath);
    if (!response.ok) {
      throw new Error(`Failed to load SVG: ${response.statusText}`);
    }

    const svgContent = await response.text();
    const colored = customizeSvg(svgContent, baseColor, secondaryColor, eyeColor);
    return scopeSvgIds(colored, idSuffix);
  } catch (error) {
    console.error('Error loading Blobbi SVG:', error);
    // Return a fallback SVG with proper styling
    const raw = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="fallbackGradient" cx="0.3" cy="0.25">
          <stop offset="0%" style="stop-color:${lightenColor(baseColor || '#8b5cf6', 20)};stop-opacity:1" />
          <stop offset="60%" style="stop-color:${baseColor || '#7c3aed'};stop-opacity:1" />
          <stop offset="100%" style="stop-color:${darkenColor(baseColor || '#6d28d9', 20)};stop-opacity:1" />
        </radialGradient>
      </defs>
      <path d="M 50 15 Q 50 10 50 15 Q 72 25 75 55 Q 75 80 50 88 Q 25 80 25 55 Q 28 25 50 15" fill="url(#fallbackGradient)" />
      <ellipse cx="50" cy="45" rx="15" ry="20" fill="white" opacity="0.2" />
      <circle cx="38" cy="46" r="6" fill="${eyeColor || '#374151'}" />
      <circle cx="62" cy="46" r="6" fill="${eyeColor || '#374151'}" />
      <circle cx="40" cy="44" r="2" fill="white" />
      <circle cx="64" cy="44" r="2" fill="white" />
      <path d="M 42 62 Q 50 68 58 62" stroke="#374151" stroke-width="2.5" fill="none" stroke-linecap="round" />
    </svg>`;
    return scopeSvgIds(raw, idSuffix);
  }
}