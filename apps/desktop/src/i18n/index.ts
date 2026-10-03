import { character, type InteractionKind, type Outcome, type Personality, type Segment } from "@blob-land/sim";
import { useSyncExternalStore } from "react";
import { de } from "./de";
import { en, type Messages } from "./en";
import { es } from "./es";
import { fr } from "./fr";

/**
 * Every language the app speaks, by its code, named in itself. A new one is
 * its file, typed as `Messages` (so it can't miss a line), and a line here.
 */
export const LANGUAGES = {
  en: { name: "English", messages: en },
  fr: { name: "Français", messages: fr },
  es: { name: "Español", messages: es },
  de: { name: "Deutsch", messages: de },
} satisfies Record<string, { name: string; messages: Messages }>;
export type Language = keyof typeof LANGUAGES;

export const isLanguage = (v: unknown): v is Language => typeof v === "string" && Object.prototype.hasOwnProperty.call(LANGUAGES, v);

/** The first of the system's languages the app speaks, else English. */
export function systemLanguage(): Language {
  for (const tag of globalThis.navigator?.languages ?? []) {
    const code = tag.split("-")[0]!.toLowerCase();
    if (isLanguage(code)) return code;
  }
  return "en";
}

let current: Language = systemLanguage();
// Screen readers and the webview's own words (spellcheck, hyphens) follow it. No page in tests.
const markPage = () => globalThis.document?.documentElement.setAttribute("lang", current);
markPage();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The language on screen: also the locale dates, times and lists are written in. */
export const language = () => current;

export function setLanguage(next: Language) {
  if (next === current) return;
  current = next;
  markPage();
  for (const listener of listeners) listener();
}

/** The words, in the language on screen: for code outside components (errors, notifications). */
export const t = (): Messages => LANGUAGES[current].messages;

/** The words, in the language on screen; the component redraws when it changes. */
export function useT(): Messages {
  useSyncExternalStore(subscribe, language);
  return t();
}

/** "A", "A and B", "A, B and C", in the language on screen. */
export const listNames = (names: readonly string[]) => new Intl.ListFormat(current, { type: "conjunction" }).format(names);

const regions = new Map<Language, Intl.DisplayNames>();
/** A country's name, from its ISO code. */
export function countryName(code: string): string {
  let names = regions.get(current);
  if (!names) regions.set(current, (names = new Intl.DisplayNames([current], { type: "region" })));
  return names.of(code) ?? code;
}

/** One line of a blob's journal (see activityLog): what it did in `seg`. `nameOf` turns a seed met into a name. */
export function journalLine(seg: Segment, nameOf: (seed: string) => string = (s) => s): string {
  const { journal, discoveries } = t();
  switch (seg.activity) {
    case "sleep":
    case "wake":
    case "rest":
    case "explore":
      return journal[seg.activity];
    case "discover":
      return journal.found(seg.detail ? (discoveries[seg.detail as keyof typeof discoveries] ?? seg.detail) : journal.something);
    case "meet": {
      const [kind, outcome] = (seg.detail ?? "chat:meh").split(":") as [InteractionKind, Outcome];
      return journal.meet[kind][outcome](seg.with?.length ? listNames(seg.with.map(nameOf)) : journal.someone);
    }
  }
}

/** What a personality reads as, in words: "Heart of gold & joker". */
export function characterName(p: Personality): string {
  const { personality } = t();
  const { main, second } = character(p);
  if (!main) return personality.balanced;
  return second ? personality.both(personality.poles[main], personality.poles[second]) : personality.poles[main];
}
