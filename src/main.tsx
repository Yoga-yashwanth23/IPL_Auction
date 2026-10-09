import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { bootstrapSession } from "@/lib/session";

function Boot() {
  const [state, setState] = useState<"loading" | "ready" | { error: string }>("loading");

  useEffect(() => {
    bootstrapSession()
      .then(() => setState("ready"))
      .catch((e: unknown) => setState({ error: e instanceof Error ? e.message : String(e) }));
  }, []);

  if (state === "ready") return <App />;

  return (
    <div className="flex min-h-screen items-center justify-center bg-abyss px-6 text-center text-parchment/70">
      {state === "loading" ? (
        <p className="text-sm">Preparing your private workspace…</p>
      ) : (
        <div className="max-w-md space-y-3">
          <p className="font-display text-lg text-parchment">Couldn't start your session</p>
          <p className="text-sm text-coral">{state.error}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md border border-wood-light/30 px-4 py-2 text-sm text-parchment hover:bg-cove"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Boot />
  </React.StrictMode>
);
