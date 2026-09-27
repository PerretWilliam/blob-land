import type { Attraction, Identity, Kin, RelationStatus, Segment, Sex } from "@blob-land/sim";
import { fetch } from "@tauri-apps/plugin-http";

// plugin-http issues the request from the Rust side, not the webview, so it
// carries no Origin header and never hits the Worker's tauri://-only CORS check.
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8787";

export interface AuthResponse {
  token: string;
  seed: string;
}

export interface GardenBlob {
  seed: string;
  pseudo: string | null;
  /** The player's country (ISO 3166-1 alpha-2), if they share it. Children have none. */
  country: string | null;
  sex: Sex;
  attraction: Attraction;
  bornAt: number;
  /** A child until then. */
  adultAt: number;
  /** Who it's in a couple with, if anyone. */
  partner: string | null;
  /** Broke up a little while ago. */
  heartbroken: boolean;
  /** Its stored timeline around now, sorted: the scene plays it back. */
  segments: Segment[];
}

export interface GardenResponse {
  /** The garden's time when it answered. */
  now: number;
  /** How fast the garden's clock runs: 1, or more in a sped-up local dev garden. */
  rate: number;
  /** The region of the garden these blobs live in: the one asked for, else the player's own. */
  region: number;
  /** The player's own region. */
  home: number;
  /** Every region, and how many blobs live there. */
  regions: GardenRegion[];
  /** The region's island side, in cells (see gardenIsland). */
  size: number;
  /** How many steps the region has lived: pass it back as `since` to get only what's new. */
  step: number;
  /** An answer to `since`: every blob, but only the timeline written since then. */
  delta: boolean;
  blobs: GardenBlob[];
}

export interface GardenRegion {
  region: number;
  blobs: number;
}

/** The garden's clock, as last read from the server. */
export interface GardenClock {
  at: number;
  /** Local time when `at` was read. */
  readAt: number;
  rate: number;
}

export const gardenTime = (clock: GardenClock) => clock.at + (Date.now() - clock.readAt) * clock.rate;

/**
 * A request that failed, said the way a player can act on. `offline`: the
 * server couldn't be reached at all. `code`: the server's own error, for
 * callers that react to one (see join-garden-screen).
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly offline = false,
    readonly code?: string,
  ) {
    super(message);
  }
}

// How long a request may take before it counts as unreachable.
const TIMEOUT_MS = 10_000;

// The server's errors a player can meet, in words they can act on. Anything
// else is a bug on one side or the other: it's shown as is.
const FRIENDLY: Record<string, string> = {
  "invalid pseudo or password": "That pseudo and password don't match. Check them and try again.",
  "pseudo already taken": "Someone in the garden already goes by that pseudo.",
  "pseudo and password are required": "Pick a pseudo and a password first.",
  "name already taken": "Another blob already has that name. Try a different one.",
  "no account goes by that friend's pseudo": "No one in the garden goes by that friend's pseudo. Check the spelling, or leave it empty.",
  "only a parent can name this blob": "Only its parents can name this blob.",
  rate_limited: "That's a lot of tries in a row. Wait a minute, then try again.",
  unauthorized: "Your session has expired. Log in again to get back to the garden.",
};
const SERVER_TROUBLE = "The garden is having trouble right now. Try again in a moment.";
export const OFFLINE_MESSAGE = "Can't reach the garden. Check your internet connection, then try again.";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "content-type": "application/json", ...init?.headers },
    });
  } catch {
    throw new ApiError(OFFLINE_MESSAGE, true);
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) {
    const code = body?.error;
    throw new ApiError(res.status >= 500 ? SERVER_TROUBLE : ((code && FRIENDLY[code]) ?? code ?? SERVER_TROUBLE), false, code);
  }
  return body as T;
}

/** Whether the garden's server answers at all (any answer will do). */
export function reachable(): Promise<boolean> {
  return fetch(API_URL, { signal: AbortSignal.timeout(5_000) }).then(
    () => true,
    () => false,
  );
}

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

export interface PseudoAvailability {
  available: boolean;
  suggestions?: string[];
}

export function checkPseudo(pseudo: string): Promise<PseudoAvailability> {
  return request(`/pseudo/${encodeURIComponent(pseudo)}`);
}

/** `friend`: an account's pseudo, to live on their island. */
export function register(pseudo: string, password: string, identity: Identity, country: string | null = null, friend = ""): Promise<AuthResponse> {
  return request("/auth/register", { method: "POST", body: JSON.stringify({ pseudo, password, ...identity, country, friend }) });
}

export function setCountry(token: string, country: string | null): Promise<{ ok: true }> {
  return request("/me/country", { method: "PATCH", headers: authHeader(token), body: JSON.stringify({ country }) });
}

export function setIdentity(token: string, identity: Identity): Promise<{ ok: true }> {
  return request("/me/identity", { method: "PATCH", headers: authHeader(token), body: JSON.stringify(identity) });
}

export function login(pseudo: string, password: string): Promise<AuthResponse> {
  return request("/auth/login", { method: "POST", body: JSON.stringify({ pseudo, password }) });
}

/** One region of the garden: `region`, or the player's own; `since`, a `step` from an earlier answer about it. */
export function getGarden(token: string, region?: number, since?: number): Promise<GardenResponse> {
  const query = new URLSearchParams();
  if (region !== undefined) query.set("region", String(region));
  if (since !== undefined) query.set("since", String(since));
  return request(`/garden${query.size ? `?${query}` : ""}`, { headers: authHeader(token) });
}

export function setVisibility(token: string, visible: boolean): Promise<{ ok: true }> {
  return request("/me/visibility", {
    method: "PATCH",
    headers: authHeader(token),
    body: JSON.stringify({ visible }),
  });
}

export function ping(token: string): Promise<{ ok: true }> {
  return request("/me/ping", { method: "PATCH", headers: authHeader(token) });
}

/** GET /tree/:seed — public, no token. Children's names share one namespace
 * with pseudos; unborn children are listed with a future `born_at`. */
export interface FamilyMember {
  seed: string;
  pseudo: string;
}

export interface FamilyChild {
  seed: string;
  name: string | null;
  born_at: number;
  depth: number;
  /** The couple it was born to. */
  parents: [FamilyMember, FamilyMember];
}

export interface FamilyTree {
  seed: string;
  name: string | null;
  parents: FamilyMember[] | null;
  partner: FamilyMember | null;
  children: FamilyChild[];
}

export function getTree(seed: string): Promise<FamilyTree> {
  return request(`/tree/${encodeURIComponent(seed)}`);
}

/** Parents only. Fails with "name already taken" when a pseudo or another child has it. */
export function renameChild(token: string, seed: string, name: string): Promise<{ ok: true; name: string }> {
  return request(`/blobs/${encodeURIComponent(seed)}/name`, {
    method: "PATCH",
    headers: authHeader(token),
    body: JSON.stringify({ name }),
  });
}

/** GET /blobs/:seed/relationships — public, like the family tree. */
export interface Relation {
  seed: string;
  name: string | null;
  status: RelationStatus;
  /** Each in [0, 100]. */
  friendship: number;
  romance: number;
  tension: number;
  kin: Kin | null;
  meetings: number;
  lastMetAt: number | null;
}

export function getRelationships(seed: string): Promise<{ relationships: Relation[] }> {
  return request(`/blobs/${encodeURIComponent(seed)}/relationships`);
}

/** GET /garden/journal — the garden's news, newest first. */
export interface GardenEvent {
  at: number;
  kind: "couple" | "breakup" | "birth" | "fight";
  a: string;
  aName: string | null;
  b: string;
  bName: string | null;
  /** The newborn, for a birth. */
  c: string | null;
  cName: string | null;
}

export function getGardenJournal(token: string): Promise<{ now: number; events: GardenEvent[] }> {
  return request("/garden/journal", { headers: authHeader(token) });
}
