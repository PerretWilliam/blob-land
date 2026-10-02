import { segmentAt, type InteractionKind, type Outcome, type Segment } from "@blob-land/sim";
import type { CSSProperties, ReactNode } from "react";
import { greets } from "@/lib/blob-motion";

/** What a blob is doing with others right now, as the scene animates it. */
export interface Moment {
  kind: InteractionKind;
  outcome: Outcome;
  /** Its place among everyone there, so they take turns talking. */
  turn: number;
  count: number;
  /** Which side of the screen the others are on: 1 = right, -1 = left. */
  face: 1 | -1;
  /** Changes with every new meeting: the scene restarts the effects' clock on it. */
  key: string;
  /** About to end: time to say goodbye. */
  leaving: boolean;
}

// How long before a meeting ends its blobs say goodbye, in its own (garden) time.
const LEAVING_MS = 15_000;

/**
 * Reads the meeting a blob is in at `t` off its timeline. `others` gives the
 * segments of blobs on screen, to know which way to turn; someone off screen
 * (another page of the garden) just leaves it facing right.
 */
export function momentAt(seed: string, segments: readonly Segment[], t: number, others: (seed: string) => readonly Segment[] | undefined): Moment | null {
  const seg = segmentAt(segments, t)?.seg;
  if (!seg || seg.activity !== "meet" || !seg.detail || t >= seg.end) return null;
  const [kind, outcome] = seg.detail.split(":") as [InteractionKind, Outcome];
  const everyone = [seed, ...(seg.with ?? [])].sort();
  const spots = (seg.with ?? []).flatMap((s) => {
    const theirs = others(s) && segmentAt(others(s)!, t)?.seg;
    return theirs ? [theirs.x - theirs.y] : [];
  });
  // On screen, ground x runs right and ground y runs left.
  const dx = spots.length ? spots.reduce((a, b) => a + b, 0) / spots.length - (seg.x - seg.y) : 1;
  return { kind, outcome, turn: everyone.indexOf(seed), count: everyone.length, face: dx < 0 ? -1 : 1, key: `${seg.start}`, leaving: seg.end - t < LEAVING_MS };
}

const HEART = "M0 3 C -6 -2 -6 -8 -2.5 -8 C -1 -8 0 -7 0 -6 C 0 -7 1 -8 2.5 -8 C 6 -8 6 -2 0 3 Z";
const STAR = "M0 -5 L1.3 -1.3 L5 0 L1.3 1.3 L0 5 L-1.3 1.3 L-5 0 L-1.3 -1.3 Z";
const INK = "#1b1b2b";

const Heart = ({ x, y, s = 1, fill = "#ff4f8b", delay = 0, cls = "fx-rise" }: { x: number; y: number; s?: number; fill?: string; delay?: number; cls?: string }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <path d={HEART} fill={fill} stroke={INK} strokeWidth={1.2 / s} className={cls} style={{ animationDelay: `${delay}s` }} />
  </g>
);

const BrokenHeart = () => (
  <g transform="translate(20 22) scale(1.6)" stroke={INK} strokeWidth="0.8" strokeLinejoin="round" fill="#b83b5e">
    <path d="M-0.6 3 C -6 -2 -6 -8 -2.5 -8 C -1.2 -8 -0.6 -7 -0.6 -6 L -1.6 -3 L 0.2 -1 L -1 1 Z" className="fx-split-l" />
    <path d="M0.6 3 C 6 -2 6 -8 2.5 -8 C 1.2 -8 0.6 -7 0.6 -6 L -0.4 -3 L 1.4 -1 L 0.2 1 Z" className="fx-split-r" />
  </g>
);

const Bubble = ({ children, stroke = INK, fill = "#fff", cls = "fx-turn" }: { children: ReactNode; stroke?: string; fill?: string; cls?: string }) => (
  <g className={cls}>
    <path
      d="M6 4 H34 a4 4 0 0 1 4 4 V21 a4 4 0 0 1 -4 4 H16 l-8 7 l1.5 -7 H6 a4 4 0 0 1 -4 -4 V8 a4 4 0 0 1 4 -4 Z"
      fill={fill}
      stroke={stroke}
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
    {children}
  </g>
);

const Dots = () => (
  <g fill={INK}>
    {[12, 20, 28].map((x, i) => (
      <circle key={x} cx={x} cy="14.5" r="2.2" className="fx-dot" style={{ animationDelay: `${i * 0.15}s` }} />
    ))}
  </g>
);

// Swearing, the comic way: a spiral, a star and a bolt.
const Grawlix = () => (
  <g fill="none" stroke="#d62828" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 15 m0 -3.5 a3.5 3.5 0 1 1 -3.5 3.5 a2 2 0 1 1 2 2" />
    <path d={STAR} transform="translate(20 14.5) scale(0.9)" fill="#d62828" stroke="none" />
    <path d="M29 9 l-3 6 h4 l-3 6" />
  </g>
);

// The three beats' bookends: a "!" on arrival, a wave of arcs on leaving.
const Hello = () => (
  <Bubble cls="fx-hello">
    <path d="M20 8.5 V15.5" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
    <circle cx="20" cy="20" r="1.5" fill={INK} />
  </Bubble>
);

const Bye = () => (
  <Bubble cls="fx-bye">
    <path d="M14 10 q3 4.5 0 9 M19.5 8.5 q4 6 0 12 M25 7 q5 7.5 0 15" fill="none" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
  </Bubble>
);

// The cross-shaped vein that pops on an angry head.
const Vein = () => (
  <g transform="translate(34 4)">
    <path
      d="M-4.5 -1.2 Q -1.2 -1.2 -1.2 -4.5 M1.2 -4.5 Q 1.2 -1.2 4.5 -1.2 M4.5 1.2 Q 1.2 1.2 1.2 4.5 M-1.2 4.5 Q -1.2 1.2 -4.5 1.2"
      fill="none"
      stroke="#e11d48"
      strokeWidth="2"
      strokeLinecap="round"
      className="fx-throb"
    />
  </g>
);

const Note = ({ x, delay, double }: { x: number; delay: number; double?: boolean }) => (
  <g transform={`translate(${x} 30)`}>
    <g className="fx-float" style={{ animationDelay: `${delay}s` }} fill={INK} stroke={INK} strokeWidth="1.4" strokeLinecap="round">
      <ellipse cx="0" cy="0" rx="2.6" ry="1.9" transform="rotate(-20)" />
      <path d="M2.3 -0.6 V-10" fill="none" />
      {double ? (
        <>
          <ellipse cx="7" cy="-1.5" rx="2.6" ry="1.9" transform="rotate(-20 7 -1.5)" />
          <path d="M9.3 -2 V-11.5 L2.3 -10" fill="none" />
        </>
      ) : (
        <path d="M2.3 -10 Q 6 -8 5 -4" fill="none" />
      )}
    </g>
  </g>
);

const Sparkle = ({ x, y, delay, fill = "#ffd23f" }: { x: number; y: number; delay: number; fill?: string }) => (
  <g transform={`translate(${x} ${y})`}>
    <path d={STAR} fill={fill} stroke={INK} strokeWidth="0.8" className="fx-twinkle" style={{ animationDelay: `${delay}s` }} />
  </g>
);

const Ball = () => (
  <g className="fx-ball">
    <circle cx="20" cy="30" r="5" fill="#ff6b3d" stroke={INK} strokeWidth="1.4" />
    <path d="M15.5 28.5 Q 20 31.5 24.5 28.5" fill="none" stroke="#fff" strokeWidth="1.3" />
  </g>
);

const Gift = () => (
  <g className="fx-bob" stroke={INK} strokeWidth="1.4" strokeLinejoin="round">
    <rect x="12" y="18" width="16" height="13" rx="1.5" fill="#6c8cff" />
    <rect x="11" y="14" width="18" height="5" rx="1.2" fill="#8aa4ff" />
    <path d="M20 14 V31" stroke="#ffd23f" strokeWidth="3" />
    <path d="M20 14 C 15 8 11 12 16 14 Z M20 14 C 25 8 29 12 24 14 Z" fill="#ffd23f" />
  </g>
);

const RainCloud = () => (
  <g>
    <g stroke="#5b8def" strokeWidth="1.4" strokeLinecap="round">
      {[13, 20, 27].map((x, i) => (
        <path key={x} d={`M${x} 20 l-1 4`} className="fx-rain" style={{ animationDelay: `${i * 0.25}s` }} />
      ))}
    </g>
    <path d="M10 18 a5 5 0 0 1 3 -9 a7 7 0 0 1 13 -1 a5 5 0 0 1 4 10 Z" fill="#8b93a7" stroke={INK} strokeWidth="1.4" strokeLinejoin="round" />
  </g>
);

const Huff = () => (
  <g fill="none" stroke="#8b93a7" strokeWidth="1.6" strokeLinecap="round" className="fx-puff">
    <path d="M8 22 q4 -4 8 0 q4 4 8 0" />
    <path d="M12 15 q3 -3 6 0 q3 3 6 0" />
  </g>
);

const SweatDrop = () => <path d="M33 6 q-3 5 0 7 q3 -2 0 -7 Z" fill="#9fd3ff" stroke={INK} strokeWidth="1" className="fx-drip" />;

// Heart halves that come together when making up works out, and drift apart when it doesn't.
const Mending = ({ works }: { works: boolean }) => (
  <g transform="translate(20 22) scale(1.6)" stroke={INK} strokeWidth="0.8" strokeLinejoin="round" fill="#ff4f8b">
    <path d="M-0.4 3 C -6 -2 -6 -8 -2.5 -8 C -1.2 -8 -0.4 -7 -0.4 -6 Z" className={works ? "fx-mend-l" : "fx-split-l"} />
    <path d="M0.4 3 C 6 -2 6 -8 2.5 -8 C 1.2 -8 0.4 -7 0.4 -6 Z" className={works ? "fx-mend-r" : "fx-split-r"} />
  </g>
);

// A dozing blob's z's, drifting up one after the other.
const Snore = () => (
  <g fill="none" stroke={INK} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {[
      [12, 28, 1],
      [20, 22, 1.3],
      [29, 15, 1.6],
    ].map(([x, y, s], i) => (
      <g key={x} transform={`translate(${x} ${y}) scale(${s})`}>
        <path d="M-2 -2 H2 L-2 2 H2" className="fx-float" style={{ animationDelay: `${i * 0.6}s` }} strokeWidth={1.5 / s!} />
      </g>
    ))}
  </g>
);

// Speed lines behind a blob on the run.
const Dash = () => (
  <g fill="none" stroke={INK} strokeWidth="1.6" strokeLinecap="round" className="fx-puff">
    <path d="M4 18 h9 M2 24 h12 M6 30 h7" />
  </g>
);

const Moon = () => (
  <g className="fx-bob">
    <path d="M24 6 a9 9 0 1 0 9 12 a7 7 0 1 1 -9 -12 Z" fill="#ffe68a" stroke={INK} strokeWidth="1.4" strokeLinejoin="round" />
  </g>
);

// An open book, for a story told.
const Book = () => (
  <g stroke={INK} strokeWidth="1.3" strokeLinejoin="round">
    <path d="M20 10 Q14 7 9 9 V21 Q14 19 20 22 Z" fill="#fff6d6" />
    <path d="M20 10 Q26 7 31 9 V21 Q26 19 20 22 Z" fill="#fff6d6" />
    <path d="M12 12.5 h5 M12 15.5 h5 M23 12.5 h5 M23 15.5 h5" strokeWidth="0.9" />
  </g>
);

// A clap of hands that aren't there: a burst where they meet.
const Clap = () => (
  <g transform="translate(20 18)" className="fx-pulse">
    <path d={STAR} transform="scale(2.2)" fill="#ffd23f" stroke={INK} strokeWidth="0.6" />
    <path d="M-10 -8 l-3 -3 M10 -8 l3 -3 M0 -12 v-4 M-12 2 h-4 M12 2 h4" stroke={INK} strokeWidth="1.5" strokeLinecap="round" />
  </g>
);

// Confetti, for a find worth cheering.
const Confetti = () => (
  <g stroke={INK} strokeWidth="0.8">
    {[
      [8, "#ff5fa2", 0],
      [16, "#ffd23f", 0.3],
      [24, "#7ee0ff", 0.6],
      [32, "#8be28b", 0.9],
    ].map(([x, fill, delay]) => (
      <rect key={x as number} x={x as number} y="8" width="3" height="5" rx="0.8" fill={fill as string} className="fx-fall" style={{ animationDelay: `${delay}s` }} />
    ))}
  </g>
);

const SHARED = new Set<InteractionKind>(["play", "parent_play", "gift", "kiss", "make_up", "confess", "comfort", "share_find", "high_five", "stargaze", "piggyback", "group_hug"]);
const ROMANTIC = new Set<InteractionKind>(["hug", "kiss", "flirt", "confess"]);

function art(kind: InteractionKind, outcome: Outcome): ReactNode {
  const bad = outcome === "bad";
  switch (kind) {
    case "chat":
      return (
        <>
          <Bubble>{bad ? <path d="M9 15 q3 -4 6 0 t6 0 t6 0 t6 0" fill="none" stroke={INK} strokeWidth="1.6" strokeLinecap="round" /> : <Dots />}</Bubble>
          {bad ? <SweatDrop /> : null}
        </>
      );
    case "argue":
      return (
        <>
          <Bubble stroke="#d62828" fill="#fff1f1">
            <Grawlix />
          </Bubble>
          {outcome === "good" ? null : <Vein />}
        </>
      );
    case "flirt":
    case "hug":
    case "kiss": {
      if (bad) return <BrokenHeart />;
      if (kind === "kiss") return <Heart x={20} y={24} s={2.2} cls="fx-pulse" />;
      const [fill, s] = kind === "flirt" ? ["#ff8fc0", 0.75] : ["#ff4f8b", 1.1];
      return (
        <>
          <Heart x={12} y={30} s={s} fill={fill} />
          <Heart x={24} y={32} s={s * 0.85} delay={0.7} fill={fill} />
          <Heart x={32} y={28} s={s * 0.7} delay={1.4} fill={fill} />
        </>
      );
    }
    case "gift":
      return (
        <>
          <Gift />
          {outcome === "good" ? <Heart x={31} y={10} s={0.8} delay={0.4} /> : bad ? <SweatDrop /> : null}
        </>
      );
    case "dance":
      return (
        <>
          <Note x={10} delay={0} />
          <Note x={22} delay={0.6} double />
          <Note x={32} delay={1.2} />
          {bad ? <SweatDrop /> : null}
        </>
      );
    case "play":
    case "parent_play":
      return (
        <>
          <Ball />
          {bad ? (
            <SweatDrop />
          ) : (
            <>
              <Sparkle x={8} y={10} delay={0} />
              <Sparkle x={32} y={8} delay={0.5} fill="#7ee0ff" />
            </>
          )}
        </>
      );
    case "make_up":
      return <Mending works={!bad} />;
    case "confess":
      if (bad) return <BrokenHeart />;
      return outcome === "good" ? (
        <>
          <Heart x={20} y={24} s={1.9} cls="fx-pulse" />
          <Sparkle x={7} y={9} delay={0} />
          <Sparkle x={33} y={7} delay={0.6} fill="#ff8fc0" />
        </>
      ) : (
        <Bubble>
          <Heart x={20} y={17} s={0.75} fill="#ff8fc0" cls="fx-pulse" />
        </Bubble>
      );
    case "comfort":
      return bad ? (
        <SweatDrop />
      ) : (
        <>
          <Heart x={16} y={30} s={0.8} fill="#ffb3cf" />
          <Heart x={26} y={30} s={0.65} delay={1} fill="#ffb3cf" />
          {outcome === "good" ? <Sparkle x={32} y={10} delay={0.5} fill="#7ee0ff" /> : null}
        </>
      );
    case "tease":
      return (
        <>
          <Bubble stroke={bad ? "#d62828" : INK}>
            {/* A grin with its tongue out. */}
            <path d="M12 12 q8 7 16 0" fill="none" stroke={INK} strokeWidth="1.8" strokeLinecap="round" />
            <path d="M18 15.5 q2 4 4 0" fill="#ff6b8b" stroke={INK} strokeWidth="1.2" />
          </Bubble>
          {bad ? <Vein /> : null}
        </>
      );
    case "share_find":
      return (
        <>
          <Sparkle x={20} y={20} delay={0} />
          <Sparkle x={10} y={12} delay={0.4} fill="#7ee0ff" />
          <Sparkle x={30} y={10} delay={0.8} fill="#ff8fc0" />
          {bad ? <SweatDrop /> : null}
        </>
      );
    case "nap_together":
      return bad ? <SweatDrop /> : <Snore />;
    case "high_five":
      return bad ? <SweatDrop /> : <Clap />;
    case "chase":
    case "tag":
      return (
        <>
          <Dash />
          {bad ? <SweatDrop /> : kind === "tag" ? <Sparkle x={30} y={10} delay={0.3} fill="#7ee0ff" /> : null}
        </>
      );
    case "whisper":
      return (
        <>
          <Bubble fill="#f1ebff" stroke={bad ? "#d62828" : INK}>
            <g fill={INK}>
              {[16, 20, 24].map((x, i) => (
                <circle key={x} cx={x} cy="14.5" r="1.3" className="fx-dot" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </g>
          </Bubble>
          {outcome === "good" ? <Heart x={33} y={6} s={0.55} fill="#ff8fc0" /> : bad ? <SweatDrop /> : null}
        </>
      );
    case "stargaze":
      return (
        <>
          <Moon />
          <Sparkle x={8} y={6} delay={0} fill="#fff4b0" />
          <Sparkle x={36} y={24} delay={0.5} fill="#fff4b0" />
          {outcome === "good" ? <Sparkle x={14} y={22} delay={1} fill="#fff4b0" /> : null}
        </>
      );
    case "piggyback":
      return bad ? (
        <SweatDrop />
      ) : (
        <>
          <Sparkle x={10} y={12} delay={0} />
          <Heart x={28} y={16} s={0.7} delay={0.3} fill="#ffb3cf" />
        </>
      );
    case "ring_dance":
      return (
        <>
          <Note x={14} delay={0} double />
          <Note x={28} delay={0.9} />
          {bad ? <SweatDrop /> : <Sparkle x={34} y={8} delay={0.4} fill="#ff8fc0" />}
        </>
      );
    case "story":
      return (
        <>
          <Bubble>
            <Book />
          </Bubble>
          {bad ? <SweatDrop /> : null}
        </>
      );
    case "sing":
      return (
        <>
          <Note x={10} delay={0} double />
          <Note x={22} delay={0.45} />
          <Note x={32} delay={0.9} double />
          {bad ? <Vein /> : null}
        </>
      );
    case "group_hug":
      return bad ? (
        <SweatDrop />
      ) : (
        <>
          <Heart x={20} y={22} s={1.8} cls="fx-pulse" />
          <Heart x={8} y={30} s={0.6} delay={0.4} fill="#ff8fc0" />
          <Heart x={32} y={30} s={0.6} delay={1.1} fill="#ff8fc0" />
        </>
      );
    case "cheer":
      return bad ? <SweatDrop /> : <Confetti />;
    case "sulk":
      return <RainCloud />;
    case "ignore":
      return <Huff />;
  }
}

/**
 * The little show beside a blob during a meeting — a speech bubble, hearts,
 * music notes, a rain cloud… — drawn toward whoever it's with. It only plays
 * once the blob has arrived (the scene flags that on the anchor with
 * `data-still`), and speakers take turns (`--turn` of `--count`).
 */
/** `size`: the blob's. */
export function InteractionFx({ moment, size }: { moment: Moment; size: number }) {
  // One ball, one gift, one heart between them: shown by the first of them only.
  const shared = SHARED.has(moment.kind) || (moment.outcome === "bad" && ROMANTIC.has(moment.kind));
  if (shared && moment.turn !== 0) return null;
  const style = {
    "--turn": moment.turn,
    "--count": moment.count,
    width: size * 0.6,
    // Beside its head, on the side of the others, like a comic's speech bubble.
    bottom: size * 0.45,
    left: moment.face * size * 0.6,
  } as CSSProperties;
  const polite = greets(moment.kind);
  return (
    <div aria-hidden="true" data-fx={moment.kind} className="fx pointer-events-none absolute -translate-x-1/2" style={style}>
      <svg viewBox="0 0 40 36" className="block w-full overflow-visible">
        {/* Everything is drawn for a blob facing right; mirrored for the left. */}
        <g transform={moment.face === 1 ? undefined : "translate(40 0) scale(-1 1)"}>
          {polite && moment.leaving ? (
            <Bye />
          ) : (
            <>
              {/* Hello first, then the moment itself. */}
              {polite ? <Hello /> : null}
              <g className={polite ? "fx-act" : undefined}>{art(moment.kind, moment.outcome)}</g>
            </>
          )}
        </g>
      </svg>
    </div>
  );
}

export type Aura = "newborn" | "heartbroken";

/** A while after something big: a newborn sparkles, a blob just dumped carries a broken heart. */
export function AuraFx({ aura, size }: { aura: Aura; size: number }) {
  return (
    // Around its head.
    <div aria-hidden="true" data-aura={aura} className="pointer-events-none absolute -translate-x-1/2" style={{ width: size, bottom: size * 0.3 }}>
      <svg viewBox="0 0 40 36" className="block w-full overflow-visible">
        {aura === "newborn" ? (
          <>
            <Sparkle x={8} y={22} delay={0} />
            <Sparkle x={20} y={10} delay={0.4} fill="#ffb3d1" />
            <Sparkle x={32} y={22} delay={0.8} fill="#7ee0ff" />
            <Heart x={20} y={30} s={0.8} delay={0.2} />
          </>
        ) : (
          <>
            <BrokenHeart />
            <SweatDrop />
          </>
        )}
      </svg>
    </div>
  );
}
