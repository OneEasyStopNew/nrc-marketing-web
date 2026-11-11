import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Characters as people count them (Unicode code points): "ñ" and "😀" are one each. */
export const charCount = (s: string) => [...s].length;

/** "9 Nov, 14:05" in the viewer's locale and time zone. */
export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const initials = (name: string) =>
  name.split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
