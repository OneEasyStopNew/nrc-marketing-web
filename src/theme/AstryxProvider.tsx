import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Theme } from '@astryxdesign/core/theme';
import { LinkProvider } from '@astryxdesign/core/Link';
import { useTheme } from '@/context/ThemeContext';
import { nrcTheme } from './nrcTheme';

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href?: string; to?: string };

/**
 * Astryx links go through React Router for in-app paths (no full page reload);
 * external and mailto links stay plain anchors.
 */
const AppLink = forwardRef<HTMLAnchorElement, LinkProps>(({ href, to, ...rest }, ref) => {
  const dest = to ?? href ?? '';
  if (/^(https?:|mailto:|tel:|#)/.test(dest) || !dest.startsWith('/')) return <a ref={ref} href={dest} {...rest} />;
  return <RouterLink ref={ref} to={dest} {...rest} />;
});
AppLink.displayName = 'AppLink';

/** NRC Connect theme for every Astryx component, following the app's light/dark choice. */
export function AstryxProvider({ children }: { children: ReactNode }) {
  const { resolved } = useTheme();
  return (
    <Theme theme={nrcTheme} mode={resolved}>
      <LinkProvider component={AppLink}>{children}</LinkProvider>
    </Theme>
  );
}
