import { useId, type ChangeEvent, type ReactNode, type Ref } from 'react';
import { VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { VisuallyHidden } from '@astryxdesign/core/VisuallyHidden';
import { TextArea as AxTextArea } from '@astryxdesign/core/TextArea';
import { TextInput as AxTextInput } from '@astryxdesign/core/TextInput';
import { charCount } from '@/lib/utils';

/**
 * Text fields on Astryx (TextInput, TextArea). The props keep the earlier NRC
 * kit's shape (DOM-style onChange, `error`, `help`, `limit`) so the Create page
 * did not change. New pages use the Astryx controls directly.
 *
 * `limit` is counted in Unicode code points, which is how the backend counts.
 * Astryx's own maxLength counts grapheme clusters and stops typing, so it is not
 * used: the backend stays authoritative and the counter shows when it is passed.
 */

export interface FieldProps {
  label: string;
  help?: string;
  error?: string;
  required?: boolean;
  info?: string;
}

export interface InputProps extends FieldProps {
  value: string;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  type?: 'text' | 'email' | 'search' | 'tel' | 'url' | 'password';
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  ref?: Ref<HTMLInputElement>;
}

export function Input({ label, help, error, required, info, value, onChange, type, placeholder, disabled, ref }: InputProps) {
  return (
    <>
      <AxTextInput ref={ref} label={label} value={value} type={type} placeholder={placeholder}
        description={help} labelTooltip={info} isRequired={required} isOptional={!required && undefined}
        isDisabled={disabled} width="100%"
        status={error ? { type: 'error', message: error } : undefined} statusVariant="detached"
        onChange={(_v, e) => onChange?.(e)} />
    </>
  );
}

export interface TextareaProps extends FieldProps {
  value: string;
  onChange?: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
  /** Character limit shown as a counter, in code points (the backend's count). */
  limit?: number;
  className?: string;
  ref?: Ref<HTMLTextAreaElement>;
}

export function Textarea({ label, help, error, required, info, value, onChange, rows, placeholder, disabled, limit, ref }: TextareaProps) {
  const countId = `${useId()}-count`;
  const len = charCount(value);
  const over = limit !== undefined && len > limit;
  return (
    <VStack gap={1}>
      <AxTextArea ref={ref} label={label} value={value} rows={rows} placeholder={placeholder}
        description={help} labelTooltip={info} isRequired={required} isDisabled={disabled} width="100%"
        status={error ? { type: 'error', message: error } : over ? { type: 'error' } : undefined} statusVariant="detached"
        aria-describedby={limit !== undefined ? countId : undefined}
        onChange={(_v, e) => onChange?.(e)} />
      {limit !== undefined && (
        <VStack hAlign="end">
          <span id={countId}>
            <Text type="supporting" color="secondary" hasTabularNumbers>
              {len} / {limit}<VisuallyHidden> characters{over ? ', over the limit' : ''}</VisuallyHidden>
            </Text>
          </span>
        </VStack>
      )}
    </VStack>
  );
}

/** A labelled read-only value inside a form. */
export function Field({ label, children }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <VStack gap={1}>
      <Text type="label">{label}</Text>
      {children}
    </VStack>
  );
}

export { Select } from './Select';
