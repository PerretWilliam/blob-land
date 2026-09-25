import { stateAt } from "@blob-land/sim";
import { Blobatar } from "@blobatar/react";
import { love } from "blobatar/expression";
import { Button } from "@/components/ui/button";
import type { GardenBlob } from "@/lib/api";

export interface GardenScreenProps {
  pseudo: string;
  blobs: GardenBlob[];
  visible: boolean;
  onToggleVisibility: () => void;
}

export function GardenScreen({ pseudo, blobs, visible, onToggleVisibility }: GardenScreenProps) {
  const now = Date.now();

  return (
    <main className="min-h-screen bg-background p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{pseudo}'s garden</h1>
        <Button variant="outline" onClick={onToggleVisibility}>
          {visible ? "Visible in garden" : "Hidden from garden"}
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {blobs.map((blob) => {
          const state = stateAt(blob.seed, now);
          return (
            <div key={blob.seed} className="flex flex-col items-center gap-2 rounded-lg border p-4">
              <Blobatar
                name={blob.seed}
                size={96}
                animate="always"
                expression={blob.paired ? love : state.expression}
              />
              <p className="text-sm text-muted-foreground">{blob.pseudo ?? "a new blob"}</p>
            </div>
          );
        })}
      </div>
    </main>
  );
}
