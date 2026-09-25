// PBKDF2-SHA256, 100k iterations (the Workers CPU-time-friendly max), 16-byte
// salt. Iteration count is embedded in the stored hash so a future bump
// doesn't break verifying old hashes.
const ITERATIONS = 100_000;

function toHex(bytes: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

async function deriveBits(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256);
}

/** Returns `{ hash, salt }` to store in `users.password_hash` / `password_salt`. */
export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await deriveBits(password, salt, ITERATIONS);
  return { hash: `${ITERATIONS}:${toHex(bits)}`, salt: toHex(salt) };
}

/** Constant-time-ish compare: both hex strings are fixed-length, so a plain
 * loop that always scans the full length doesn't short-circuit on length. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyPassword(password: string, storedHash: string, saltHex: string): Promise<boolean> {
  const [iterStr, hashHex] = storedHash.split(":");
  const iterations = Number(iterStr);
  if (!iterations || !hashHex) return false;
  const bits = await deriveBits(password, fromHex(saltHex), iterations);
  return timingSafeEqualHex(toHex(bits), hashHex);
}
