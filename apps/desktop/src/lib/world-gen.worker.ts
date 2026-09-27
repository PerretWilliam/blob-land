// Lays out a garden island off the page (see use-garden-island.ts).
import { gardenIsland } from "./world-gen";

self.onmessage = (e: MessageEvent<number>) => self.postMessage(gardenIsland(e.data));
