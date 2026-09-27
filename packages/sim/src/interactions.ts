import { between, weighted, type Rng } from "./rng";
import type { Delta, RelationStatus, Relationship } from "./relationship";

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
  strangers: { chat: 5, play: 2, ignore: 2, gift: 0.5, flirt: 0.8 },
  acquaintances: { chat: 5, play: 3, ignore: 1, gift: 1, argue: 0.5, flirt: 1 },
  friends: { chat: 4, play: 4, dance: 2, hug: 2, gift: 1, argue: 1.5, flirt: 1.2 },
  best_friends: { chat: 4, play: 4, dance: 3, hug: 3, gift: 1.5, argue: 1.2, flirt: 1.2 },
  crush: { chat: 2, flirt: 5, gift: 2, dance: 2, hug: 1, play: 1, argue: 0.8 },
  lovers: { hug: 4, kiss: 4, dance: 3, gift: 2, chat: 2, play: 2, argue: 1.2 },
  complicated: { chat: 2, argue: 3, make_up: 2, sulk: 2, ignore: 1 },
  rivals: { argue: 4, sulk: 2, ignore: 3, make_up: 0.5 },
  ex: { ignore: 4, sulk: 2, argue: 2, chat: 1, make_up: 0.5 },
  family: { parent_play: 4, hug: 3, chat: 3, play: 2, argue: 1 },
};

/** Every kind a status can ever produce — what tests hold pickInteraction to. */
export const allowedFor = (status: RelationStatus) => Object.keys(BY_STATUS[status]) as InteractionKind[];

const ROMANTIC: readonly InteractionKind[] = ["flirt", "kiss"];

export interface MeetingContext {
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
}

export function pickInteraction(ctx: MeetingContext, rng: Rng): InteractionKind {
  const w: Weights = { ...BY_STATUS[ctx.rel.status] };
  if (!ctx.canRomance) for (const kind of ROMANTIC) delete w[kind];
  if (!ctx.parentAndChild) delete w.parent_play;
  // Personality and mood tilt the table, never add to it.
  const mood = (ctx.moodA + ctx.moodB) / 2;
  const chem = ctx.rel.chemistry;
  const scale = (kind: InteractionKind, by: number) => {
    if (w[kind] !== undefined) w[kind] = w[kind]! * by;
  };
  scale("play", 0.5 + ctx.playfulness);
  scale("dance", 0.5 + ctx.playfulness);
  // A spark feeds itself: the more romance there is, the more flirting.
  scale("flirt", (0.3 + 1.4 * ctx.romance) * Math.max(0.1, 1 + 1.5 * chem) * (1 + ctx.rel.romance / 25));
  // …and so does a grudge: every fight makes the next one likelier.
  scale("argue", (0.5 + ctx.temper) * (1 - 0.6 * mood) * (1 - 0.5 * chem) * (1 + ctx.rel.tension / 20));
  scale("ignore", 1 + ctx.rel.tension / 30);
  scale("sulk", 1 - 0.6 * mood);
  scale("hug", 1 + 0.5 * mood);
  scale("make_up", 1 + 0.5 * mood);
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
  flirt: [[1, 7, 0], [0, 3, 0], [0, -3, 3]],
  kiss: [[1, 6, -2], [0, 2, 0], [0, -3, 3]],
  argue: [[0, 0, -3], [-2, -1, 5], [-5, -3, 8]],
  make_up: [[4, 2, -8], [1, 0, -3], [-1, 0, 3]],
  sulk: [[0, 0, -1], [-1, 0, 2], [-2, -1, 3]],
  ignore: [[0, 0, -1], [-1, 0, 0], [-1, 0, 2]],
  parent_play: [[4, 0, -2], [2, 0, 0], [0, 0, 2]],
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
    friendship: cap(f * jitter() * (f > 0 ? 1 + 0.5 * chem : 1 - 0.5 * chem)),
    // Without mutual attraction romance can only fade, and without chemistry it barely grows.
    romance: cap(ctx.canRomance ? r * jitter() * (0.5 + ctx.romance) * (r > 0 ? 1 + chem : 1) : Math.min(0, r)),
    tension: cap(t * jitter() * (0.6 + 0.8 * ctx.temper) * (t > 0 ? 1 - chem : 1 + 0.5 * chem)),
  };
}

/** How a meeting leaves each of them feeling: a nudge to mood, which lives in [-1, 1]. */
export function moodShift(kind: InteractionKind, outcome: Outcome): number {
  if (outcome === "bad") return -0.25;
  if (kind === "argue" || kind === "sulk" || kind === "ignore") return outcome === "good" ? 0 : -0.15;
  return outcome === "good" ? 0.2 : 0.05;
}

/** The blobatar expression both wear while it happens. */
export function interactionExpression(kind: InteractionKind, outcome: Outcome): string {
  if (outcome === "bad") return kind === "argue" ? "mad" : kind === "flirt" || kind === "kiss" ? "sad" : "unsure";
  switch (kind) {
    case "hug":
    case "kiss":
      return "love";
    case "flirt":
      return "shy";
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

const TEXT: Record<InteractionKind, Record<Outcome, string>> = {
  chat: { good: "Had a lovely chat with {other}.", meh: "Chatted with {other}.", bad: "Had an awkward chat with {other}." },
  play: { good: "Played with {other}.", meh: "Played a bit with {other}.", bad: "Played with {other}, and it went wrong." },
  dance: { good: "Danced with {other}.", meh: "Shuffled around with {other}.", bad: "Stepped on {other}'s toes while dancing." },
  hug: { good: "Hugged {other}.", meh: "Gave {other} a quick hug.", bad: "Tried to hug {other}, who pulled away." },
  gift: { good: "Gave {other} a gift, and they loved it.", meh: "Gave {other} a little gift.", bad: "Gave {other} a gift they didn't like." },
  flirt: { good: "Flirted with {other}.", meh: "Blushed near {other}.", bad: "Flirted with {other}, who wasn't having it." },
  kiss: { good: "Kissed {other}.", meh: "Pecked {other} on the cheek.", bad: "Went for a kiss; {other} turned away." },
  argue: { good: "Argued with {other}, then cleared the air.", meh: "Argued with {other}.", bad: "Had a big fight with {other}." },
  make_up: { good: "Made up with {other}.", meh: "Almost made up with {other}.", bad: "Tried to make up with {other}. No luck." },
  sulk: { good: "Sulked near {other}, then let it go.", meh: "Sulked at {other}.", bad: "Sulked at {other} for ages." },
  ignore: { good: "Nodded at {other} and moved on.", meh: "Ignored {other}.", bad: "Pointedly ignored {other}." },
  parent_play: { good: "Played with {other}, all giggles.", meh: "Played with {other}.", bad: "Played with {other}, who got cranky." },
};

export const interactionText = (kind: InteractionKind, outcome: Outcome, other: string) => TEXT[kind][outcome].replace("{other}", other);
