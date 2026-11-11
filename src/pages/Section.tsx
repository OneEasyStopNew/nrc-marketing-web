import { Card } from '@/components/ui/Card';
import { VStack } from '@astryxdesign/core/Layout';
import { EmptyState, PageHeader } from '@/components/ui/Misc';
import type { NavItem } from '@/config/nav';

/** A section the shell already routes to and guards, whose page is built by a later ticket. */
export default function Section({ item }: { item: NavItem }) {
  return (
    <VStack gap={6}>
      <PageHeader title={item.name} />
      <Card>
        <EmptyState icon={item.icon} title="Not built yet" description={`${item.hint}. This page is not part of this release yet.`} />
      </Card>
    </VStack>
  );
}
