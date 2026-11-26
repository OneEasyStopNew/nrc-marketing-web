import type { ReactElement } from 'react';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { List, ListItem } from '@astryxdesign/core/List';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Text } from '@astryxdesign/core/Text';
import { fmtUsd } from '@/api/usage';
import { Card, CardBody, CardHead } from '@/components/ui/Card';
import { SkeletonRows } from '@/components/ui/Misc';
import { fmtDateTime } from '@/lib/utils';
import { useInDevelopment } from '@/pages/shared/ui';
import { AttemptStatusBadge, OUTCOME_LABEL, billedText, settingsOf } from './parts';
import { useAttempts } from './useUsage';

/**
 * What generation cost for one post (NRC-44): every attempt, including the
 * ones validation rejected and the refunds, with billed and estimated amounts
 * apart. Hidden while usage is in development.
 */
export function PostCost({ creativeId }: { creativeId: string }): ReactElement | null {
  const usageInDev = useInDevelopment('usage');
  const q = useAttempts({ creative_id: creativeId }, !usageInDev);
  if (usageInDev) return null;
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  const totals = q.data?.pages[0]?.totals;

  return (
    <Card>
      <CardHead title="Generation cost" icon="dollar" />
      <CardBody>
        {q.isPending ? <SkeletonRows rows={2} />
          : q.isError ? <Text type="body" color="secondary">The cost of this post is not available right now.</Text>
            : !totals?.attempts ? <Text type="body" color="secondary">No paid generation for this post yet.</Text>
              : (
                <VStack gap={3}>
                  <MetadataList>
                    <MetadataListItem label="Attempts">{totals.attempts}</MetadataListItem>
                    <MetadataListItem label="Billed">{fmtUsd(totals.confirmed)}</MetadataListItem>
                    {totals.refunded !== '0.00' && <MetadataListItem label="Refunded">{fmtUsd(totals.refunded)}</MetadataListItem>}
                    {totals.reserved !== '0.00' && <MetadataListItem label="Reserved">{fmtUsd(totals.reserved)} (not billed yet)</MetadataListItem>}
                    {totals.unknown > 0 && <MetadataListItem label="Billing unknown">{totals.unknown} {totals.unknown === 1 ? 'attempt' : 'attempts'}</MetadataListItem>}
                  </MetadataList>
                  <List hasDividers density="compact" aria-label="Generation attempts for this post">
                    {rows.map((a) => (
                      <ListItem key={a.attempt_id} align="start"
                        label={<Text type="body" wordBreak="break-word">Version {a.creative_version} · {a.model_label}</Text>}
                        description={(
                          <VStack gap={0.5} hAlign="start">
                            <Text type="supporting" color="secondary" wordBreak="break-word">{settingsOf(a)} · {fmtDateTime(a.created_at)}</Text>
                            <Text type="supporting" color="secondary" wordBreak="break-word">
                              Billed {billedText(a)} · estimated {fmtUsd(a.estimated)}{a.refunded ? ` · refunded ${fmtUsd(a.refunded)}` : ''} · {OUTCOME_LABEL[a.outcome]}
                            </Text>
                          </VStack>
                        )}
                        endContent={<AttemptStatusBadge value={a.status} />} />
                    ))}
                  </List>
                  <HStack><Link href="/marketing/usage">All usage and the balance</Link></HStack>
                </VStack>
              )}
      </CardBody>
    </Card>
  );
}
