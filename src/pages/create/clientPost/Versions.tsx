import { useState, type ReactElement } from 'react';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { Heading, Text } from '@astryxdesign/core/Text';
import type { ClientCheck, ClientPost, ClientPostVersion } from '@/api/clientPosts';
import { isApiError } from '@/api/errors';
import { isInProgress } from '@/api/validations';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHead } from '@/components/ui/Card';
import { Alert, SkeletonRows } from '@/components/ui/Misc';
import { Modal } from '@/components/ui/Overlay';
import { fmtDateTime } from '@/lib/utils';
import { DiffBlock } from '../revisions';
import { useClientVersions } from './useClientPost';
import { Wrap } from './Wrap';

type SaveVersion = (body: { caption?: string | null; asset_ids?: string[]; change_note: string }) => Promise<boolean>;

/**
 * Every saved version of a checked post, newest first: what changed, who
 * saved it and what the check said about that exact version. Versions never
 * change; "Use version N" saves its caption and files as a new version.
 */
export function ClientVersions({ post, check, canEdit, saving, onSave }: {
  post: ClientPost;
  check: ClientCheck | null;
  canEdit: boolean;
  saving: boolean;
  onSave: SaveVersion;
}): ReactElement {
  const stamp = check ? `${check.check_id}:${check.state}` : 'none';
  const q = useClientVersions(post.id, post.version, stamp);
  const [compare, setCompare] = useState<ClientPostVersion | null>(null);

  return (
    <Card>
      <CardHead title="Versions" icon="clock" />
      {q.isPending ? (
        <CardBody><SkeletonRows rows={3} /></CardBody>
      ) : q.isError ? (
        <CardBody>
          {isApiError(q.error) && q.error.kind === 'not_implemented'
            ? <Text type="body" color="secondary">Version history is not available yet.</Text>
            : <Alert tone="blocked" title="Versions could not be loaded"
                action={<Button size="sm" variant="secondary" icon="refresh" onClick={() => void q.refetch()}>Try again</Button>} />}
        </CardBody>
      ) : (
        <List hasDividers aria-label="Saved versions, newest first">
          {q.data.map((v) => (
            <ListItem key={v.version} align="start"
              label={(
                <HStack gap={2} vAlign="center" wrap="wrap">
                  <Text type="body" weight="semibold">Version {v.version}</Text>
                  {v.version === post.version && <Badge variant="brand">Current</Badge>}
                </HStack>
              )}
              description={(
                <VStack gap={1} hAlign="start">
                  {v.change_note && <Text type="supporting">{v.change_note}</Text>}
                  <Text type="supporting" color="secondary">{contentOf(v)}</Text>
                  <Text type="supporting" color="secondary">Saved {fmtDateTime(v.created_at)} by {v.created_by_name ?? v.created_by}</Text>
                  {v.version !== post.version && (
                    <Button size="sm" variant="ghost" icon="eye" onClick={() => setCompare(v)}
                      aria-label={`Compare version ${v.version} with version ${post.version}`}>Compare with current</Button>
                  )}
                </VStack>
              )}
              endContent={<VersionCheckBadge check={v.check} />} />
          ))}
        </List>
      )}
      {compare && (
        <CompareVersions version={compare} post={post} canEdit={canEdit} saving={saving}
          onClose={() => setCompare(null)}
          onRestore={async () => {
            const ok = await onSave({
              caption: compare.caption,
              asset_ids: compare.media.map((m) => m.asset_id),
              change_note: `Restored version ${compare.version}`,
            });
            if (ok) setCompare(null);
          }} />
      )}
    </Card>
  );
}

const contentOf = (v: ClientPostVersion): string => {
  const images = v.media.filter((m) => m.kind === 'image').length;
  const videos = v.media.length - images;
  const files = [images && `${images} image${images > 1 ? 's' : ''}`, videos && 'a video'].filter(Boolean).join(' and ');
  return [v.caption ? 'Caption' : 'No caption', files || 'no files'].join(' · ');
};

/** What the check said about one version. A pass with gaps is never a plain pass. */
function VersionCheckBadge({ check }: { check: ClientPostVersion['check'] }) {
  if (!check) return <Badge>Not checked</Badge>;
  if (isInProgress(check.state)) return <Badge variant="brand">Checking</Badge>;
  if (check.state === 'FAILED' || check.state === 'CANCELLED') return <Badge variant="blocked">Check did not finish</Badge>;
  if (check.outcome === 'PASS') return check.has_coverage_gaps ? <Badge variant="waiting">Passed what could be assessed</Badge> : <Badge variant="done">Passed</Badge>;
  if (check.outcome === 'FAIL') return <Badge variant="blocked">Failed</Badge>;
  return <Badge variant="waiting">Needs review</Badge>;
}

/* ---------- Compare ---------- */

function CompareVersions({ version, post, canEdit, saving, onClose, onRestore }: {
  version: ClientPostVersion;
  post: ClientPost;
  canEdit: boolean;
  saving: boolean;
  onClose: () => void;
  onRestore: () => Promise<void>;
}) {
  const oldIds = version.media.map((m) => m.asset_id);
  const nowIds = post.media.map((m) => m.asset_id);
  const same = (version.caption ?? '') === (post.caption ?? '') && oldIds.join() === nowIds.join();
  const files = [
    ...version.media.map((m) => ({ m, status: nowIds.includes(m.asset_id) ? 'same' as const : 'removed' as const })),
    ...post.media.filter((m) => !oldIds.includes(m.asset_id)).map((m) => ({ m, status: 'added' as const })),
  ];

  return (
    <Modal open onClose={onClose} size="xl" icon="eye" title={`Version ${version.version} compared with version ${post.version}`}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {canEdit && !same && (
            <Button variant="primary" loading={saving} onClick={() => void onRestore()}>Use version {version.version}</Button>
          )}
        </>
      )}>
      <VStack gap={4}>
        <Text type="body" color="secondary">
          <span className="diff-del">Removed</span> words are in version {version.version} only;{' '}
          <span className="diff-ins">added</span> words are in version {post.version}. Nothing changes until you choose.
        </Text>
        <DiffBlock label="Caption" before={version.caption ?? ''} after={post.caption ?? ''} />
        <section aria-label="File differences"><VStack gap={2}>
          <Heading level={3}>Files</Heading>
          {files.length === 0 ? <Text type="body" color="secondary">No files in either version.</Text> : (
            <List hasDividers density="compact" aria-label="Files in both versions">
              {files.map(({ m, status }) => {
                const was = oldIds.indexOf(m.asset_id);
                const now = nowIds.indexOf(m.asset_id);
                const moved = status === 'same' && was !== now;
                return (
                <ListItem key={m.asset_id} label={<Wrap>{m.file_name}</Wrap>}
                  description={`${m.kind === 'video' ? 'Video' : 'Image'}${moved ? ` · position ${was + 1} in version ${version.version}, ${now + 1} in version ${post.version}` : ''}`}
                  endContent={status === 'same' ? <Badge variant={moved ? 'brand' : 'neutral'}>{moved ? 'Moved' : 'In both'}</Badge>
                    : status === 'removed' ? <Badge variant="waiting">Only in version {version.version}</Badge>
                      : <Badge variant="brand">Only in version {post.version}</Badge>} />
                );
              })}
            </List>
          )}
        </VStack></section>
        {canEdit && !same && (
          <Text type="supporting" color="secondary">
            Using version {version.version} saves its caption and files as version {post.version + 1}. It must be checked again; version {version.version} itself stays as it was.
          </Text>
        )}
        {same && <Text type="body" color="secondary">Version {version.version} has the same caption and files as version {post.version}.</Text>}
      </VStack>
    </Modal>
  );
}
