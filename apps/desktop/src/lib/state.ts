import { exists, mkdir, readTextFile, writeTextFile, BaseDirectory } from "@tauri-apps/plugin-fs";
import type { Language } from "@/i18n";
import type { LocalLife } from "@/lib/life";

export interface AppSettings {
  visible: boolean;
  /** Picked in the settings; unset, the system's language (if the app speaks it). */
  language?: Language;
}

export interface AccountState {
  pseudo: string;
  seed: string;
  token: string;
}

/**
 * Plaintext on disk in $APPDATA (R8: no keyring in this v1). The token is a
 * 30-day JWT, not a long-lived secret, so the exposure this accepts is bounded.
 *
 * `localSeed` is always present — it's the blob picked on first launch,
 * before any account exists. `account` is only set once the user explicitly
 * joins the garden, and its seed can differ from `localSeed` (a taken pseudo
 * forces a variant for the account only — the private blob never changes).
 */
export interface AppState {
  localPseudo: string;
  localSeed: string;
  createdAt: number;
  lastOpenedAt: number;
  settings: AppSettings;
  account: AccountState | null;
  /** The private blob's life, lived on this device (see lib/life.ts). */
  life: LocalLife;
}

const STATE_FILE = "state.json";

export async function loadState(): Promise<AppState | null> {
  if (!(await exists(STATE_FILE, { baseDir: BaseDirectory.AppData }))) return null;
  const text = await readTextFile(STATE_FILE, { baseDir: BaseDirectory.AppData });
  return JSON.parse(text) as AppState;
}

export async function saveState(state: AppState): Promise<void> {
  await mkdir("", { baseDir: BaseDirectory.AppData, recursive: true }).catch(() => {});
  await writeTextFile(STATE_FILE, JSON.stringify(state, null, 2), { baseDir: BaseDirectory.AppData });
}
