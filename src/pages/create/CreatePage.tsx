import { useState, type ReactElement } from 'react';
import { VisuallyHidden } from '@astryxdesign/core/VisuallyHidden';
import { VStack } from '@astryxdesign/core/Layout';
import { Route, Routes, useLocation, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/auth/AuthProvider';
import { creativesApi, type Versioned } from '@/api/creatives';
import { isApiError } from '@/api/errors';
import { Button } from '@/components/ui/Button';
import { Card, CardHead } from '@/components/ui/Card';
import { Select } from '@/components/ui/Form';
import { Alert, EmptyState, List, ListItem, PageHeader, SkeletonRows } from '@/components/ui/Misc';
import { fmtDateTime } from '@/lib/utils';
import { IN_DEVELOPMENT } from '@/config/inDevelopment';
import { InDevelopment } from '@/pages/shared/ui';
import { Composer } from './Composer';
import FinalPreview from './FinalPreview';

/** /marketing/create (new brief), /marketing/create/:creativeId (existing draft) and .../preview (final preview). */
export default function CreatePage(): ReactElement {
  return (
    <Routes>
      <Route index element={<NewBrief />} />
      <Route path=":creativeId" element={<ExistingDraft />} />
      <Route path=":creativeId/preview" element={<FinalPreview />} />
    </Routes>
  );
}

/* ---------- New brief ---------- */

function NewBrief() {
  const { context } = useSession();
  const recruiting = context.studies.filter((s) => s.recruitment_status === 'recruiting');
  const closedCount = context.studies.length - recruiting.length;
  const [studyId, setStudyId] = useState(recruiting[0]?.study_id ?? '');
  const study = recruiting.find((s) => s.study_id === studyId) ?? null;

  if (context.studies.length === 0) {
    return (
      <Page>
        <Card>
          <EmptyState icon="doc" title="No study set up for Marketing"
            description="Posts are written for an approved study. Studies appear here once one is shared with your organisation." />
        </Card>
      </Page>
    );
  }

  if (recruiting.length === 0) {
    return (
      <Page>
        <Card>
          <EmptyState icon="clock" title="No study is recruiting right now"
            description="New posts need a recruiting study. Drafts for closed studies stay readable below." />
        </Card>
        <DraftList />
      </Page>
    );
  }

  // Always a chooser, so it is clear the study is a choice. The first recruiting
  // study is selected to start with and can be changed until the draft is created.
  const picker = (
    <Select label="Study" required value={studyId} onChange={(e) => setStudyId(e.target.value)}
      help={closedCount ? 'Closed studies are not listed; they cannot be used for new posts.' : 'The post is checked against this study\'s approved facts.'}>
      <option value="" disabled>Choose a study</option>
      {recruiting.map((s) => <option key={s.study_id} value={s.study_id}>{s.study_title}</option>)}
    </Select>
  );

  return (
    <Page>
      <Composer study={study} initial={null} studyId={studyId} studyPicker={picker} />
      <DraftList />
    </Page>
  );
}

/* ---------- Existing draft ---------- */

function ExistingDraft() {
  const { creativeId = '' } = useParams();
  const location = useLocation();
  const { context } = useSession();
  const handed = (location.state as { versioned?: Versioned } | null)?.versioned;
  const fromCreate = handed?.creative.id === creativeId ? handed : undefined;

  const q = useQuery({
    queryKey: ['creative', context.tenant.tenant_id, creativeId],
    queryFn: ({ signal }) => creativesApi.get(creativeId, signal),
    enabled: !fromCreate,
    staleTime: 0,
    gcTime: 0,
  });
  const loaded = fromCreate ?? q.data;

  if (!loaded) {
    if (q.isError) {
      const e = q.error;
      const notFound = isApiError(e) && (e.kind === 'not_found' || e.kind === 'forbidden');
      return (
        <Page>
          <Card>
            {notFound ? (
              <EmptyState icon="search" title="Draft not found"
                description="It does not exist, or it is not available to you in this organisation."
                action={<Button variant="secondary" size="sm" href="/marketing/create">Back to Create post</Button>} />
            ) : (
              <>
                <Alert tone="blocked" title="The draft could not be loaded"
                  action={<Button variant="secondary" size="sm" icon="refresh" onClick={() => void q.refetch()}>Try again</Button>}>
                  {isApiError(e) ? e.message : 'Try again in a moment.'}
                </Alert>
              </>
            )}
          </Card>
        </Page>
      );
    }
    return <Page><Card><SkeletonRows rows={5} /><VisuallyHidden><span role="status">Loading the draft</span></VisuallyHidden></Card></Page>;
  }

  const study = context.studies.find((s) => s.study_id === loaded.creative.study_id) ?? null;
  const readOnly = study?.recruitment_status !== 'recruiting';
  const reason = !study
    ? 'The study for this draft is no longer available to you. The draft is shown as read-only history.'
    : `${study.study_title} is closed. This draft is read-only history and cannot be used for new posts.`;

  return (
    <Page crumbs>
      <Composer key={loaded.creative.id} study={study} initial={loaded} readOnly={readOnly} readOnlyReason={reason} />
    </Page>
  );
}

/* ---------- Shared ---------- */

function Page({ children, crumbs }: { children: React.ReactNode; crumbs?: boolean }) {
  return (
    <VStack gap={6}>
      <PageHeader title="Create post" crumbs={crumbs ? [{ label: 'Create post', to: '/marketing/create' }, { label: 'Draft' }] : undefined} />
      {children}
    </VStack>
  );
}

function DraftList() {
  const { context } = useSession();
  const q = useQuery({
    queryKey: ['creatives', context.tenant.tenant_id],
    queryFn: ({ signal }) => creativesApi.list(signal),
    // The backend has no draft list yet (config/inDevelopment.ts): do not call it.
    enabled: !IN_DEVELOPMENT.draftList,
  });
  const studyName = (id: string) => context.studies.find((s) => s.study_id === id)?.study_title ?? 'Study not available';

  if (IN_DEVELOPMENT.draftList) {
    return (
      <Card>
        <CardHead title="Your drafts" />
        <InDevelopment feature="Your drafts" description="The list of your drafts is being built and will be available soon. Open a draft from its link or from a validation result." />
      </Card>
    );
  }

  return (
    <Card>
      <CardHead title="Your drafts" />
      {q.isPending && <><SkeletonRows rows={3} /></>}
      {q.isError && isApiError(q.error) && q.error.kind === 'not_implemented' && (
        <EmptyState icon="clock" title="Draft list not available yet"
          description="Open a draft from its link for now. The list arrives with the next backend update." />
      )}
      {q.isError && !(isApiError(q.error) && q.error.kind === 'not_implemented') && (
        <>
          <Alert tone="blocked" title="Drafts could not be loaded"
            action={<Button variant="secondary" size="sm" icon="refresh" onClick={() => void q.refetch()}>Try again</Button>}>
            {isApiError(q.error) ? q.error.message : 'Try again in a moment.'}
          </Alert>
        </>
      )}
      {q.data?.length === 0 && <EmptyState icon="edit" title="No drafts yet" description="Drafts you create appear here." />}
      {q.data && q.data.length > 0 && (
        <List>
          {q.data.map((d) => (
            <ListItem key={d.id} chevron href={`/marketing/create/${encodeURIComponent(d.id)}`}
              title={d.prompt_preview || 'Empty brief'}
              sub={`${studyName(d.study_id)} · version ${d.version} · ${fmtDateTime(d.updated_at)}`} />
          ))}
        </List>
      )}
    </Card>
  );
}
