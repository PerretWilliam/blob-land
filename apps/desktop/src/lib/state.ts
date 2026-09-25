import { exists, mkdir, readTextFile, writeTextFile, BaseDirectory } from "@tauri-apps/plugin-fs";

export interface AppSettings {
  visible: boolean;
}

/**
 * Plaintext on disk in $APPDATA (R8: no keyring in this v1). The token is a
 * 30-day JWT, not a long-lived secret, so the exposure this accepts is bounded.
 */
export interface AppState {
  pseudo: string;
  seed: string;
  token: string;
  createdAt: number;
  lastOpenedAt: number;
  settings: AppSettings;
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
