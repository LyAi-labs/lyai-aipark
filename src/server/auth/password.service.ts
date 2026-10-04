/**
 * Phase 03 — Password Service
 * Argon2id hashing and verification.
 * argon2id is resistant to side-channel and GPU attacks;
 * it is the OWASP recommended choice for password storage (2024).
 *
 * Cost parameters are conservatively above OWASP minimums
 * while remaining practical for server-side auth endpoints.
 */

import argon2 from 'argon2';

// ---------------------------------------------------------------------------
// Argon2id parameters
// OWASP minimum (2024): m=19456 KiB, t=2, p=1
// We use m=65536 KiB (64 MB), t=3, p=4 — adequate for single-tenant studio.
// ---------------------------------------------------------------------------

const ARGON2_OPTIONS: argon2.HashOptions & { raw?: false } = {
  type: argon2.argon2id,
  memoryCost: 65536,   // 64 MiB
  timeCost: 3,          // 3 iterations
  parallelism: 4,       // 4 parallel threads
  raw: false,
};

/**
 * Hash a plaintext password using Argon2id.
 * Returns an encoded string that includes salt + parameters.
 * Safe to store directly in the database.
 */
export async function hashPassword(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, ARGON2_OPTIONS);
}

/**
 * Verify a plaintext password against a stored Argon2id hash.
 * Returns true if the password matches; false otherwise.
 * Timing-safe by design (argon2 library).
 */
export async function verifyPassword(
  hash: string,
  plaintext: string
): Promise<boolean> {
  try {
    return await argon2.verify(hash, plaintext);
  } catch {
    // argon2.verify throws on malformed hash strings — treat as mismatch
    return false;
  }
}

/**
 * Returns true if the stored hash needs to be rehashed
 * (e.g., parameters were updated). Call after a successful verify
 * to migrate legacy hashes transparently.
 */
export async function needsRehash(hash: string): Promise<boolean> {
  return argon2.needsRehash(hash, ARGON2_OPTIONS);
}
