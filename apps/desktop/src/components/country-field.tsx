import { COUNTRIES, flagOf } from "@blob-land/sim";

const names = new Intl.DisplayNames(["en"], { type: "region" });
export const countryName = (code: string) => names.of(code) ?? code;
// Alphabetical by name, not by code.
const OPTIONS = COUNTRIES.map((code) => ({ code, name: countryName(code) })).sort((a, b) => a.name.localeCompare(b.name));

/**
 * Where the player is from, shown as a flag next to their blob in the garden.
 * Optional: "Prefer not to say" keeps them anonymous.
 */
export function CountryField({ value, onChange }: { value: string | null; onChange: (country: string | null) => void }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm text-muted-foreground">Country (optional)</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="toon-input"
      >
        <option value="">Prefer not to say</option>
        {OPTIONS.map(({ code, name }) => (
          <option key={code} value={code}>
            {flagOf(code)} {name}
          </option>
        ))}
      </select>
    </label>
  );
}
