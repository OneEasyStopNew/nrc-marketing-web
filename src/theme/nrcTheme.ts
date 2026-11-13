import { defineTheme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral';

/**
 * The Astryx neutral theme as it ships (type, spacing, radius, surfaces,
 * status colours), with one change: the accent is the NRC Connect brand blue.
 */
export const nrcTheme = defineTheme({
  name: 'nrc-connect',
  extends: neutralTheme,
  tokens: {
    '--color-accent': ['#2f5bd8', '#86a4ff'],
    '--color-accent-muted': ['#e8eeff', '#1c2650'],
    '--color-on-accent': ['#ffffff', '#0b0b24'],
    '--color-text-accent': ['#2246b0', '#a9beff'],
    '--color-icon-accent': ['#2246b0', '#a9beff'],
  },
});
