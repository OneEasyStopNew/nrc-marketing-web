import type { ReactElement, ReactNode } from 'react';
import { Text } from '@astryxdesign/core/Text';

/**
 * Text for a ListItem label or description that wraps instead of being cut
 * to one line (a plain string there is truncated). `secondary` matches the
 * look of a description.
 */
export function Wrap({ children, secondary }: { children: ReactNode; secondary?: boolean }): ReactElement {
  return secondary
    ? <Text type="supporting" color="secondary" wordBreak="break-word">{children}</Text>
    : <Text type="body" wordBreak="break-word">{children}</Text>;
}
