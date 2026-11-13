import type { ReactElement } from 'react';
import { VStack } from '@astryxdesign/core/Layout';
import { Card } from '@/components/ui/Card';
import { EmptyState, PageHeader } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';

export default function NotFound(): ReactElement {
  return (
    <VStack gap={6}>
      <PageHeader title="Page not found" />
      <Card>
        <EmptyState icon="search" title="This address does not match a Marketing page"
          description="Check the link, or start again from the Marketing home page."
          action={<Button variant="secondary" size="sm" href="/marketing">Go to Marketing home</Button>} />
      </Card>
    </VStack>
  );
}
