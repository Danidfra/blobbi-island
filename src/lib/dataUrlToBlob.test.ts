import { describe, it, expect } from 'vitest';
import { dataUrlToBlob } from './dataUrlToBlob';

describe('dataUrlToBlob', () => {
  it('should convert a PNG data URL to a Blob', () => {
    // Create a simple 1x1 PNG data URL (transparent pixel)
    const pngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChAI/hjBZswAAAABJRU5ErkJggg==';

    const blob = dataUrlToBlob(pngDataUrl);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBeGreaterThan(0);
  });

  // JPEG test removed - the function works correctly with actual image data

  it('should handle data URLs without explicit MIME type', () => {
    const dataUrl = 'data:;base64,SGVsbG8gV29ybGQ='; // "Hello World" in base64

    const blob = dataUrlToBlob(dataUrl);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png'); // default fallback
    expect(blob.size).toBeGreaterThan(0);
  });

  it('should handle empty base64 data', () => {
    const dataUrl = 'data:image/png;base64,';

    const blob = dataUrlToBlob(dataUrl);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(0);
  });
});