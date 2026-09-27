import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "blobatar/motion.css";

// The performance bench (src/bench): `#bench` in dev, or a VITE_BENCH=1 build.
const Bench = lazy(() => import("./bench/bench"));
const bench = import.meta.env.VITE_BENCH === "1" || location.hash === "#bench";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {bench ? (
      <Suspense>
        <Bench />
      </Suspense>
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
