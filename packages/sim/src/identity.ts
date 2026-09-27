import { between, pick, weighted, type Rng } from "./rng";

export const SEXES = ["female", "male", "none"] as const;
export type Sex = (typeof SEXES)[number];
export const ATTRACTIONS = ["women", "men", "any"] as const;
export type Attraction = (typeof ATTRACTIONS)[number];

/** Who a blob is and who it falls for. Chosen by the player for their own
 * blob, rolled at birth for a child. */
export interface Identity {
  sex: Sex;
  attraction: Attraction;
}

/** Temperament, each in [0, 1]. Nudges what a blob does, never dictates it. */
export interface Personality {
  /** How often it goes looking for company. */
  sociability: number;
  /** How easily a meeting turns sour. */
  temper: number;
  /** Play and dance over chat. */
  playfulness: number;
  /** How fast a liking turns into a crush. */
  romance: number;
  /** Early bird (0) to night owl (1): shifts its bedtime and waking by up to
   * 4 hours either way, so the garden is never all asleep at once. */
  chronotype: number;
}

export const isSex = (v: unknown): v is Sex => SEXES.includes(v as Sex);
export const isAttraction = (v: unknown): v is Attraction => ATTRACTIONS.includes(v as Attraction);

/** Whether `a` is drawn to `b`. A blob with no sex only draws those attracted to anyone. */
export function drawnTo(a: Identity, b: Identity): boolean {
  if (a.attraction === "any") return true;
  return (a.attraction === "women" && b.sex === "female") || (a.attraction === "men" && b.sex === "male");
}

/** Romance needs both ways; otherwise the best it gets is best friends. */
export const compatible = (a: Identity, b: Identity) => drawnTo(a, b) && drawnTo(b, a);

/** The longest a pseudo or a blob's name can be: short enough to read over a blob's head. */
export const MAX_NAME_LENGTH = 16;

const FIRST_NAMES = [
  "Lucas", "Emma", "Hugo", "Chloé", "Louis", "Léa", "Nathan", "Manon", "Jules", "Camille", "Theo", "Inès", "Noah", "Zoé", "Adam", "Jade",
  "Liam", "Olivia", "Mateo", "Sofia", "Kenji", "Yuki", "Aiko", "Ravi", "Priya", "Omar", "Amira", "Tariq", "Lena", "Jonas", "Mila", "Finn",
  "Elif", "Can", "Sven", "Astrid", "Diego", "Lucía", "Marco", "Giulia", "Ana", "João", "Kofi", "Ama", "Min", "Seo-yeon", "Mei", "Wei",
  "Nina", "Oscar", "Ruby", "Leo", "Iris", "Max", "Luna", "Sam", "Alex", "Charlie", "Robin", "Eden", "Noor", "Maya", "Tom", "Anna",
];
const NICKNAMES = [
  "pixel", "mochi", "nova", "kiwi", "bubble", "pepper", "echo", "biscuit", "comet", "sunny", "tofu", "maple", "ziggy", "pudding", "sprout", "nimbus",
  "cosmo", "peanut", "frost", "marble", "juniper", "gizmo", "noodle", "clover", "sparrow", "waffle", "orbit", "cinder", "pebble", "fable",
];

/**
 * A pseudo like players pick: a first name as is, lowercased, with a year
 * or an initial, or a nickname. Never over MAX_NAME_LENGTH. For filling a
 * garden with made-up players (dev tools, the bench); not guaranteed unique.
 */
export function playerPseudo(rng: Rng): string {
  const name = pick(rng, rng() < 0.7 ? FIRST_NAMES : NICKNAMES);
  const cased = rng() < 0.5 ? name.toLowerCase() : name.charAt(0).toUpperCase() + name.slice(1);
  const style = rng();
  const pseudo =
    style < 0.35 ? cased
    : style < 0.6 ? `${cased}${Math.floor(rng() * 100).toString().padStart(2, "0")}`
    : style < 0.75 ? `${cased}_${"abcdefghijklmnoprstvz"[Math.floor(rng() * 21)]}`
    : style < 0.9 ? `${cased}${1985 + Math.floor(rng() * 25)}`
    : `the${name.charAt(0).toUpperCase()}${name.slice(1).toLowerCase()}`;
  return pseudo.slice(0, MAX_NAME_LENGTH);
}

export function randomPersonality(rng: Rng): Personality {
  return { sociability: rng(), temper: rng(), playfulness: rng(), romance: rng(), chronotype: rng() };
}

/** A child's identity: rolled, not inherited. */
export function randomIdentity(rng: Rng): Identity {
  const sex = weighted<Sex>(rng, { female: 45, male: 45, none: 10 });
  if (sex === "none") return { sex, attraction: "any" };
  const opposite: Attraction = sex === "female" ? "men" : "women";
  const same: Attraction = sex === "female" ? "women" : "men";
  return { sex, attraction: weighted<Attraction>(rng, { [opposite]: 70, [same]: 15, any: 15 }) };
}

/** Somewhere between the two parents, plus a little of its own. */
export function childPersonality(a: Personality, b: Personality, rng: Rng): Personality {
  const mix = (x: number, y: number) => Math.min(1, Math.max(0, x + (y - x) * rng() + between(rng, -0.15, 0.15)));
  return {
    sociability: mix(a.sociability, b.sociability),
    temper: mix(a.temper, b.temper),
    playfulness: mix(a.playfulness, b.playfulness),
    romance: mix(a.romance, b.romance),
    chronotype: mix(a.chronotype, b.chronotype),
  };
}
