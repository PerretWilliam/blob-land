import { stateAt } from "@blob-land/sim";
import { Blobatar } from "@blobatar/react";
import { love } from "blobatar/expression";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { GardenBlob } from "@/lib/api";
import { useInView, usePrefersReducedMotion } from "@/lib/motion";

export interface GardenScreenProps {
  localPseudo: string;
  localSeed: string;
  account: { pseudo: string; seed: string } | null;
  blobs: GardenBlob[];
  visible: boolean;
  onToggleVisibility: () => void;
  onJoinGarden: () => void;
}

const PAGE_SIZE = 50;

export function GardenScreen({
  localPseudo,
  localSeed,
  account,
  blobs,
  visible,
  onToggleVisibility,
  onJoinGarden,
}: GardenScreenProps) {
  const reducedMotion = usePrefersReducedMotion();
  const pageCount = Math.max(1, Math.ceil(blobs.length / PAGE_SIZE));
  const [page, setPage] = useState(0);
  // Clamp rather than reset to 0, so a garden that shrinks below the current
  // page doesn't silently yank the visitor back to the first page.
  useEffect(() => setPage((p) => Math.min(p, pageCount - 1)), [pageCount]);

  const pageBlobs = blobs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  // A taken pseudo forces the account onto a different seed from the private
  // blob — when that happens, show both rather than pretending they're one.
  const accountIsSprout = account !== null && account.seed !== localSeed;

  return (
    <main className="min-h-screen bg-background p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{localPseudo}'s blob</h1>
        {account ? (
          <Button variant="outline" onClick={onToggleVisibility}>
            {visible ? "Visible in garden" : "Hidden from garden"}
          </Button>
        ) : (
          <Button onClick={onJoinGarden}>Join the garden</Button>
        )}
      </div>

      <div className="mb-8 flex gap-6">
        <PrivateBlobCard seed={localSeed} label={localPseudo} reducedMotion={reducedMotion} />
        {accountIsSprout ? (
          <PrivateBlobCard seed={account.seed} label={`${account.pseudo} (garden sprout)`} reducedMotion={reducedMotion} />
        ) : null}
      </div>

      {account ? (
        <>
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
        </>
      ) : null}
    </main>
  );
}

function PrivateBlobCard({ seed, label, reducedMotion }: { seed: string; label: string; reducedMotion: boolean }) {
  const [ref, inView] = useInView();
  const state = stateAt(seed, Date.now());

  return (
    <div ref={ref} className="flex flex-col items-center gap-2 rounded-lg border p-4">
      <Blobatar name={seed} size={96} animate={inView && !reducedMotion ? "always" : undefined} expression={state.expression} />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
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
