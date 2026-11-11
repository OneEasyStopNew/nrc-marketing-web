import { isValidElement, type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react';
import { Button as AxButton } from '@astryxdesign/core/Button';
import { Icon, type IconName } from './Icon';

/**
 * Button: Astryx Button with the NRC Connect variant names.
 * - primary: one per view, the main action
 * - secondary / outline: everything that is not the main action
 * - ghost / link: toolbars, Cancel, quiet actions
 * - danger / danger-outline: destructive confirmations only (Astryx "destructive")
 * - regulatory / done: approve or close a state (primary styling)
 * Disabled buttons use aria-disabled, so they stay focusable and keep their tooltip.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'danger-outline' | 'regulatory' | 'done' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon from the NRC icon set. */
  icon?: IconName;
  /** Icon-only square button; pass `aria-label`. */
  iconOnly?: boolean;
  pill?: boolean;
  block?: boolean;
  loading?: boolean;
  active?: boolean;
  /** Short explanation on hover and focus: what happens, or why it is disabled. */
  tip?: string;
  /** Renders a link styled as a button (in-app paths go through React Router). */
  href?: string;
  ref?: Ref<HTMLButtonElement>;
}

const AX_VARIANT: Record<ButtonVariant, 'primary' | 'secondary' | 'ghost' | 'destructive'> = {
  primary: 'primary', regulatory: 'primary', done: 'primary',
  secondary: 'secondary', outline: 'secondary',
  ghost: 'ghost', link: 'ghost',
  danger: 'destructive', 'danger-outline': 'destructive',
};

/** Plain text of a node, for the accessible label Astryx requires. */
function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

export function Button({
  variant = 'secondary', size = 'md', icon, iconOnly, pill: _pill, block, loading, active, tip, className: _className, children,
  disabled, type = 'button', href, ref, 'aria-label': ariaLabel, ...props
}: ButtonProps) {
  const label = ariaLabel ?? textOf(children);
  return (
    <AxButton
      ref={ref}
      {...(props as object)}
      data-variant={variant}
      href={href}
      type={type}
      label={label}
      variant={AX_VARIANT[variant]}
      size={size}
      icon={icon ? <Icon name={icon} /> : undefined}
      isIconOnly={iconOnly}
      isLoading={loading}
      isDisabled={disabled}
      tooltip={tip}
      width={block ? '100%' : undefined}
      aria-pressed={active ?? undefined}
    >
      {iconOnly ? undefined : children}
    </AxButton>
  );
}
