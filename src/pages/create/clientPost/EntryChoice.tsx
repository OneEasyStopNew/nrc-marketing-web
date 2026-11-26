import type { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { Seg } from '@/components/ui/Misc';
import { useValidationOnlyAvailable } from './useClientPost';

export type Entry = 'create' | 'check';

/**
 * The two ways into Create post (NRC-41): write a brief and generate with AI,
 * or check a post the client already has. Renders nothing while checking an
 * existing post is not available in this build.
 */
export function EntryChoice({ value }: { value: Entry }): ReactElement | null {
  const navigate = useNavigate();
  const available = useValidationOnlyAvailable();
  if (!available) return null;
  return (
    <Seg<Entry> label="How do you want to start?" value={value}
      onChange={(v) => navigate(v === 'check' ? '/marketing/create/check' : '/marketing/create')}
      options={[{ id: 'create', label: 'Create with AI' }, { id: 'check', label: 'Check an existing post' }]} />
  );
}
