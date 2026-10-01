/**
 * Byte-stream decoding for cutcode files. Legacy files arrive in a mix of
 * encodings: ANSI/Windows-1252, UTF-8, and UTF-16LE (e.g. Perfect Cut 6
 * writes UTF-16LE .IMP files). All parsers work on the decoded string.
 */

function hasUtf16LeBom(b: Uint8Array): boolean {
  return b.length >= 2 && b[0] === 0xff && b[1] === 0xfe;
}

function hasUtf16BeBom(b: Uint8Array): boolean {
  return b.length >= 2 && b[0] === 0xfe && b[1] === 0xff;
}

function hasUtf8Bom(b: Uint8Array): boolean {
  return b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;
}

/** Decode UTF-16LE/BE without relying on TextDecoder label support. */
function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  let out = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = littleEndian
      ? bytes[i]! | (bytes[i + 1]! << 8)
      : (bytes[i]! << 8) | bytes[i + 1]!;
    // Decode surrogate pairs
    if (code >= 0xd800 && code <= 0xdbff && i + 3 < bytes.length) {
      const lo = littleEndian
        ? bytes[i + 2]! | (bytes[i + 3]! << 8)
        : (bytes[i + 2]! << 8) | bytes[i + 3]!;
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        out += String.fromCharCode(0x10000 + ((code - 0xd800) << 10) + (lo - 0xdc00));
        i += 2;
        continue;
      }
    }
    out += String.fromCharCode(code);
  }
  return out;
}

/**
 * Heuristic UTF-16 detection without a BOM: text in an ANSI/UTF-8 cutcode
 * file almost never contains NUL bytes, while UTF-16 text contains one per
 * character for ASCII content.
 */
function looksUtf16(b: Uint8Array): 0 | 1 | 2 | false {
  const n = Math.min(b.length, 4096);
  if (n < 4) return false;
  let odd = 0;
  let even = 0;
  for (let i = 0; i < n; i++) {
    if (b[i] === 0) (i % 2 === 1 ? odd++ : even++);
  }
  if (odd > n / 8 && even === 0) return 1;
  if (even > n / 8 && odd === 0) return 2;
  return false;
}

/** Decode raw cutcode bytes to text: BOM sniff → heuristic → UTF-8 → cp1252. */
export function decodeCutcodeBytes(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";

  if (hasUtf16LeBom(bytes)) return decodeUtf16(bytes.subarray(2), true).replace(/^\uFEFF/, "");
  if (hasUtf16BeBom(bytes)) return decodeUtf16(bytes.subarray(2), false).replace(/^\uFEFF/, "");
  if (hasUtf8Bom(bytes)) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  // BOM-less UTF-16: ASCII text leaves one NUL per character, on the high byte
  // of each code unit (LE) or the low byte (BE).
  const utf16 = looksUtf16(bytes);
  if (utf16) return decodeUtf16(bytes, utf16 === 1);

  // Strict UTF-8 first: valid multi-byte sequences mean real UTF-8.
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // Legacy ANSI (Windows-1252) file — every byte maps to a character.
    return new TextDecoder("windows-1252").decode(bytes);
  }
}
