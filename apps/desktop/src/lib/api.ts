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
  paired: boolean;
}

export interface GardenResponse {
  blobs: GardenBlob[];
}

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

export function register(pseudo: string, password: string): Promise<AuthResponse> {
  return request("/auth/register", { method: "POST", body: JSON.stringify({ pseudo, password }) });
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
