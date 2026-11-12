import type { ReactNode, ReactElement } from 'react';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Drawer as AxDrawer, DrawerHeader } from '@astryxdesign/core/Drawer';
import { HStack, Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { Icon, type IconName } from './Icon';

const SIZES = { md: 480, lg: 560, xl: 820 };

/**
 * Modal: an Astryx Dialog laid out the library's way (DialogHeader, content,
 * footer in a Layout). A regulatory dialog cannot be closed by Escape or the
 * backdrop.
 */
export function Modal({ open, onClose, title, icon, regulatory, children, footer, size = 'md' }: {
  open: boolean; onClose: () => void; title: ReactNode; icon?: IconName; regulatory?: boolean; children: ReactNode; footer?: ReactNode; size?: keyof typeof SIZES;
}): ReactElement {
  const close = (o: boolean) => { if (!o) onClose(); };
  return (
    <Dialog isOpen={open} onOpenChange={close} width={SIZES[size]} maxHeight="92dvh" purpose={regulatory ? 'required' : 'info'}>
      <Layout
        header={<DialogHeader title={title} startContent={icon || regulatory ? <Icon name={icon ?? 'shield'} color={regulatory ? 'purple' : undefined} /> : undefined} onOpenChange={close} />}
        content={<LayoutContent>{children}</LayoutContent>}
        footer={footer ? <LayoutFooter hasDivider><HStack gap={2} hAlign="end" vAlign="center" wrap="wrap">{footer}</HStack></LayoutFooter> : undefined}
      />
    </Dialog>
  );
}

/** Side drawer (Astryx Drawer) for a record's details, with an optional footer. */
export function Drawer({ open, onClose, title, subtitle, badge, children, footer, width }: {
  open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; badge?: ReactNode; children: ReactNode; footer?: ReactNode; width?: number;
}): ReactElement {
  const close = (o: boolean) => { if (!o) onClose(); };
  return (
    <AxDrawer isOpen={open} onOpenChange={close} label={typeof title === 'string' ? title : 'Details'} width={width ?? 560}>
      <Layout
        header={<DrawerHeader title={title} subtitle={subtitle} endContent={badge} onOpenChange={close} hasDivider />}
        content={<LayoutContent>{children}</LayoutContent>}
        footer={footer ? <LayoutFooter hasDivider><HStack gap={2} hAlign="end" vAlign="center" wrap="wrap">{footer}</HStack></LayoutFooter> : undefined}
      />
    </AxDrawer>
  );
}

export { Tooltip } from './Tooltip';
