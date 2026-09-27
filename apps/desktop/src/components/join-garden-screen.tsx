import { MAX_NAME_LENGTH, type Identity } from "@blob-land/sim";
import { useState } from "react";
import { CountryField } from "@/components/country-field";
import { normalizeSeed } from "blobatar";
import { MenuScreen } from "@/components/main-menu";
import { Button } from "@/components/ui/button";
import { EmptyState, RetryButton } from "@/components/empty-state";
import { ApiError, checkPseudo, login, register, type AuthResponse } from "@/lib/api";

export interface JoinGardenScreenProps {
  /** Whether the garden's server can be reached; `onRetry` looks again. */
  online: boolean;
  onRetry: () => Promise<boolean>;
  localPseudo: string;
  /** Carried over to the account's blob. */
  identity: Identity;
  onJoined: (pseudo: string, response: AuthResponse) => void;
  onCancel: () => void;
}

export function JoinGardenScreen({ online, onRetry, localPseudo, identity, onJoined, onCancel }: JoinGardenScreenProps) {
  const [mode, setMode] = useState<"register" | "login">("register");
  const [pseudo, setPseudo] = useState(localPseudo);
  const [password, setPassword] = useState("");
  const [country, setCountry] = useState<string | null>(null);
  const [friend, setFriend] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuggestions([]);
    setPending(true);
    try {
      const response = await (mode === "login" ? login(pseudo, password) : register(pseudo, password, identity, country, friend));
      onJoined(pseudo, response);
    } catch (err) {
      if (mode === "register" && err instanceof ApiError && err.code === "pseudo already taken") {
        const availability = await checkPseudo(pseudo).catch(() => null);
        setSuggestions(availability?.suggestions ?? []);
        setError("Someone in the garden already goes by that pseudo. Pick one of these, or change it yourself.");
      } else {
        // Tauri plugins reject with plain strings, not Errors.
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <MenuScreen seed={normalizeSeed(pseudo.trim() || localPseudo)}>
      {!online ? (
        <div className="toon w-full">
          <EmptyState
            face="sad"
            seed={normalizeSeed(localPseudo)}
            title="The garden is out of reach"
            action={
              <div className="flex flex-col items-center gap-2">
                <RetryButton onRetry={onRetry} />
                <Button variant="link" onClick={onCancel}>
                  Back to the menu
                </Button>
              </div>
            }
          >
            Joining needs an internet connection, and the garden can't be reached right now. Your own island keeps living meanwhile.
          </EmptyState>
        </div>
      ) : (
      <form onSubmit={submit} className="toon flex w-full flex-col gap-3 p-5">
        <h2 className="text-xl font-bold">{mode === "login" ? "Log in to your account" : "Join the garden"}</h2>
        {mode === "register" ? (
          <p className="text-sm text-muted-foreground">
            Your private blob keeps its own seed either way — joining just grows a public copy in the garden.
          </p>
        ) : null}
        <input
          className="toon-input"
          placeholder="pseudo"
          maxLength={MAX_NAME_LENGTH}
          value={pseudo}
          onChange={(e) => setPseudo(e.target.value)}
          autoFocus
        />
        <input
          className="toon-input"
          placeholder="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {mode === "register" ? (
          <>
            <CountryField value={country} onChange={setCountry} />
            <input
              className="toon-input"
              placeholder="a friend's pseudo, to live on their island (optional)"
              maxLength={MAX_NAME_LENGTH}
              value={friend}
              onChange={(e) => setFriend(e.target.value)}
            />
          </>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {suggestions.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                className="rounded-lg border-2 border-ink bg-sun px-2 py-1 text-xs font-semibold shadow-[0_2px_0_var(--ink)]"
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
        <Button type="submit" size="lg" disabled={pending}>
          {mode === "login" ? "Log in" : "Join the garden"}
        </Button>
        <button
          type="button"
          className="text-sm font-medium text-muted-foreground underline decoration-2 underline-offset-4 hover:text-ink"
          onClick={() => setMode(mode === "login" ? "register" : "login")}
        >
          {mode === "login" ? "New account? Join instead" : "Already joined? Log in"}
        </button>
        <button type="button" className="text-sm font-medium text-muted-foreground underline decoration-2 underline-offset-4 hover:text-ink" onClick={onCancel}>
          Not now
        </button>
      </form>
      )}
    </MenuScreen>
  );
}
