/**
 * Pixel 0.0.15's guest readback is straight-alpha BGRA, while Surface upload
 * treats color channels as premultiplied. Transparent toolbar glyphs otherwise
 * become overbright during readback. Zatara guest viewports are opaque: flatten
 * against their background before upload, avoiding both double unpremultiplication
 * and transparent holes. The caller owns this read buffer; no extra frame copy.
 */
export function flattenGuestFrame(bgra: Buffer) {
  for (let i = 0; i < bgra.length; i += 4) {
    const a = bgra[i + 3];
    if (a === 255) continue;
    const inverse = 255 - a;
    bgra[i] = Math.round((bgra[i] * a + 45 * inverse) / 255);
    bgra[i + 1] = Math.round((bgra[i + 1] * a + 28 * inverse) / 255);
    bgra[i + 2] = Math.round((bgra[i + 2] * a + 19 * inverse) / 255);
    bgra[i + 3] = 255;
  }
  return bgra;
}
