import { stateAt } from "@blob-land/sim";
import { Blobatar } from "@blobatar/react";
import { love } from "blobatar/expression";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { GardenBlob } from "@/lib/api";
import { useInView, usePrefersReducedMotion } from "@/lib/motion";

export interface GardenScreenProps {
  pseudo: string;
  blobs: GardenBlob[];
  visible: boolean;
  onToggleVisibility: () => void;
}

const PAGE_SIZE = 50;

export function GardenScreen({ pseudo, blobs, visible, onToggleVisibility }: GardenScreenProps) {
  const reducedMotion = usePrefersReducedMotion();
  const pageCount = Math.max(1, Math.ceil(blobs.length / PAGE_SIZE));
  const [page, setPage] = useState(0);
  // Clamp rather than reset to 0, so a garden that shrinks below the current
  // page doesn't silently yank the visitor back to the first page.
  useEffect(() => setPage((p) => Math.min(p, pageCount - 1)), [pageCount]);

  const pageBlobs = blobs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <main className="min-h-screen bg-background p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{pseudo}'s garden</h1>
        <Button variant="outline" onClick={onToggleVisibility}>
          {visible ? "Visible in garden" : "Hidden from garden"}
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {pageBlobs.map((blob) => (
          <BlobCard key={blob.seed} blob={blob} reducedMotion={reducedMotion} />
        ))}
      </div>
      {pageCount > 1 ? (
        <div className="mt-6 flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page + 1} of {pageCount}
          </span>
          <Button variant="outline" size="sm" disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      ) : null}
    </main>
  );
}

function BlobCard({ blob, reducedMotion }: { blob: GardenBlob; reducedMotion: boolean }) {
  const [ref, inView] = useInView();
  const state = stateAt(blob.seed, Date.now());

  return (
    <div ref={ref} className="flex flex-col items-center gap-2 rounded-lg border p-4">
      <Blobatar
        name={blob.seed}
        size={96}
        animate={inView && !reducedMotion ? "always" : undefined}
        expression={blob.paired ? love : state.expression}
      />
      <p className="text-sm text-muted-foreground">{blob.pseudo ?? "a new blob"}</p>
    </div>
  );
}
