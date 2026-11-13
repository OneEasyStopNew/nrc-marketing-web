import type { ReactElement } from 'react';
import { useSession } from '@/auth/AuthProvider';
import { VStack } from '@astryxdesign/core/Layout';
import { Card } from '@/components/ui/Card';
import { EmptyState, PageHeader } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';

/**
 * EmptyState, no access. Shown when a route needs a capability the server did
 * not grant (deep link, bookmark, or a role changed since the menu was drawn).
 * The record behind the link is never loaded.
 */
export default function NoPermission({ section }: { section: string }): ReactElement {
  const { context } = useSession();
  return (
    <VStack gap={6}>
      <PageHeader title={section} />
      <Card>
        <EmptyState kind="locked" title="Not available with your role"
          description={`Your role in ${context.tenant.name} does not include ${section}. Ask an administrator if you need it.`}
          action={<Button variant="secondary" size="sm" href="/marketing">Go to Marketing home</Button>} />
      </Card>
    </VStack>
  );
}
