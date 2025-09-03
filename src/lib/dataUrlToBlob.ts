/**
 * Converts a data URL to a Blob object in memory.
 * This avoids CSP issues with fetch(data:image/png;base64,...)
 * 
 * @param dataUrl The data URL to convert (e.g., "data:image/png;base64,...")
 * @returns A Blob object representing the data
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const dataUrlParts = dataUrl.split(',');
  const mimeType = dataUrlParts[0].match(/:(.*?);/)?.[1] || 'image/png';
  const byteString = atob(dataUrlParts[1]);
  const arrayBuffer = new ArrayBuffer(byteString.length);
  const uint8Array = new Uint8Array(arrayBuffer);
  
  for (let i = 0; i < byteString.length; i++) {
    uint8Array[i] = byteString.charCodeAt(i);
  }
  
  return new Blob([uint8Array], { type: mimeType });
}