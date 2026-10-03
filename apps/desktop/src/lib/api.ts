import type { Attraction, Gait, Identity, Kin, Personality, RelationStatus, Segment, Sex, Spell } from "@blob-land/sim";
import { fetch } from "@tauri-apps/plugin-http";
import { t } from "@/i18n";

// plugin-http issues the request from the Rust side, not the webview, so it
// carries no Origin header and never hits the server's tauri://-only CORS check.
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
  /** Its character: the player's choice for their blob, rolled at birth for a child. */
  personality: Personality;
  /** Picked by its player; null walks as its character does. */
  gait: Gait | null;
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
  /** The region's sky: the spell on now and those to come (always in full). */
  weather: Spell[];
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "content-type": "application/json", ...init?.headers },
    });
  } catch {
    throw new ApiError(t().offline, true);
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) {
    const code = body?.error;
    // The server's errors a player can meet are said in their words (i18n
    // `errors`); anything else is a bug on one side or the other, shown as is.
    const said = t();
    throw new ApiError(res.status >= 500 ? said.serverTrouble : ((code && said.errors[code]) ?? code ?? said.serverTrouble), false, code);
  }
  return body as T;
}

/** Dev only: makes the garden run `scale` times faster than real time (the API needs DEV_TOOLS=1). Says the garden's time and rate then. */
export const setGardenSpeed = (scale: number) =>
  request<{ now: number; rate: number }>("/__dev/time-scale", { method: "POST", body: JSON.stringify({ scale }) });

/** Dev only: empties the garden's database and its clock, then seeds `count` blobs (the API needs DEV_TOOLS=1). */
export const resetGarden = (count: number) => request<{ regions: number[] }>("/__dev/reset", { method: "POST", body: JSON.stringify({ count }) });

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
export function register(pseudo: string, password: string, identity: Identity, country: string | null = null, friend = "", personality?: Personality, gait?: Gait): Promise<AuthResponse> {
  return request("/auth/register", { method: "POST", body: JSON.stringify({ pseudo, password, ...identity, country, friend, personality, gait }) });
}

export function setCountry(token: string, country: string | null): Promise<{ ok: true }> {
  return request("/me/country", { method: "PATCH", headers: authHeader(token), body: JSON.stringify({ country }) });
}

export function setIdentity(token: string, identity: Identity): Promise<{ ok: true }> {
  return request("/me/identity", { method: "PATCH", headers: authHeader(token), body: JSON.stringify(identity) });
}

export function setPersonality(token: string, personality: Personality): Promise<{ ok: true }> {
  return request("/me/personality", { method: "PATCH", headers: authHeader(token), body: JSON.stringify({ personality }) });
}

/** `null`: walk as its character does. */
export function setGait(token: string, gait: Gait | null): Promise<{ ok: true }> {
  return request("/me/gait", { method: "PATCH", headers: authHeader(token), body: JSON.stringify({ gait }) });
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

/** Deletes the account, its blob and its pseudo for good (the password again, to be sure). */
export function deleteAccount(token: string, password: string): Promise<{ ok: true }> {
  return request("/me", { method: "DELETE", headers: authHeader(token), body: JSON.stringify({ password }) });
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
  /** The couple it was born to: one of them only, when the other hides from the garden or left it. */
  parents: FamilyMember[];
}

export interface FamilyTree {
  seed: string;
  name: string | null;
  /** Null for a blob that wasn't born in the garden; those hidden or gone are left out. */
  parents: FamilyMember[] | null;
  partner: FamilyMember | null;
  children: FamilyChild[];
}

/** `token`, when signed in: a hidden player sees themselves in it. */
export function getTree(seed: string, token?: string | null): Promise<FamilyTree> {
  return request(`/tree/${encodeURIComponent(seed)}`, token ? { headers: authHeader(token) } : undefined);
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

export function getRelationships(seed: string, token?: string | null): Promise<{ relationships: Relation[] }> {
  return request(`/blobs/${encodeURIComponent(seed)}/relationships`, token ? { headers: authHeader(token) } : undefined);
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

/** GET /me/album — the player's own blob's big moments, newest first. */
export interface Milestone {
  kind: "friends" | "best_friends" | "crush" | "couple" | "child" | "made_up" | "first";
  /** For a first, what was done (an interaction kind); else the other blob, the child, or "". */
  key: string;
  at: number;
  /** Who it was with: the other blob, or the other parent and the child. */
  with: { seed: string; name: string }[];
}

export function getAlbum(token: string): Promise<{ milestones: Milestone[] }> {
  return request("/me/album", { headers: authHeader(token) });
}

/** The player's home island, while their blob is home on it: its timeline, as a region's, and when each visitor goes home. */
export type IslandResponse = { open: false } | (Omit<GardenResponse, "region" | "home" | "regions" | "size"> & { open: true; stays: { seed: string; until: number }[] });

/** The player's blob comes home to its island: it leaves the garden until the island is closed. */
export const openIsland = (token: string) => request<{ ok: true }>("/me/island", { method: "POST", headers: authHeader(token) });
/** Everyone on the island goes back to the garden. */
export const closeIsland = (token: string) => request<{ ok: true }>("/me/island", { method: "DELETE", headers: authHeader(token) });
export const getIsland = (token: string) => request<IslandResponse>("/me/island", { headers: authHeader(token) });
/** `name`: the pseudo of a player in the garden, whose blob comes over for a while. No one is told. */
export const inviteGuest = (token: string, name: string) =>
  request<{ ok: true }>("/me/island/guests", { method: "POST", headers: authHeader(token), body: JSON.stringify({ name: name.trim() }) });
export const sendGuestHome = (token: string, seed: string) => request<{ ok: true }>(`/me/island/guests/${encodeURIComponent(seed)}`, { method: "DELETE", headers: authHeader(token) });

/** The player's blob's own timeline, the last few days, wherever it was; with the names of whoever it met. */
export const getJournal = (token: string) => request<{ segments: Segment[]; names: Record<string, string> }>("/me/journal", { headers: authHeader(token) });
