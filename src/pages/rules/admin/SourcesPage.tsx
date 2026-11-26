import { useMemo, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileInput } from '@astryxdesign/core/FileInput';
import { VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Switch } from '@astryxdesign/core/Switch';
import { Table, pixel, proportional, type TableColumn } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { useAuth } from '@/auth/AuthProvider';
import { isApiError } from '@/api/errors';
import { sendFile } from '@/api/http';
import { fileChecksum, policyAdminApi, policyFileProblem, type PolicySource, type PolicyUpload } from '@/api/policyAdmin';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHead } from '@/components/ui/Card';
import { Input } from '@/components/ui/Form';
import { Alert, EmptyState, PageHeader } from '@/components/ui/Misc';
import { Select } from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import { fmtDateTime } from '@/lib/utils';
import { QueryState, useIsSimulation } from '@/pages/shared/ui';
import { ExtractionBadge } from './labels';
import { RULEBOOKS_PATH, sourceHref } from './paths';
import { usePolicySources, useRulebookChange } from './useRulebooks';

/**
 * Policy files (NRC-20 on NRC-4): the source documents rulebooks are written
 * from, and uploading a new one. An upload runs in steps the screen names:
 * the file's fingerprint, sending it to the one-time storage address, the
 * server's safety scan, then registering it so the server reads its clauses.
 * An uploaded file is only a source: it changes no rulebook by itself.
 */
export default function SourcesPage(): ReactElement {
  const sources = usePolicySources();
  const columns = useMemo(() => sourceColumns(), []);
  const { can } = useAuth();
  return (
    <VStack gap={6}>
      <PageHeader
        crumbs={[{ label: 'Rules', to: '/marketing/rules' }, { label: 'Rulebooks', to: RULEBOOKS_PATH }, { label: 'Policy files' }]}
        title="Policy files"
        description="The source documents rulebooks are written from. Uploading a file changes no rulebook by itself."
      />
      {can('policy:manage') && <UploadCard />}
      <QueryState query={sources} what="the policy files"
        empty={<EmptyState icon="doc" title="No policy files yet" description="Upload the first source document above." />}>
        {(list) => <Table<PolicySource> data={list} columns={columns} idKey="id" density="balanced" dividers="rows" />}
      </QueryState>
    </VStack>
  );
}

function sourceColumns(): TableColumn<PolicySource>[] {
  return [
    {
      key: 'title', header: 'File', width: proportional(3, { minWidth: 220 }),
      renderCell: (s) => (
        <VStack gap={0.5} hAlign="start">
          <Link href={sourceHref(s.id)}>{s.title}</Link>
          {s.is_synthetic && <Badge variant="regulatory">Synthetic</Badge>}
        </VStack>
      ),
    },
    { key: 'extraction_state', header: 'Clauses', width: proportional(1, { minWidth: 150 }), renderCell: (s) => <ExtractionBadge state={s.extraction_state} /> },
    { key: 'page_count', header: 'Pages', width: pixel(80), renderCell: (s) => <Text type="body" hasTabularNumbers>{s.page_count ?? '–'}</Text> },
    { key: 'created_at', header: 'Added', width: proportional(1, { minWidth: 140 }), renderCell: (s) => <Text type="body">{fmtDateTime(s.created_at)}</Text> },
  ];
}

type Step = 'idle' | 'fingerprint' | 'sending' | 'scanning' | 'registering';
const STEP_WORD: Record<Exclude<Step, 'idle'>, string> = {
  fingerprint: 'Reading the file…',
  sending: 'Sending the file…',
  scanning: 'The server is checking the file for safety…',
  registering: 'Adding it to the policy files…',
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function UploadCard(): ReactElement {
  const { toast } = useToast();
  const navigate = useNavigate();
  const sim = useIsSimulation();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [language, setLanguage] = useState<'en' | 'es'>('en');
  const [synthetic, setSynthetic] = useState(false);
  const [step, setStep] = useState<Step>('idle');
  const [problem, setProblem] = useState<string | null>(null);
  /** Same key when the same file is retried, so the server returns the same upload. */
  const key = useRef<{ file: File; key: string } | null>(null);

  const register = useRulebookChange(async (f: File) => {
    setStep('fingerprint');
    const checksum = await fileChecksum(f);
    if (key.current?.file !== f) key.current = { file: f, key: crypto.randomUUID() };
    let u: PolicyUpload = await policyAdminApi.startUpload({ name: f.name, mime_type: f.type, size_bytes: f.size, checksum_sha256: checksum }, key.current.key);
    if (u.status === 'PENDING_UPLOAD') {
      if (!u.upload) u = await policyAdminApi.uploadUrl(u.upload_id);
      setStep('sending');
      if (u.upload) await sendFile(u.upload, f);
      u = await policyAdminApi.completeUpload(u.upload_id);
    }
    setStep('scanning');
    for (let i = 0; i < 60 && (u.status === 'SCANNING' || u.status === 'QUARANTINED'); i++) {
      await wait(sim ? 200 : 2000);
      u = await policyAdminApi.upload(u.upload_id);
    }
    if (u.status !== 'READY') throw new Error(u.reason?.message ?? (u.status === 'REJECTED' ? 'The server refused the file.' : 'The file check did not finish. Try again.'));
    setStep('registering');
    return policyAdminApi.createSource({ upload_id: u.upload_id, title: title.trim(), source_ref: f.name, is_synthetic: synthetic, language });
  });

  const submit = () => {
    if (!file) { setProblem('Choose a file.'); return; }
    const p = policyFileProblem(file);
    if (p) { setProblem(p); return; }
    if (!title.trim()) { setProblem('Give the file a title.'); return; }
    setProblem(null);
    register.mutate([file], {
      onSuccess: (s) => {
        toast('Policy file added', 'done', 'The server is reading its clauses. No rulebook changed.');
        key.current = null;
        void navigate(sourceHref(s.id));
      },
      onSettled: () => setStep('idle'),
    });
  };

  return (
    <Card aria-label="Upload a policy file">
      <CardHead title="Upload a policy file" icon="up" />
      <FileInput label="File" mode="dropzone" accept="application/pdf,text/plain,text/markdown" isRequired value={file}
        onChange={(f) => { setFile(Array.isArray(f) ? f[0] ?? null : f); setProblem(null); }}
        description={`PDF, plain text or Markdown, up to 50 MB.${sim ? ' In simulation the file is not sent anywhere.' : ''}`} />
      <Input label="Title" required value={title} help="How the file is named in the policy library." onChange={(e) => setTitle(e.target.value)} />
      <Select label="Language" value={language} onChange={(e) => setLanguage(e.target.value as 'en' | 'es')}>
        <option value="en">English</option><option value="es">Spanish</option>
      </Select>
      <Switch label="Synthetic test document" value={synthetic} onChange={setSynthetic} description="Turn on for placeholder documents used for testing, never for the real policy." />
      {problem && <Alert tone="blocked">{problem}</Alert>}
      {register.error && <Alert tone="blocked" title="The file was not added">{isApiError(register.error) ? register.error.message : register.error.message}</Alert>}
      {step !== 'idle' && <Text type="body" color="secondary" role="status">{STEP_WORD[step]}</Text>}
      <VStack hAlign="start">
        <Button variant="primary" icon="up" loading={register.isPending} onClick={submit}>Upload</Button>
      </VStack>
    </Card>
  );
}
