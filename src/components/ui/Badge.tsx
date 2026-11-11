import type { ComponentProps, HTMLAttributes, ReactNode } from 'react';
import { Badge as AxBadge } from '@astryxdesign/core/Badge';
import { Icon, type IconName } from './Icon';

/**
 * Badge: Astryx Badge with the NRC Connect status names.
 * - done: finished (validated, published, connected)
 * - waiting: waiting on someone (review, approval)
 * - blocked: failed, rejected, expired
 * - brand: in motion (checking, scheduled)
 * - neutral: not started, draft, archived
 * - regulatory: compliance facts (needs a decision)
 * Always a word, never colour alone.
 */
export type BadgeVariant = 'neutral' | 'brand' | 'done' | 'waiting' | 'blocked' | 'regulatory' | 'solid' | 'count';

export interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'color'> {
  variant?: BadgeVariant;
  icon?: IconName;
  /** Kept for compatibility; Astryx badges have no dot. */
  dot?: boolean;
  mono?: boolean;
  children?: ReactNode;
}

/** Tinted colour variants, like NRC Connect's wash badges (Astryx's semantic variants are solid). */
const AX: Record<BadgeVariant, NonNullable<ComponentProps<typeof AxBadge>['variant']>> = {
  neutral: 'neutral', brand: 'blue', done: 'green', waiting: 'yellow', blocked: 'red',
  regulatory: 'purple', solid: 'neutral', count: 'neutral',
};

export function Badge({ variant = 'neutral', icon, dot: _dot, mono: _mono, children, className: _className, ...props }: BadgeProps) {
  return (
    <AxBadge
      {...(props as object)}
      variant={AX[variant]}
      label={children}
      icon={icon ? <Icon name={icon} size={16} /> : undefined}
    />
  );
}
