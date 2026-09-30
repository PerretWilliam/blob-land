import { COUNTRIES, flagOf } from "@blob-land/sim";
import { countryName, language, useT } from "@/i18n";

/**
 * Where the player is from, shown as a flag next to their blob in the garden.
 * Optional: "Prefer not to say" keeps them anonymous.
 */
export function CountryField({ value, onChange }: { value: string | null; onChange: (country: string | null) => void }) {
  const t = useT();
  // Alphabetical by name in the language on screen, not by code.
  const options = COUNTRIES.map((code) => ({ code, name: countryName(code) })).sort((a, b) => a.name.localeCompare(b.name, language()));
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm text-muted-foreground">{t.country.label}</span>
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className="toon-input">
        <option value="">{t.country.none}</option>
        {options.map(({ code, name }) => (
          <option key={code} value={code}>
            {flagOf(code)} {name}
          </option>
        ))}
      </select>
    </label>
  );
}
