import { Blobatar } from "@blobatar/react";
import * as expr from "blobatar/expression";

/**
 * Step 2 smoke test: every expression in the roster, on three fixed seeds,
 * animated. Not a real screen — this goes away once the sim engine (step 3)
 * drives `expression` for real. Verifies blobatar renders + motion.css works
 * in each OS's webview (WebKitGTK on Linux is the risk — see plan R3).
 */
const SEEDS = ["alice", "bob", "coralie"];
const EXPRESSIONS = Object.entries(expr).filter(
  ([, v]) => typeof v === "object" && v !== null && "p" in v,
) as [string, expr.Expression][];

export default function App() {
  return (
    <main className="min-h-screen bg-background p-8">
      <h1 className="mb-6 text-2xl font-semibold">Blob — expression smoke test</h1>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {SEEDS.map((seed) =>
          EXPRESSIONS.map(([exprName, expression]) => (
            <div
              key={`${seed}-${exprName}`}
              className="flex flex-col items-center gap-2 rounded-lg border p-4"
            >
              <Blobatar
                name={seed}
                size={96}
                animate="always"
                expression={expression}
              />
              <p className="text-sm text-muted-foreground">
                {seed} · {exprName}
              </p>
            </div>
          )),
        )}
      </div>
    </main>
  );
}
