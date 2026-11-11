import { Children, isValidElement, type ChangeEvent, type ReactNode } from 'react';
import { Selector } from '@astryxdesign/core/Selector';

/**
 * Select on Astryx Selector. Accepts <option> children and a DOM-style
 * onChange like a native select, so existing pages did not change; the
 * children become Selector options.
 */
export interface SelectProps {
  label: string;
  value: string;
  onChange?: (e: ChangeEvent<HTMLSelectElement>) => void;
  children: ReactNode;
  help?: string;
  error?: string;
  required?: boolean;
  info?: string;
  disabled?: boolean;
  /** Search box inside the list; on by default above eight options. */
  searchable?: boolean;
  className?: string;
  /** Hide the visible label (still announced). */
  labelHidden?: boolean;
  placeholder?: string;
}

type Option = { value: string; label: string; disabled?: boolean };

function optionsOf(children: ReactNode): { options: Option[]; placeholder?: string } {
  const options: Option[] = [];
  let placeholder: string | undefined;
  Children.forEach(children, (c) => {
    if (!isValidElement<{ value?: string; children?: ReactNode; disabled?: boolean }>(c)) return;
    const value = String(c.props.value ?? '');
    const label = Children.toArray(c.props.children).join('');
    // A disabled empty option is the "Choose…" prompt, not a choice.
    if (value === '' && c.props.disabled) { placeholder = label; return; }
    options.push({ value, label, disabled: c.props.disabled });
  });
  return { options, placeholder };
}

export function Select({ label, value, onChange, children, help, error, required, info, disabled, searchable, labelHidden, placeholder }: SelectProps) {
  const { options, placeholder: fromChildren } = optionsOf(children);
  return (
    <>
      <Selector
        label={label}
        isLabelHidden={labelHidden}
        value={value || undefined}
        options={options}
        placeholder={placeholder ?? fromChildren ?? 'Choose…'}
        description={help}
        isRequired={required}
        isDisabled={disabled}
        hasSearch={searchable ?? options.length > 8}
        status={error ? { type: 'error', message: error } : undefined}
        statusVariant="detached"
        width="100%"
        presentation="adaptive"
        onChange={(v) => onChange?.({ target: { value: v ?? '' }, currentTarget: { value: v ?? '' } } as unknown as ChangeEvent<HTMLSelectElement>)}
        {...(info ? { 'aria-description': info } : {})}
      />
    </>
  );
}
