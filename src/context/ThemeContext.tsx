import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Theme = 'light' | 'dark' | 'system';
const Ctx = createContext<{ theme: Theme; resolved: 'light' | 'dark'; setTheme: (t: Theme) => void } | null>(null);

/** Light, dark or system. The design system's tokens switch on `[data-theme]` of <html>. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    try { return (localStorage.getItem('theme') as Theme) || 'system'; } catch { return 'system'; }
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

export function useTheme() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useTheme must be used within ThemeProvider');
  return c;
}
