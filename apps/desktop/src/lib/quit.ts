import { invoke, isTauri } from "@tauri-apps/api/core";

/** Whether the app can close itself: only the desktop app, not the Vite page in a browser. */
export const canQuit = isTauri();

/** Closes the app for good (closing its window only hides it, so the blob goes on living). */
export const quit = () => invoke("quit");
