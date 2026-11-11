import type { ReactNode } from 'react';
import { Tooltip as AxTooltip } from '@astryxdesign/core/Tooltip';

/** Tooltip (Astryx): names icon-only buttons, explains a control or a disabled control. */
export function Tooltip({ text, children, side = 'top' }: { text: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'right'; className?: string; block?: boolean; toggle?: boolean }) {
  return <AxTooltip content={text} placement={side === 'top' ? 'above' : side === 'bottom' ? 'below' : 'end'}>{children}</AxTooltip>;
}
