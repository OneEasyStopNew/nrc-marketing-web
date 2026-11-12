import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Characters as people count them (Unicode code points): "ñ" and "😀" are one each. */
export const charCount = (s: string): number => [...s].length;

/**
 * Language of the app's words. The UI copy is English, so words built by Intl
 * (plurals, "3 hours ago") use it too; dates and numbers follow the viewer's
 * own locale. One place to change when the app is translated.
 */
export const UI_LOCALE = 'en';

// Formatters are created once and reused (JS-56).
const DATE_TIME = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const PLURAL = new Intl.PluralRules(UI_LOCALE);
const COUNT = new Intl.NumberFormat(undefined);

/** "9 Nov, 14:05" in the viewer's locale and time zone. */
export function fmtDateTime(iso: string): string {
  return DATE_TIME.format(new Date(iso));
}

/** "1 draft", "3 drafts": the plural form comes from Intl.PluralRules, never `n === 1 ? '' : 's'`. */
export function countOf(n: number, one: string, other: string): string {
  return `${COUNT.format(n)} ${PLURAL.select(n) === 'one' ? one : other}`;
}

export const initials = (name: string): string =>
  name.split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
