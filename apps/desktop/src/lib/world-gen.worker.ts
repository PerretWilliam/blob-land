// Lays out a garden island off the page (see use-garden-island.ts).
import { gardenIsland } from "./world-gen";

self.onmessage = (e: MessageEvent<{ size: number; region: number }>) => self.postMessage(gardenIsland(e.data.size, e.data.region));
