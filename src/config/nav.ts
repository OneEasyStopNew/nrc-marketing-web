import type { IconName } from '@/components/ui/Icon';
import type { Capability } from '@/api/session';

export interface NavItem {
  name: string;
  href: string;
  icon: IconName;
  /** Shown only when the server grants this capability in the current tenant. */
  capability: Capability;
  /** One line on what the section is for (rail tooltip, home page). */
  hint: string;
  /** Validation is the one regulatory item: violet icon. */
  regulatory?: boolean;
}

/**
 * Marketing sections (OR-102 "initial navigation"). Each page is built by its
 * own ticket; until then the route shows a not-built-yet state.
 */
export const NAV: NavItem[] = [
  { name: 'Create post', href: '/marketing/create', icon: 'edit', capability: 'creative:write', hint: 'Write a brief, check it and generate the image' },
  { name: 'Validation', href: '/marketing/validation', icon: 'shield', capability: 'creative:read', hint: 'Rule findings and the evidence behind them', regulatory: true },
  { name: 'Media', href: '/marketing/media', icon: 'img', capability: 'creative:read', hint: 'Images and files you may use' },
  { name: 'Rules', href: '/marketing/rules', icon: 'doc', capability: 'creative:read', hint: 'The active policy rules every post is checked against' },
  { name: 'Approvals', href: '/marketing/approvals', icon: 'check', capability: 'approval:decide', hint: 'Posts waiting for a reviewer decision' },
  { name: 'Publications', href: '/marketing/publications', icon: 'send', capability: 'publication:manage', hint: 'What was scheduled or published, and where' },
  { name: 'Connected accounts', href: '/marketing/integrations', icon: 'globe', capability: 'publication:manage', hint: 'Social accounts Marketing may post to' },
  { name: 'Team', href: '/marketing/team', icon: 'users', capability: 'membership:manage', hint: 'Who works in Marketing and their roles' },
];

export const HOME_ITEM = { name: 'Home', href: '/marketing', icon: 'home' as IconName };

export function titleFor(pathname: string): string {
  if (pathname === HOME_ITEM.href) return HOME_ITEM.name;
  return NAV.find((i) => pathname === i.href || pathname.startsWith(i.href + '/'))?.name ?? '';
}
