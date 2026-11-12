import { forwardRef, type AnchorHTMLAttributes, type ReactNode, type ReactElement } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Theme } from '@astryxdesign/core/theme';
import { LinkProvider } from '@astryxdesign/core/Link';
import { useTheme } from '@/context/ThemeContext';
import { nrcTheme } from './nrcTheme';
import { isAppPath, safeExternalHref } from '@/lib/safeUrl';

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href?: string; to?: string };

/**
 * Every Astryx Link and Button-with-href renders through this. In-app paths go
 * through React Router (no full page reload); in-page anchors stay anchors;
 * anything else must be an http(s), mailto or tel URL. Some destinations come
 * from the server (study contact URL, publication permalink, activity link),
 * so an unsafe one (`javascript:`, `data:`, `//host`) is shown as plain text,
 * never as a link (JS-33). New tabs never get access to this window.
 */
const AppLink = forwardRef<HTMLAnchorElement, LinkProps>(({ href, to, target, rel, children, ...rest }, ref) => {
  const dest = to ?? href ?? '';
  const safeRel = target === '_blank' ? 'noopener noreferrer' : rel;
  if (isAppPath(dest)) return <RouterLink ref={ref} to={dest} target={target} rel={safeRel} {...rest}>{children}</RouterLink>;
  if (dest.startsWith('#')) return <a ref={ref} href={dest} target={target} rel={safeRel} {...rest}>{children}</a>;
  const safe = safeExternalHref(dest);
  if (!safe) return <span className={rest.className} style={rest.style} id={rest.id}>{children}</span>;
  return <a ref={ref} href={safe} target={target} rel={safeRel} {...rest}>{children}</a>;
});
AppLink.displayName = 'AppLink';

/** NRC Connect theme for every Astryx component, following the app's light/dark choice. */
export function AstryxProvider({ children }: { children: ReactNode }): ReactElement {
  const { resolved } = useTheme();
  return (
    <Theme theme={nrcTheme} mode={resolved}>
      <LinkProvider component={AppLink}>{children}</LinkProvider>
    </Theme>
  );
}
