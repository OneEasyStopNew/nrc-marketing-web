import { createContext, useContext, useEffect, useState, type ReactNode, type ReactElement } from 'react';

type Theme = 'light' | 'dark' | 'system';
const THEMES: readonly Theme[] = ['light', 'dark', 'system'];
const isTheme = (v: unknown): v is Theme => THEMES.includes(v as Theme);

export interface ThemeValue {
  theme: Theme;
  /** What is actually shown: the system preference resolved. */
  resolved: 'light' | 'dark';
  setTheme: (t: Theme) => void;
}
const Ctx = createContext<ThemeValue | null>(null);

/** Light, dark or system. The design system's tokens switch on `[data-theme]` of <html>. */
export function ThemeProvider({ children }: { children: ReactNode }): ReactElement {
  const [theme, setTheme] = useState<Theme>(() => {
    // A stored value is used only if it is one of the three themes (JS-59).
    try { const v = localStorage.getItem('theme'); return isTheme(v) ? v : 'system'; } catch { return 'system'; }
  });
  const [resolved, setResolved] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const d = theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme;
      setResolved(d);
      root.setAttribute('data-theme', d);
    };
    apply();
    try { localStorage.setItem('theme', theme); } catch { /* ignore */ }
    const h = () => theme === 'system' && apply();
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [theme]);

  return <Ctx.Provider value={{ theme, resolved, setTheme }}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeValue {
  const c = useContext(Ctx);
  if (!c) throw new Error('useTheme must be used within ThemeProvider');
  return c;
}
