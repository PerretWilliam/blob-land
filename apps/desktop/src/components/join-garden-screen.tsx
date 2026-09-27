import type { Identity } from "@blob-land/sim";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { checkPseudo, login, register, type AuthResponse } from "@/lib/api";

export interface JoinGardenScreenProps {
  localPseudo: string;
  /** Carried over to the account's blob. */
  identity: Identity;
  onJoined: (pseudo: string, response: AuthResponse) => void;
  onCancel: () => void;
}

export function JoinGardenScreen({ localPseudo, identity, onJoined, onCancel }: JoinGardenScreenProps) {
  const [mode, setMode] = useState<"register" | "login">("register");
  const [pseudo, setPseudo] = useState(localPseudo);
  const [password, setPassword] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuggestions([]);
    setPending(true);
    try {
      const response = await (mode === "login" ? login(pseudo, password) : register(pseudo, password, identity));
      onJoined(pseudo, response);
    } catch (err) {
      const message = err instanceof Error ? err.message : "something went wrong";
      if (mode === "register" && message === "pseudo already taken") {
        const availability = await checkPseudo(pseudo);
        setSuggestions(availability.suggestions ?? []);
        setError("That pseudo is already taken for an account — pick a variant below, or edit it yourself.");
      } else {
        setError(message);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-8">
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4 rounded-lg border p-6">
        <h1 className="text-xl font-semibold">{mode === "login" ? "Log in to your account" : "Join the garden"}</h1>
        {mode === "register" ? (
          <p className="text-sm text-muted-foreground">
            Your private blob keeps its own seed either way — joining just grows a public copy in the garden.
          </p>
        ) : null}
        <input
          className="rounded-md border bg-transparent px-3 py-2 text-sm"
          placeholder="pseudo"
          value={pseudo}
          onChange={(e) => setPseudo(e.target.value)}
          autoFocus
        />
        <input
          className="rounded-md border bg-transparent px-3 py-2 text-sm"
          placeholder="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {suggestions.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                className="rounded-md border px-2 py-1 text-xs"
                onClick={() => {
                  setPseudo(s);
                  setSuggestions([]);
                  setError(null);
                }}
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}
        <Button type="submit" disabled={pending}>
          {mode === "login" ? "Log in" : "Join the garden"}
        </Button>
        <button
          type="button"
          className="text-sm text-muted-foreground underline"
          onClick={() => setMode(mode === "login" ? "register" : "login")}
        >
          {mode === "login" ? "New account? Join instead" : "Already joined? Log in"}
        </button>
        <button type="button" className="text-sm text-muted-foreground underline" onClick={onCancel}>
          Not now
        </button>
      </form>
    </main>
  );
}
