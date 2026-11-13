import { useEffect, useRef, useState, type ReactNode, type ReactElement } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AppShell } from '@astryxdesign/core/AppShell';
import { SideNav, SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav';
import { TopNav, TopNavHeading } from '@astryxdesign/core/TopNav';
import { Layout, LayoutContent, LayoutFooter, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { Avatar as AxAvatar } from '@astryxdesign/core/Avatar';
import {
  DropdownMenu, DropdownMenuDivider, DropdownMenuGroup, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem,
} from '@astryxdesign/core/DropdownMenu';
import { SIMULATION_BUILD } from '@/config/env';
import { HOME_ITEM, NAV, titleFor } from '@/config/nav';
import { useAuth, useSession } from '@/auth/AuthProvider';
import { useTheme } from '@/context/ThemeContext';
import { iconComponent } from '@/components/ui/Icon';
import nrcLogo from '@/assets/nrc-logo.png';
import nrcLogoDark from '@/assets/nrc-logo-dark.png';
import { useToast } from '@/components/ui/Toast';
import type { MarketingContext } from '@/api/session';

export const ROLE_LABELS: Record<MarketingContext['roles'][number], string> = {
  creator: 'Creator', reviewer: 'Reviewer', policy_admin: 'Policy administrator', publisher: 'Publisher', admin: 'Administrator',
};

/**
 * Signed-in frame on Astryx AppShell: top bar (product, organisation switcher,
 * account menu), a side navigation listing only what the server granted, and
 * the page. Menu visibility is usability only; every route checks the
 * capability too, and the API checks every request.
 */
export function AppLayout({ children }: { children: ReactNode }): ReactElement {
  const { signOut, switchTenant, chooseTenant, can, simulation } = useAuth();
  const { me, context } = useSession();
  const { theme, resolved, setTheme } = useTheme();
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const lastPath = useRef(location.pathname);
  const items = NAV.filter((i) => can(i.capability));
  const [year] = useState(() => new Date().getFullYear());
  const roles = context.roles.map((r) => ROLE_LABELS[r]).join(', ') || 'No role';

  useEffect(() => { document.title = `${titleFor(location.pathname) || 'Marketing'} · NRC Marketing`; }, [location.pathname]);
  // After navigation, move focus to the page so keyboard and screen-reader users start at the content.
  useEffect(() => {
    if (lastPath.current === location.pathname) return;
    lastPath.current = location.pathname;
    document.querySelector<HTMLElement>('[role="main"]')?.focus();
  }, [location.pathname]);

  const isActive = (href: string) => (href === HOME_ITEM.href ? location.pathname === href : location.pathname === href || location.pathname.startsWith(href + '/'));

  const orgSwitcher = me.tenants.length > 1 ? (
    <DropdownMenu
      button={{ label: `Organisation: ${context.tenant.name}. Change organisation`, children: context.tenant.name, variant: 'ghost', size: 'sm' }}
      menuWidth={260}>
      <DropdownMenuRadioGroup label="Organisation" value={context.tenant.tenant_id}
        onChange={(id) => { if (id !== context.tenant.tenant_id) chooseTenant(id); }}>
        {me.tenants.map((t) => <DropdownMenuRadioItem key={t.tenant_id} value={t.tenant_id} label={t.name} />)}
      </DropdownMenuRadioGroup>
    </DropdownMenu>
  ) : (
    <Text type="supporting" color="secondary" maxLines={1}>{context.tenant.name}</Text>
  );

  const accountMenu = (
    <DropdownMenu
      menuWidth={280}
      alignment="end"
      hasChevron={false}
      button={{ label: 'Account menu', icon: <AxAvatar name={me.display_name} size="sm" tooltip={false} />, isIconOnly: true, variant: 'ghost' }}
      header={(
        <VStack padding={3} gap={0.5}>
          <Text type="body" weight="semibold" maxLines={1}>{me.display_name}</Text>
          <Text type="supporting" color="secondary" maxLines={1}>{roles} · {context.tenant.name}</Text>
        </VStack>
      )}>
      <DropdownMenuRadioGroup label="Theme" value={theme} onChange={(t) => setTheme(t as typeof theme)} hasCloseOnSelect={false}>
        <DropdownMenuRadioItem value="light" label="Light" />
        <DropdownMenuRadioItem value="dark" label="Dark" />
        <DropdownMenuRadioItem value="system" label="System" />
      </DropdownMenuRadioGroup>
      {me.tenants.length > 1 && (
        <>
          <DropdownMenuDivider />
          <DropdownMenuItem icon={iconComponent('globe')} label="Change organisation" onClick={() => switchTenant()} />
        </>
      )}
      {SIMULATION_BUILD && simulation && (
        <>
          <DropdownMenuDivider />
          <DropdownMenuGroup title="Simulation">
            <DropdownMenuItem icon={iconComponent('clock')} label="Expire access token"
              onClick={() => { simulation.expireAccessToken(); toast('Access token expired', 'waiting', 'The next request refreshes it once and retries.'); }} />
            <DropdownMenuItem icon={iconComponent('lock')} label="End session"
              onClick={() => { simulation.endSession(); toast('Session ended on the server', 'waiting', 'The next request fails to refresh and signs you out.'); }} />
          </DropdownMenuGroup>
        </>
      )}
      <DropdownMenuDivider />
      <DropdownMenuItem icon={iconComponent('logout')} label="Sign out" onClick={() => signOut()} />
    </DropdownMenu>
  );

  return (
    <>
      <AppShell
        // Section: Astryx dividers between the navigation and the page, on one background (no raised panel).
        variant="section"
        topNav={(
          <TopNav
            label="Top"
            heading={(
              <TopNavHeading
                heading="NRC Connect · Marketing"
                headingHref={HOME_ITEM.href}
                // National Research Centers logo, as supplied (not in a circle). The dark-theme copy has white lettering.
                // alt is empty: the heading next to it already names the link.
                logo={<img src={resolved === 'dark' ? nrcLogoDark : nrcLogo} alt="" height={36} width={80} />}
              />
            )}
            startContent={orgSwitcher}
            endContent={accountMenu}
          />
        )}
        sideNav={(
          <SideNav collapsible={{ hasButton: true, buttonLabel: 'Collapse sidebar' }} aria-label="Main">
            <SideNavSection title="Overview" isHeaderHidden>
              <SideNavItem label={HOME_ITEM.name} icon={iconComponent(HOME_ITEM.icon)} href={HOME_ITEM.href} isSelected={isActive(HOME_ITEM.href)} />
            </SideNavSection>
            {items.length > 0 && (
              <SideNavSection title="Marketing">
                {items.map((item) => (
                  <SideNavItem key={item.href} label={item.name} icon={iconComponent(item.icon)} href={item.href} isSelected={isActive(item.href)}
                    onClick={(e) => { if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); navigate(item.href); } }} />
                ))}
              </SideNavSection>
            )}
          </SideNav>
        )}>
        {/* Fill height: the page scrolls inside the content area and the footer stays at the bottom of the screen. */}
        <Layout
          content={(
            <LayoutContent padding={0}>
              {/* Padding sits on the stack, not on LayoutContent: Table bleeds past LayoutContent padding (as in the Astryx table template). */}
              <VStack key={location.pathname} gap={8} padding={6}>{children}</VStack>
            </LayoutContent>
          )}
          footer={(
            <LayoutFooter hasDivider padding={0}>
              {/* Same side padding as the page above, so the line starts where the content starts. */}
              <VStack paddingInline={6} paddingBlock={3}>
                <Text type="supporting" color="secondary">
                  © {year} National Research Centers · NRC Connect by Octavo Lab AI Technology Solutions
                </Text>
              </VStack>
            </LayoutFooter>
          )}
        />
      </AppShell>
    </>
  );
}


