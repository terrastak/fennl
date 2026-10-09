/**
 * What a JPEG says about itself (phase D2), read from its own bytes: how it should be turned to
 * stand upright, how big it is as stored, and whether it carries a location. Phones store photos
 * sideways and record "turn me" in the EXIF data rather than turning the pixels, and that data
 * also holds where the photo was taken. Fennl draws every photo upright and stores only the
 * pixels, so no location ever leaves the device.
 */
export interface JpegInfo {
  /** EXIF orientation, 1 (upright) to 8; 1 when the photo doesn't say. */
  orientation: number;
  /** Size as stored, before turning. */
  width: number;
  height: number;
  /** The EXIF data includes GPS (where the photo was taken). */
  hasLocation: boolean;
}

/** Orientations 5 to 8 turn the picture a quarter turn, so width and height swap. */
export function swapsSides(orientation: number): boolean {
  return orientation >= 5 && orientation <= 8;
}

/** Reads a JPEG's header, or returns null for anything that isn't a JPEG. Never throws. */
export function readJpegInfo(bytes: Uint8Array): JpegInfo | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const info: JpegInfo = { orientation: 1, width: 0, height: 0, hasLocation: false };
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return info.width ? info : null;
    const marker = view.getUint8(at + 1);
    // Fill bytes and markers without a length.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      at += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break; // End of image, or the picture data starts.
    const length = view.getUint16(at + 2);
    const start = at + 4;
    const end = at + 2 + length;
    if (length < 2 || end > bytes.length) break;
    if (marker === 0xe1) readExif(view, start, end, info);
    // Start of frame (baseline, progressive...; not DHT 0xc4, JPG 0xc8 or DAC 0xcc).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (start + 5 <= end && !info.width) {
        info.height = view.getUint16(start + 1);
        info.width = view.getUint16(start + 3);
      }
    }
    at = end;
  }
  return info.width ? info : null;
}

/** The EXIF block of an APP1 segment: orientation and whether GPS is there. */
function readExif(view: DataView, start: number, end: number, info: JpegInfo): void {
  // "Exif\0\0", then a TIFF header.
  if (end - start < 14 || view.getUint32(start) !== 0x45786966 || view.getUint16(start + 4) !== 0)
    return;
  const tiff = start + 6;
  const order = view.getUint16(tiff);
  if (order !== 0x4949 && order !== 0x4d4d) return;
  const little = order === 0x4949;
  const u16 = (offset: number) => view.getUint16(offset, little);
  const u32 = (offset: number) => view.getUint32(offset, little);
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return;
    const tag = u16(entry);
    if (tag === 0x0112) {
      const value = u16(entry + 8);
      if (value >= 1 && value <= 8) info.orientation = value;
    } else if (tag === 0x8825) {
      info.hasLocation = true;
    }
  }
}
