import { Blobatar } from "@blobatar/react";
import { sad, sleepy, thinking, unsure } from "blobatar/expression";
import { RotateCw } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";

const FACES = { sad, sleepy, thinking, unsure };

/** Nothing to show, said kindly: a blob pulling a face, a title, why, and what to do. */
export function EmptyState({
  face = "thinking",
  seed = "blob",
  title,
  children,
  action,
}: {
  face?: keyof typeof FACES;
  seed?: string;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-6 text-center" role="status">
      <div className="toon-outline mb-1 size-16">
        <Blobatar name={seed} expression={FACES[face]} animate="always" className="block size-full" />
      </div>
      <h3 className="text-base font-bold">{title}</h3>
      <p className="max-w-64 text-sm text-balance text-muted-foreground">{children}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** A panel's load that failed: out of reach, or something else; `onRetry` tries again. */
export function LoadFailed({ error, what, onRetry }: { error: unknown; what: string; onRetry: () => void }) {
  const offline = error instanceof ApiError && error.offline;
  const retry = <RetryButton onRetry={onRetry} />;
  return offline ? (
    <EmptyState face="sad" title="No connection" action={retry}>
      The {what} lives online, in the garden. Check your internet connection, then try again.
    </EmptyState>
  ) : (
    <EmptyState face="unsure" title={`Couldn't load the ${what}`} action={retry}>
      {error instanceof Error ? error.message : String(error)}
    </EmptyState>
  );
}

export function RetryButton({ onRetry }: { onRetry: () => void | Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await Promise.resolve(onRetry()).finally(() => setBusy(false));
      }}
    >
      <RotateCw className={busy ? "animate-spin" : undefined} /> Try again
    </Button>
  );
}
