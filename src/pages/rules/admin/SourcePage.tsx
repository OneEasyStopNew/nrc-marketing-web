import { Fragment, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { Blockquote } from '@astryxdesign/core/Blockquote';
import { Divider } from '@astryxdesign/core/Divider';
import { VStack } from '@astryxdesign/core/Layout';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Text } from '@astryxdesign/core/Text';
import { Card, CardHead } from '@/components/ui/Card';
import { Alert, PageHeader } from '@/components/ui/Misc';
import { fmtDateTime } from '@/lib/utils';
import { QueryState } from '@/pages/shared/ui';
import { ExtractionBadge } from './labels';
import { RULEBOOKS_PATH, SOURCES_PATH } from './paths';
import { usePolicyClauses, usePolicySource } from './useRulebooks';

/**
 * One policy file (NRC-20): its details and the clauses the server read from
 * it, each with its section and page, worded exactly as read. While the
 * clauses are being read, the page looks again by itself.
 */
export default function SourcePage(): ReactElement {
  const { sourceId = '' } = useParams();
  const source = usePolicySource(sourceId);
  const s = source.data;
  const clauses = usePolicyClauses(sourceId, s?.extraction_state === 'EXTRACTED');

  return (
    <VStack gap={6}>
      <PageHeader
        crumbs={[{ label: 'Rules', to: '/marketing/rules' }, { label: 'Rulebooks', to: RULEBOOKS_PATH }, { label: 'Policy files', to: SOURCES_PATH }, { label: s?.title ?? 'File' }]}
        title={s?.title ?? 'Policy file'}
        badge={s && <ExtractionBadge state={s.extraction_state} />}
      />
      <QueryState query={source} what="this policy file">
        {(f) => (
          <VStack gap={6}>
            {f.is_synthetic && <Alert tone="regulatory" title="Synthetic document">A placeholder for testing, not the real policy.</Alert>}
            {(f.extraction_state === 'PENDING' || f.extraction_state === 'EXTRACTING') && (
              <Alert tone="info" title="Reading the clauses">The server is reading this file. This page updates by itself.</Alert>
            )}
            {f.extraction_state === 'FAILED' && (
              <Alert tone="blocked" title="The clauses could not be read">{`Reason code: ${f.extraction_error_code ?? 'not given'}. Upload the file again to retry.`}</Alert>
            )}
            <Card aria-label="Details">
              <CardHead title="Details" icon="info" />
              <MetadataList>
                <MetadataListItem label="Reference">{f.source_ref}</MetadataListItem>
                <MetadataListItem label="Language">{f.language === 'es' ? 'Spanish' : 'English'}</MetadataListItem>
                <MetadataListItem label="Pages">{f.page_count ?? 'Not known yet'}</MetadataListItem>
                <MetadataListItem label="Added">{`${fmtDateTime(f.created_at)} by ${f.created_by}`}</MetadataListItem>
                <MetadataListItem label="Clauses read">{f.extracted_at ? fmtDateTime(f.extracted_at) : 'Not yet'}</MetadataListItem>
              </MetadataList>
            </Card>
            {f.extraction_state === 'EXTRACTED' && (
              <Card aria-label="Clauses">
                <CardHead title="Clauses" icon="doc" />
                <QueryState query={clauses} what="the clauses of this file"
                  empty={<Text type="body" color="secondary">No clauses were found in this file.</Text>}>
                  {(list) => (
                    <VStack gap={4}>
                      {list.map((c, i) => (
                        <Fragment key={c.id}>
                          {i > 0 && <Divider />}
                          <VStack gap={1}>
                            <Text type="body" weight="semibold">{`Clause ${c.clause_ref}`}</Text>
                            <Text type="supporting" color="secondary">{[c.section, c.page ? `page ${c.page}` : null].filter(Boolean).join(' · ') || 'No section or page given'}</Text>
                            <Blockquote>{c.text}</Blockquote>
                          </VStack>
                        </Fragment>
                      ))}
                    </VStack>
                  )}
                </QueryState>
              </Card>
            )}
          </VStack>
        )}
      </QueryState>
    </VStack>
  );
}
