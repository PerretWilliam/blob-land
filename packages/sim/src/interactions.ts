import { between, weighted, type Rng } from "./rng";
import type { Delta, RelationStatus, Relationship } from "./relationship";
import { wet, type Season, type Weather } from "./weather";

export const INTERACTIONS = [
  "chat",
  "play",
  "dance",
  "hug",
  "gift",
  "flirt",
  "kiss",
  "argue",
  "make_up",
  "sulk",
  "ignore",
  "parent_play",
  "confess",
  "comfort",
  "tease",
  "share_find",
  "nap_together",
  "high_five",
  "chase",
  "whisper",
  "stargaze",
  "piggyback",
  // Only in the right weather, or the right season.
  "shelter",
  "splash",
  "snowball",
  "snowman",
  "flowers",
  "leaf_pile",
  "fireflies",
  // A whole gathering's, never one pair's on its own.
  "ring_dance",
  "story",
  "sing",
  "group_hug",
  "tag",
  "cheer",
] as const;
export type InteractionKind = (typeof INTERACTIONS)[number];
export type Outcome = "good" | "meh" | "bad";

type Weights = Partial<Record<InteractionKind, number>>;

/**
 * What each relationship allows, and how likely. This is the guard against
 * randomness going nowhere sensible: rivals can't hug, and strangers don't
 * kiss — whatever the dice say.
 */
const BY_STATUS: Record<RelationStatus, Weights> = {
  strangers: { chat: 5, play: 2, ignore: 2, gift: 0.5, flirt: 1, shelter: 2 },
  acquaintances: { chat: 5, play: 3, ignore: 1, gift: 1, argue: 1, flirt: 2.5, tease: 1, comfort: 0.3, share_find: 2, high_five: 0.7, chase: 0.3, shelter: 2, splash: 1, snowball: 1.5, snowman: 1, flowers: 1, leaf_pile: 1 },
  friends: { chat: 4, play: 4, dance: 2, hug: 2, gift: 1, argue: 1.5, flirt: 3.5, tease: 2, comfort: 1, share_find: 3, high_five: 1.2, chase: 1, whisper: 0.5, shelter: 2, splash: 2, snowball: 3, snowman: 2, flowers: 1.5, leaf_pile: 2.5, fireflies: 1.5 },
  best_friends: { chat: 4, play: 4, dance: 3, hug: 3, gift: 1.5, argue: 1.2, flirt: 3, tease: 2.5, comfort: 1.5, share_find: 3, nap_together: 1, high_five: 1.5, chase: 1.5, whisper: 1.5, stargaze: 1, shelter: 2.5, splash: 2.5, snowball: 3, snowman: 2.5, flowers: 1.5, leaf_pile: 3, fireflies: 2 },
  crush: { chat: 2, flirt: 5, gift: 2, dance: 2, hug: 1, play: 1, argue: 0.8, confess: 1.5, comfort: 0.5, share_find: 2, whisper: 1, stargaze: 1, chase: 0.5, shelter: 3, splash: 1, snowball: 1, flowers: 3, fireflies: 2.5 },
  lovers: { hug: 4, kiss: 4, dance: 3, gift: 2, chat: 2, play: 2, argue: 1.6, sulk: 0.4, tease: 1.5, comfort: 1.5, share_find: 2, nap_together: 2, whisper: 1.5, stargaze: 2, chase: 1, piggyback: 0.7, shelter: 3, splash: 1.5, snowball: 1.5, snowman: 2, flowers: 3, leaf_pile: 1.5, fireflies: 3 },
  complicated: { chat: 2, argue: 3, make_up: 2, sulk: 2, ignore: 1, shelter: 1 },
  // A snowball fight with a rival is no game.
  rivals: { argue: 4, sulk: 2, ignore: 3, make_up: 0.5, tease: 1.5, snowball: 1.5 },
  ex: { ignore: 4, sulk: 2, argue: 2, chat: 1, make_up: 0.5 },
  family: { parent_play: 4, hug: 3, chat: 3, play: 2, argue: 1, tease: 1, comfort: 1.5, share_find: 3, nap_together: 2, high_five: 1, chase: 1.5, piggyback: 2, whisper: 0.5, shelter: 2, splash: 2, snowball: 2.5, snowman: 3, flowers: 2, leaf_pile: 3, fireflies: 2 },
};

/** The sky a meeting happens under. */
export interface Sky {
  weather: Weather;
  season: Season;
  /** Night has fallen: stars to look at, fireflies to watch. */
  night: boolean;
}

/** Whether `kind` can happen under `sky`: what rain, snow and the season make possible, and what they rule out. */
export function fitsSky(kind: InteractionKind, { weather, season, night }: Sky): boolean {
  switch (kind) {
    case "shelter":
    case "splash":
      return wet(weather);
    case "snowball":
    case "snowman":
      return weather === "snow";
    case "flowers":
      return (season === "blossom" || season === "bloom") && !night && (weather === "clear" || weather === "cloudy");
    case "leaf_pile":
      return season === "falling_leaves" && !night && !wet(weather);
    case "fireflies":
      return (season === "fireflies" || season === "summer") && night && !wet(weather);
    case "stargaze":
      return night && weather === "clear";
    default:
      return true;
  }
}

/** Every kind a status can ever produce — what tests hold pickInteraction to. */
export const allowedFor = (status: RelationStatus) => Object.keys(BY_STATUS[status]) as InteractionKind[];

const ROMANTIC: readonly InteractionKind[] = ["flirt", "kiss", "confess"];

const FRIENDLY: readonly RelationStatus[] = ["acquaintances", "friends", "best_friends", "crush", "lovers", "family"];
const CLOSE: readonly RelationStatus[] = ["friends", "best_friends", "crush", "lovers", "family"];
// What a whole gathering does as one, and which pairs join in: the rest do
// their own thing on the side. A group hug needs everyone close.
const TOGETHER: Partial<Record<InteractionKind, readonly RelationStatus[]>> = {
  story: [...FRIENDLY, "strangers", "complicated", "ex"],
  shelter: [...FRIENDLY, "strangers", "complicated"],
  snowball: [...FRIENDLY, "strangers", "rivals"],
  snowman: [...FRIENDLY, "strangers"],
  leaf_pile: [...FRIENDLY, "strangers"],
  sing: [...FRIENDLY, "strangers"],
  tag: [...FRIENDLY, "strangers"],
  cheer: [...FRIENDLY, "strangers"],
  ring_dance: FRIENDLY,
  group_hug: CLOSE,
};

/** Whether a pair joins in what its gathering does together. */
export const joinsIn = (kind: InteractionKind, status: RelationStatus) => TOGETHER[kind]?.includes(status) ?? allowedFor(status).includes(kind);

/** What a gathering does together, by the mean of its playfulness. `close`: every pair among them is. */
export function pickTogether(rng: Rng, playful: number, close: boolean, found: boolean, sky: Sky): InteractionKind {
  // Rain sends a crowd under the nearest tree; it doesn't dance in it.
  const out = wet(sky.weather) ? 0.3 : 1;
  const w: Weights = {
    chat: 4,
    story: 2,
    sing: 1.5,
    play: 3 * playful * out,
    tag: 2 * playful * out,
    dance: 1.5 * playful * out,
    ring_dance: 1.5 * playful * out,
    group_hug: close ? 2 : 0,
    // Someone has just found something: everyone wants to see.
    cheer: found ? 2 : 0,
    shelter: 4,
    snowball: 2 + 3 * playful,
    snowman: 3,
    leaf_pile: 1 + 3 * playful,
  };
  for (const kind of Object.keys(w) as InteractionKind[]) if (!fitsSky(kind, sky)) delete w[kind];
  return weighted(rng, w);
}

/** Every pair among `statuses` is close enough for a group hug. */
export const allClose = (statuses: readonly RelationStatus[]) => statuses.every((s) => CLOSE.includes(s));

export interface MeetingContext extends Sky {
  rel: Relationship;
  /** Mutually attracted, both adults, not family: romance is on the table. */
  canRomance: boolean;
  /** One is the other's parent and the child is still young. */
  parentAndChild: boolean;
  /** Each in [-1, 1]. */
  moodA: number;
  moodB: number;
  /** Means of both personalities, each in [0, 1]. */
  temper: number;
  playfulness: number;
  romance: number;
  kindness: number;
  /** Either of them is with someone else: the loyalty of the more loyal one
   * of those, which holds a flirt back. Null when both are free. */
  taken: number | null;
  /** Mean energy of both, in [0, 1]. */
  energy: number;
  /** One of them has just found something on a walk. */
  found: boolean;
}

export function pickInteraction(ctx: MeetingContext, rng: Rng): InteractionKind {
  const w: Weights = { ...BY_STATUS[ctx.rel.status] };
  if (!ctx.canRomance) for (const kind of ROMANTIC) delete w[kind];
  if (!ctx.parentAndChild) delete w.parent_play;
  if (!ctx.found) delete w.share_find;
  for (const kind of Object.keys(w) as InteractionKind[]) if (!fitsSky(kind, ctx)) delete w[kind];
  // Personality and mood tilt the table, never add to it.
  const mood = (ctx.moodA + ctx.moodB) / 2;
  const chem = ctx.rel.chemistry;
  const scale = (kind: InteractionKind, by: number) => {
    if (w[kind] !== undefined) w[kind] = w[kind]! * by;
  };
  scale("play", 0.5 + ctx.playfulness);
  scale("dance", 0.5 + ctx.playfulness);
  // A spark feeds itself: the more romance there is, the more flirting.
  // Spoken for, a loyal blob mostly keeps it to itself.
  scale("flirt", (0.3 + 1.4 * ctx.romance) * Math.max(0.1, 1 + 1.5 * chem) * (1 + ctx.rel.romance / 25) * (ctx.taken === null ? 1 : 0.5 * (1 - ctx.taken)));
  // …and so does a grudge: every fight makes the next one likelier. Kindness
  // picks fewer fights, and makes up sooner.
  scale("argue", (0.5 + ctx.temper) * (1.3 - 0.6 * ctx.kindness) * (1 - 0.6 * mood) * (1 - 0.5 * chem) * (1 + ctx.rel.tension / 20));
  scale("make_up", 0.5 + ctx.kindness);
  scale("ignore", 1 + ctx.rel.tension / 30);
  scale("sulk", 1 - 0.6 * mood);
  scale("hug", 1 + 0.5 * mood);
  scale("make_up", 1 + 0.5 * mood);
  // Only once a crush runs deep, and a romantic blob says so sooner.
  scale("confess", (0.3 + 1.4 * ctx.romance) * Math.max(0, ctx.rel.romance - 30) / 20);
  // Someone's low: the kinder they are, the likelier a shoulder. Nobody low, no comfort.
  scale("comfort", (0.3 + 1.4 * ctx.kindness) * 6 * Math.max(0, -Math.min(ctx.moodA, ctx.moodB) - 0.1));
  scale("tease", (0.3 + ctx.playfulness) * (0.6 + 0.8 * ctx.temper));
  // Only when both are flagging (below a quarter, they're off to bed instead).
  scale("nap_together", 10 * Math.max(0, 0.55 - ctx.energy));
  scale("high_five", (0.5 + ctx.playfulness) * (1 + 0.5 * mood));
  scale("chase", 0.3 + 1.4 * ctx.playfulness);
  scale("stargaze", (0.5 + ctx.romance) * (ctx.season === "shooting_stars" ? 3 : 1));
  // Out in the rain, games give way to finding cover.
  if (wet(ctx.weather)) for (const kind of ["play", "chase", "dance", "high_five"] as const) scale(kind, 0.4);
  scale("snowball", 0.5 + ctx.playfulness);
  scale("splash", 0.4 + 1.2 * ctx.playfulness);
  scale("leaf_pile", 0.5 + ctx.playfulness);
  scale("flowers", 0.5 + 0.5 * ctx.romance + 0.5 * ctx.kindness);
  scale("fireflies", 0.5 + ctx.romance);
  // Everything else was ruled out (a family with no small child left to play with, say).
  if (Object.keys(w).length === 0) return "chat";
  return weighted(rng, w);
}

/** How it went: moods and temper tilt it, and so does history — lingering
 * tension makes a good time harder to have. */
export function rollOutcome(ctx: MeetingContext, rng: Rng): Outcome {
  const mood = (ctx.moodA + ctx.moodB) / 2;
  const tension = ctx.rel.tension / 100;
  const chem = ctx.rel.chemistry;
  const bad = Math.max(0.03, 0.12 - 0.1 * mood + 0.3 * ctx.temper + 0.3 * tension - 0.2 * chem);
  const good = Math.max(0.1, 0.6 + 0.2 * mood - 0.2 * ctx.temper - 0.3 * tension + 0.2 * chem);
  const roll = rng();
  return roll < bad ? "bad" : roll < bad + good ? "good" : "meh";
}

// [friendship, romance, tension] for a good, meh and bad outcome.
type Triple = readonly [number, number, number];
const DELTAS: Record<InteractionKind, readonly [Triple, Triple, Triple]> = {
  chat: [[3, 0, -2], [1, 0, 0], [-2, 0, 4]],
  play: [[4, 0, -2], [1, 0, 0], [-2, 0, 5]],
  dance: [[3, 2, -2], [1, 0, 0], [0, -1, 2]],
  hug: [[3, 2, -4], [1, 0, -1], [0, -1, 2]],
  gift: [[3, 3, -3], [1, 1, 0], [0, -1, 2]],
  flirt: [[1, 7, 0], [0, 4, 0], [0, -3, 3]],
  kiss: [[1, 6, -2], [0, 2, 0], [0, -3, 3]],
  argue: [[0, 0, -3], [-2, -1, 5], [-5, -3, 8]],
  make_up: [[4, 2, -8], [1, 0, -3], [-1, 0, 3]],
  sulk: [[0, 0, -1], [-1, 0, 2], [-2, -1, 3]],
  ignore: [[0, 0, -1], [-1, 0, 0], [-1, 0, 2]],
  parent_play: [[4, 0, -2], [2, 0, 0], [0, 0, 2]],
  confess: [[2, 8, -2], [0, 3, 0], [-1, -5, 3]],
  comfort: [[4, 1, -3], [2, 0, -1], [0, 0, 1]],
  tease: [[3, 1, -1], [1, 0, 1], [-2, 0, 5]],
  share_find: [[4, 1, -2], [2, 0, 0], [0, 0, 2]],
  nap_together: [[2, 1, -3], [1, 0, -1], [0, 0, 1]],
  high_five: [[3, 0, -2], [1, 0, 0], [-1, 0, 2]],
  chase: [[4, 1, -2], [1, 0, 0], [-2, 0, 4]],
  // A secret kept brings them closer; one spilled stings.
  whisper: [[4, 1, -2], [1, 0, 0], [-2, 0, 4]],
  stargaze: [[2, 4, -2], [1, 1, 0], [0, -1, 1]],
  piggyback: [[4, 1, -2], [2, 0, 0], [-1, 0, 2]],
  shelter: [[3, 1, -2], [1, 0, 0], [-1, 0, 2]],
  splash: [[4, 0, -2], [1, 0, 0], [-2, 0, 4]],
  // A snowball too hard, or in the face, and it's war.
  snowball: [[4, 0, -2], [1, 0, 1], [-3, 0, 5]],
  snowman: [[4, 1, -2], [2, 0, 0], [-1, 0, 2]],
  flowers: [[3, 3, -2], [1, 1, 0], [0, -1, 1]],
  leaf_pile: [[4, 0, -2], [1, 0, 0], [-1, 0, 2]],
  fireflies: [[3, 3, -2], [1, 1, 0], [0, 0, 1]],
  ring_dance: [[3, 1, -2], [1, 0, 0], [0, 0, 2]],
  story: [[3, 0, -1], [1, 0, 0], [-1, 0, 2]],
  sing: [[3, 1, -1], [1, 0, 0], [-1, 0, 2]],
  group_hug: [[4, 1, -4], [1, 0, -1], [0, 0, 2]],
  tag: [[4, 0, -2], [1, 0, 0], [-2, 0, 4]],
  cheer: [[3, 0, -2], [1, 0, 0], [0, 0, 1]],
};

/** The most any axis moves in one meeting: no one goes from stranger to best friend in a day. */
export const MAX_STEP = 8;

export function deltaFor(kind: InteractionKind, outcome: Outcome, ctx: MeetingContext, rng: Rng): Delta {
  const [f, r, t] = DELTAS[kind][outcome === "good" ? 0 : outcome === "meh" ? 1 : 2];
  const jitter = () => between(rng, 0.5, 1.5);
  const cap = (v: number) => Math.max(-MAX_STEP, Math.min(MAX_STEP, v));
  // Chemistry colours everything: friction stings more between blobs who grate.
  const chem = ctx.rel.chemistry;
  return {
    friendship: cap(f * jitter() * (f > 0 ? 1 + chem : 1 - 0.5 * chem)),
    // Without mutual attraction romance can only fade, and without chemistry it barely grows.
    romance: cap(ctx.canRomance ? r * jitter() * (0.5 + ctx.romance) * (r > 0 ? 1 + chem : 1) : Math.min(0, r)),
    tension: cap(t * jitter() * (0.6 + 0.8 * ctx.temper) * (t > 0 ? (1 - chem) * (1.3 - 0.6 * ctx.kindness) : 1 + 0.5 * chem)),
  };
}

/** How a meeting leaves one of them feeling: a nudge to mood, which lives in
 * [-1, 1]. Who it was with counts: a good time with a sweetheart or a best
 * friend lifts more, and even a nice moment with a rival doesn't. */
export function moodShift(kind: InteractionKind, outcome: Outcome, status: RelationStatus = "acquaintances"): number {
  // A real fight stays with you.
  if (outcome === "bad") return kind === "argue" ? -0.4 : -0.25;
  if (kind === "argue" || kind === "sulk" || kind === "ignore") return outcome === "good" ? 0 : -0.15;
  if (status === "rivals" || status === "ex") return outcome === "good" ? 0 : -0.1;
  const close = status === "lovers" || status === "crush" || status === "best_friends" ? 1.5 : 1;
  // A shoulder to lean on lifts more than a good time.
  return (outcome === "good" ? (kind === "comfort" ? 0.35 : 0.2) : 0.05) * close;
}

/** The face one of them wears: the moment, coloured by who it's with. A blob
 * in love is starry-eyed chatting with its sweetheart; a crush makes it shy;
 * even a pleasant moment with a rival or an ex stays awkward. */
export function feeling(kind: InteractionKind, outcome: Outcome, status: RelationStatus): string {
  if (kind === "argue" || outcome === "bad") return interactionExpression(kind, outcome);
  if (kind === "nap_together") return "sleepy";
  if (status === "lovers") return "love";
  if (status === "crush") return outcome === "good" ? "love" : "shy";
  if (status === "rivals" || status === "ex") return kind === "ignore" ? "smug" : "unsure";
  return interactionExpression(kind, outcome);
}

/** The blobatar expression both wear while it happens. */
export function interactionExpression(kind: InteractionKind, outcome: Outcome): string {
  if (outcome === "bad") return kind === "argue" ? "mad" : kind === "flirt" || kind === "kiss" || kind === "confess" ? "sad" : "unsure";
  switch (kind) {
    case "hug":
    case "kiss":
    case "group_hug":
      return "love";
    case "whisper":
      return outcome === "good" ? "wink" : "shy";
    case "stargaze":
      return outcome === "good" ? "happy" : "thinking";
    case "fireflies":
      return outcome === "good" ? "surprised" : "thinking";
    case "snowman":
      return outcome === "good" ? "happy" : "thinking";
    case "shelter":
    case "flowers":
      return outcome === "good" ? "happy" : "idle";
    case "story":
      return outcome === "good" ? "surprised" : "idle";
    case "flirt":
      return "shy";
    case "confess":
      return outcome === "good" ? "love" : "shy";
    case "tease":
      return outcome === "good" ? "happy" : "smug";
    case "nap_together":
      return "sleepy";
    case "gift":
      return outcome === "good" ? "love" : "happy";
    case "argue":
      return outcome === "good" ? "unsure" : "mad";
    case "make_up":
      return outcome === "good" ? "happy" : "shy";
    case "sulk":
      return "sad";
    case "ignore":
      return "smug";
    case "chat":
      return outcome === "good" ? "happy" : "idle";
    default:
      return "happy";
  }
}
