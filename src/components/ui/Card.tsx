import type { ReactNode, Ref } from 'react';
import { Card as AxCard } from '@astryxdesign/core/Card';
import { Divider } from '@astryxdesign/core/Divider';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Heading } from '@astryxdesign/core/Text';
import { Icon, type IconName } from './Icon';
import { InfoTip } from './InfoTip';

/**
 * Card, the way the Astryx templates compose it: an Astryx Card with one
 * padding, and inside it a heading row, the content, and (optionally) a
 * divider and an actions row. One thing per card; never a card in a card.
 */
export interface CardProps {
  children?: ReactNode;
  ref?: Ref<HTMLDivElement>;
  'aria-label'?: string;
  /** Kept so older call sites compile; styling comes from the library. */
  className?: string;
  selected?: boolean;
  padding?: 'body' | 'none';
}

export function Card({ children, ref, 'aria-label': ariaLabel }: CardProps) {
  return (
    <AxCard ref={ref} data-card="" aria-label={ariaLabel} padding={6}>
      <VStack gap={4}>{children}</VStack>
    </AxCard>
  );
}

export function CardHead({ title, icon, lead, regulatory, badge, children, info }: {
  title: ReactNode; icon?: IconName;
  /** Shown before the title in place of `icon`, e.g. a platform logo. */
  lead?: ReactNode; iconColor?: string; regulatory?: boolean; badge?: ReactNode; children?: ReactNode; className?: string;
  /** "What is this?" behind an info icon after the title. */
  info?: string;
}) {
  return (
    <HStack gap={3} vAlign="center">
      {lead ?? (icon && <Icon name={icon} size={20} color={regulatory ? 'purple' : 'secondary'} />)}
      <StackItem size="fill">
        <HStack gap={2} vAlign="center" wrap="wrap">
          <Heading level={3}>{title}</Heading>
          {info && <InfoTip text={info} label={typeof title === 'string' ? title : undefined} />}
          {badge}
        </HStack>
      </StackItem>
      {children}
    </HStack>
  );
}

export function CardBody({ children }: { children?: ReactNode; className?: string; style?: React.CSSProperties }) {
  return <VStack gap={4}>{children}</VStack>;
}

export function CardFoot({ children }: { children?: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <>
      <Divider />
      <HStack gap={2} vAlign="center" wrap="wrap">{children}</HStack>
    </>
  );
}
