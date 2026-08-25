import * as ed25519 from "@noble/ed25519";
import { base64ToBytes, bytesToHex, hexToBytes } from "./bytes.js";
import { canonicalJson } from "./canonical.js";
import { InvalidKeyError } from "./errors.js";
import type { PaymentIntent } from "./types.js";

const SEED_LENGTH = 32;
const EXPANDED_SECRET_LENGTH = 64;

/**
 * Parse constructor key material into a 32-byte Ed25519 seed.
 *
 * Accepted formats (the parameter is named `encryptedPrivateKey` to match
 * secret-store flows; decrypt at rest before calling the constructor):
 * - hex-encoded 32-byte seed (64 hex chars, optional `0x` prefix)
 * - hex-encoded 64-byte expanded secret key (128 hex chars; first 32 bytes used)
 * - standard Base64 of a 32-byte seed or 64-byte expanded secret key
 */
export function parsePrivateKey(encryptedPrivateKey: string): Uint8Array {
  if (typeof encryptedPrivateKey !== "string" || encryptedPrivateKey.trim() === "") {
    throw new InvalidKeyError(
      "Private key is required: pass a hex or base64-encoded 32-byte Ed25519 seed.",
    );
  }

  const trimmed = encryptedPrivateKey.trim();

  try {
    const hexCandidate = trimmed.startsWith("0x") || trimmed.startsWith("0X") ? trimmed.slice(2) : trimmed;
    if (/^[0-9a-fA-F]+$/.test(hexCandidate) && (hexCandidate.length === 64 || hexCandidate.length === 128)) {
      return seedFromBytes(hexToBytes(hexCandidate));
    }

    const decoded = base64ToBytes(trimmed);
    if (decoded.length === SEED_LENGTH || decoded.length === EXPANDED_SECRET_LENGTH) {
      return seedFromBytes(decoded);
    }
  } catch {
    // Fall through to the unified error below.
  }

  throw new InvalidKeyError(
    "Invalid private key: expected a hex or base64-encoded 32-byte Ed25519 seed (or 64-byte expanded secret key). If the key is encrypted at rest, decrypt it before passing it to the constructor.",
  );
}

function seedFromBytes(bytes: Uint8Array): Uint8Array {
  if (bytes.length === SEED_LENGTH) {
    return bytes;
  }
  if (bytes.length === EXPANDED_SECRET_LENGTH) {
    return bytes.slice(0, SEED_LENGTH);
  }
  throw new InvalidKeyError("Private key decoded to an unexpected length.");
}

export async function derivePublicKey(seed: Uint8Array): Promise<Uint8Array> {
  return ed25519.getPublicKeyAsync(seed);
}

/**
 * Sign the canonical JSON of a payment intent with Ed25519.
 *
 * Algorithm: Ed25519 via `@noble/ed25519` (portable; Node's SubtleCrypto Ed25519
 * support is not universal). Message = UTF-8 bytes of canonical JSON.
 */
export async function signIntent(intent: PaymentIntent, seed: Uint8Array): Promise<{
  signatureHex: string;
  publicKeyHex: string;
}> {
  const message = new TextEncoder().encode(canonicalJson(intent as unknown as Record<string, unknown>));
  const [signature, publicKey] = await Promise.all([
    ed25519.signAsync(message, seed),
    derivePublicKey(seed),
  ]);
  return {
    signatureHex: bytesToHex(signature),
    publicKeyHex: bytesToHex(publicKey),
  };
}

export async function verifyIntentSignature(
  intent: PaymentIntent,
  signatureHex: string,
  publicKeyHex: string,
): Promise<boolean> {
  const message = new TextEncoder().encode(canonicalJson(intent as unknown as Record<string, unknown>));
  return ed25519.verifyAsync(hexToBytes(signatureHex), message, hexToBytes(publicKeyHex));
}
