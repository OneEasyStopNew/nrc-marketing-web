import type { ReactElement } from 'react';
import { InfoTip as AxInfoTip } from '@astryxdesign/core/InfoTip';

/** An info icon that explains the thing next to it (Astryx InfoTip). */
export function InfoTip({ text, label = 'More information' }: { text: string; label?: string; side?: 'top' | 'bottom' | 'right' }): ReactElement {
  return <AxInfoTip content={text} label={label} />;
}
