import { serve } from "@hono/node-server";
import { app } from "./app";
import { client, migrate } from "./db";
import { config } from "./env";
import { startStepping } from "./region";

// One server: the API, and its share of stepping the garden's regions. Run
// as many side by side as the load needs, all on the same Postgres.
if (config.devTools) console.warn(JSON.stringify({ event: "dev_tools_open", warning: "DEV_TOOLS=1 opens /__dev/*: never in production" }));
await migrate();
const server = serve({ fetch: app.fetch, port: config.port }, ({ port }) => console.log(JSON.stringify({ event: "listening", port })));
const stopStepping = startStepping();

// Docker stops a container with SIGTERM: finish the step and requests under way, then go.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    server.close();
    await stopStepping();
    await client.end({ timeout: 5 });
    process.exit(0);
  });
}
