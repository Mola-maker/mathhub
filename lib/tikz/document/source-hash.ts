const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const UINT64_MASK = 0xffffffffffffffffn;

export type SourceHashAlgorithm = 'fnv1a64-utf8' | 'sha256-utf8';

export function utf8Bytes(value: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value);
  const bytes: number[] = [];
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x7f) bytes.push(code);
    else if (code <= 0x7ff) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code <= 0xffff) {
      bytes.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(
    bytes,
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}

/**
 * Browser-safe deterministic fingerprint. This is an identity/staleness
 * primitive, not a cryptographic attestation.
 */
export function hashSource(source: string): string {
  let hash = FNV_OFFSET;
  for (const byte of utf8Bytes(source)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & UINT64_MASK;
  }
  return hash.toString(16).padStart(16, '0');
}

/** Prefer SHA-256 when an async Web Crypto lane is available. */
export async function hashSourceAsync(
  source: string,
): Promise<{ hash: string; algorithm: SourceHashAlgorithm }> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    try {
      const digest = await subtle.digest('SHA-256', utf8Bytes(source));
      return {
        hash: bytesToHex(new Uint8Array(digest)),
        algorithm: 'sha256-utf8',
      };
    } catch {
      // Restricted runtimes may expose crypto while denying digest.
    }
  }
  return { hash: hashSource(source), algorithm: 'fnv1a64-utf8' };
}
