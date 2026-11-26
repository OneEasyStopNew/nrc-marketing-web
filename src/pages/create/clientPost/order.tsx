import type { ReactElement } from 'react';
import { HStack } from '@astryxdesign/core/Layout';
import { Button } from '@/components/ui/Button';

/** The list with one item moved from `from` to `to`; unchanged when either is out of range. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** "Move up" and "Move down" for one item in a carousel; the name keeps the labels distinct. */
export function MoveButtons({ index, count, name, disabled, onMove }: {
  index: number;
  count: number;
  name: string;
  disabled?: boolean;
  onMove: (from: number, to: number) => void;
}): ReactElement {
  return (
    <HStack gap={1}>
      <Button variant="ghost" size="sm" icon="chev-up" iconOnly aria-label={`Move ${name} up`}
        disabled={!!disabled || index === 0} onClick={() => onMove(index, index - 1)} />
      <Button variant="ghost" size="sm" icon="chev" iconOnly aria-label={`Move ${name} down`}
        disabled={!!disabled || index === count - 1} onClick={() => onMove(index, index + 1)} />
    </HStack>
  );
}
