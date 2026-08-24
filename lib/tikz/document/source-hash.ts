const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const UINT64_MASK = 0xffffffffffffffffn;

export type SourceHashAlgorithm = 'fnv1a64-utf8' | 'sha256-utf8';

// The explicit ArrayBuffer argument matters: since TypeScript 5.7 a bare
// Uint8Array widens to Uint8Array<ArrayBufferLike>, which no longer satisfies
// BufferSource at crypto.subtle.digest. Both branches below allocate a real
// ArrayBuffer, so the narrower type is accurate rather than a cast.
export function utf8Bytes(value: string): Uint8Array<ArrayBuffer> {
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

export function isSourceHashAlgorithm(
  value: unknown,
): value is SourceHashAlgorithm {
  return value === 'fnv1a64-utf8' || value === 'sha256-utf8';
}

/**
 * Recompute a digest under a caller-named algorithm.
 *
 * Verifying a claimed hash requires reproducing it with the algorithm that
 * produced it: a peer that hashes synchronously can only use the FNV lane, so a
 * verifier that always prefers SHA-256 would reject every such claim. Naming the
 * algorithm selects the primitive but grants no trust — the digest is still
 * recomputed here and compared. Returns null when the named lane is unavailable,
 * which callers must treat as a failed verification rather than a pass.
 */
export async function hashSourceUsing(
  source: string,
  algorithm: SourceHashAlgorithm,
): Promise<string | null> {
  if (algorithm === 'fnv1a64-utf8') return hashSource(source);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  try {
    const digest = await subtle.digest('SHA-256', utf8Bytes(source));
    return bytesToHex(new Uint8Array(digest));
  } catch {
    return null;
  }
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
