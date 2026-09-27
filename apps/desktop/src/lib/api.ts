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
  blobs: GardenBlob[];
}

/** The garden's clock, as last read from the server. */
export interface GardenClock {
  at: number;
  /** Local time when `at` was read. */
  readAt: number;
  rate: number;
}

export const gardenTime = (clock: GardenClock) => clock.at + (Date.now() - clock.readAt) * clock.rate;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(body?.error ?? `request failed: ${res.status}`);
  return body as T;
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

export function register(pseudo: string, password: string, identity: Identity, country: string | null = null): Promise<AuthResponse> {
  return request("/auth/register", { method: "POST", body: JSON.stringify({ pseudo, password, ...identity, country }) });
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

export function getGarden(token: string): Promise<GardenResponse> {
  return request("/garden", { headers: authHeader(token) });
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
