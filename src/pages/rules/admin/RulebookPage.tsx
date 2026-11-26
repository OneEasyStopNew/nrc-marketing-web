import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Text } from '@astryxdesign/core/Text';
import type { PolicyAuditEntry, PolicyBundleDetail, PolicyIssue } from '@/api/policyAdmin';
import { Card, CardHead } from '@/components/ui/Card';
import { Alert, PageHeader } from '@/components/ui/Misc';
import { fmtDateTime } from '@/lib/utils';
import { QueryState } from '@/pages/shared/ui';
import { AUDIT_WORD, BUILD_FAILURE_WORD, BundleStateBadge, ISSUE_WORD, STATE_HINT, STATE_WORD } from './labels';
import { NewDraftButton } from './Editing';
import { Lifecycle } from './Lifecycle';
import { RulesList } from './RulesList';
import { RULEBOOKS_PATH, rulebookHref } from './paths';
import { useRulebook, useRulebookHistory, useRulebookIssues } from './useRulebooks';

/**
 * One rulebook version (NRC-20): what its status means, who approved and
 * activated it, the problems the server's checks report, every rule with its
 * exact wording, and the history. Read-only in this step. Wording is shown
 * exactly as the API supplies it.
 */
export default function RulebookPage(): ReactElement {
  const { bundleId = '' } = useParams();
  const bundle = useRulebook(bundleId);
  const title = bundle.data ? `Version ${bundle.data.version}` : 'Rulebook';
  const { can } = useAuth();

  return (
    <VStack gap={6}>
      <PageHeader
        crumbs={[{ label: 'Rules', to: '/marketing/rules' }, { label: 'Rulebooks', to: RULEBOOKS_PATH }, { label: title }]}
        title={title}
        badge={bundle.data && <BundleStateBadge state={bundle.data.lifecycle_state} />}
        description={bundle.data?.name}
        actions={bundle.data && can('policy:manage') ? <NewDraftButton bundle={bundle.data} /> : undefined}
      />
      <QueryState query={bundle} what="this rulebook">
        {(b) => (
          <VStack gap={6}>
            {b.is_synthetic && <Alert tone="regulatory" title="Synthetic rulebook">Placeholder rules for testing. They are not the approved IPB policy.</Alert>}
            <Alert tone={b.lifecycle_state === 'ACTIVE' ? 'done' : b.lifecycle_state === 'REJECTED' ? 'blocked' : 'info'} title={STATE_WORD[b.lifecycle_state][1]}>
              {STATE_HINT[b.lifecycle_state]}
            </Alert>
            {b.last_error_code && (
              <Alert tone="blocked" title="The last build failed">{BUILD_FAILURE_WORD[b.last_error_code]} The rulebook stays approved; it can be built again.</Alert>
            )}
            <Lifecycle bundle={b} />
            <Details bundle={b} />
            <Problems bundleId={b.id} />
            <RulesList bundle={b} />
            <History bundleId={b.id} />
          </VStack>
        )}
      </QueryState>
    </VStack>
  );
}

function Details({ bundle: b }: { bundle: PolicyBundleDetail }): ReactElement {
  return (
    <Card aria-label="Details">
      <CardHead title="Details" icon="info" />
      <MetadataList>
        <MetadataListItem label="Version">{b.version}</MetadataListItem>
        <MetadataListItem label="Based on">{b.based_on_bundle_id ? <Link href={rulebookHref(b.based_on_bundle_id)}>The previous version</Link> : 'Nothing; written from scratch'}</MetadataListItem>
        <MetadataListItem label="Source">{b.source_ref}</MetadataListItem>
        <MetadataListItem label="Approved">{b.approved_at ? `${fmtDateTime(b.approved_at)} by ${b.approved_by ?? 'unknown'}` : 'Not approved'}</MetadataListItem>
        <MetadataListItem label="Activated">{b.activated_at ? `${fmtDateTime(b.activated_at)} by ${b.activated_by ?? 'unknown'}` : 'Never'}</MetadataListItem>
        <MetadataListItem label="Created">{fmtDateTime(b.created_at)}</MetadataListItem>
        <MetadataListItem label="Last change">{`${fmtDateTime(b.updated_at)} (change number ${b.revision})`}</MetadataListItem>
      </MetadataList>
    </Card>
  );
}

/** The server's checks. An empty answer is stated plainly, never shown as a success badge. */
function Problems({ bundleId }: { bundleId: string }): ReactElement {
  const issues = useRulebookIssues(bundleId);
  return (
    <Card aria-label="Problems that block approval or activation">
      <CardHead title="Problems that block approval or activation" icon="warn" />
      <QueryState query={issues} what="the checks for this rulebook">
        {(list) => list.length === 0
          ? <Text type="body" color="secondary">The server found no blocking problems. A person still reviews and approves the rulebook.</Text>
          : (
            <VStack gap={3}>
              {list.map((i: PolicyIssue, n) => (
                <Alert key={`${i.code}-${i.subject}-${n}`} tone="waiting" title={ISSUE_WORD[i.code]}>
                  <VStack gap={1}>
                    <Text type="body" wordBreak="break-word">{i.message}</Text>
                    <Text type="body" wordBreak="break-word">{`About: ${i.subject}`}</Text>
                  </VStack>
                </Alert>
              ))}
            </VStack>
          )}
      </QueryState>
    </Card>
  );
}


function History({ bundleId }: { bundleId: string }): ReactElement {
  const history = useRulebookHistory(bundleId);
  return (
    <Card aria-label="History">
      <CardHead title="History" icon="clock" />
      <QueryState query={history} what="the history of this rulebook">
        {(list) => (
          <VStack gap={3}>
            {list.map((a: PolicyAuditEntry) => (
              <VStack key={a.id} gap={0.5}>
                <HStack gap={2} vAlign="center" wrap="wrap">
                  <Text type="body" weight="semibold">{AUDIT_WORD[a.action]}</Text>
                  {a.to_state && a.from_state !== a.to_state && <BundleStateBadge state={a.to_state} />}
                </HStack>
                <Text type="supporting" color="secondary">{`${fmtDateTime(a.created_at)} · ${a.actor}`}</Text>
                {a.reason && <Text type="body" wordBreak="break-word">{`Reason: ${a.reason}`}</Text>}
              </VStack>
            ))}
          </VStack>
        )}
      </QueryState>
    </Card>
  );
}
