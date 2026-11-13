import { useEffect, useRef, useState } from 'react';
import { useAuth, useSession } from '@/auth/AuthProvider';
import { useToast, type ToastKind } from '@/components/ui/Toast';
import { creativesApi, latestValidation } from '@/api/creatives';
import { isApiError, type ApiError, type ErrorKind } from '@/api/errors';
import { isInProgress, validationsApi } from '@/api/validations';
import { saveFile } from '@/lib/download';
import { buildValidationReport, validationReportFileName } from '@/pages/validation/report';

/**
 * Downloads the validation evidence report for what the preview shows (NRC-30).
 * It only reads the persisted run through the API; it never starts a model run.
 * Everything happens in the click handler. The report is built from a fresh
 * read of the draft and the run, and is refused when any of them no longer
 * matches the preview, so versions are never mixed.
 */

export interface ReportPreview {
  creativeId: string;
  /** Creative version shown on the preview. */
  version: number;
  /** The run the preview shows, however the preview found it (draft, review package or this tab). */
  runId: string | undefined;
  /** The image the preview shows; its id even when the image itself failed to load. */
  asset: { id: string; checksumSha256: string | null } | undefined;
}

interface Notice {
  title: string;
  detail: string;
  tone: ToastKind;
}

const STALE: Notice = {
  title: 'The draft changed while the report was prepared',
  detail: 'Refresh the preview and download the report again.',
  tone: 'waiting',
};
const NO_RESULT: Notice = { title: 'There is no validation result to report', detail: 'Validate the draft first.', tone: 'waiting' };
const STILL_RUNNING: Notice = {
  title: 'The validation is still running',
  detail: 'Download the report once it has finished.',
  tone: 'waiting',
};
const NOT_AVAILABLE_TO_YOU: Notice = {
  title: 'This validation result is not available to you',
  detail: 'It does not exist, or it is not available to you in this organisation.',
  tone: 'blocked',
};
const TRY_AGAIN: Notice = { title: 'The validation report could not be downloaded', detail: 'Try again in a moment.', tone: 'blocked' };

/**
 * One entry per ErrorKind, so a new kind fails typecheck here. Undefined means
 * "no toast": http.ts already handles the 401.
 */
const NOTICE_FOR: Record<ErrorKind, (e: ApiError) => Notice | undefined> = {
  not_implemented: () => ({
    title: 'The validation report is not available yet',
    detail: 'Validation results are not connected in this build.',
    tone: 'waiting',
  }),
  forbidden: () => NOT_AVAILABLE_TO_YOU,
  not_found: () => NOT_AVAILABLE_TO_YOU,
  network: () => TRY_AGAIN,
  unavailable: () => TRY_AGAIN,
  throttled: () => TRY_AGAIN,
  stale: () => STALE,
  unauthenticated: () => undefined,
  // ApiError messages are already generic (they never carry the response body).
  // The API answered in a shape this build doesn't understand: its generic message says to reload.
  contract: (e) => ({ ...TRY_AGAIN, detail: e.message }),
  conflict: (e) => ({ ...TRY_AGAIN, detail: e.message }),
  invalid: (e) => ({ ...TRY_AGAIN, detail: e.message }),
  server: (e) => ({ ...TRY_AGAIN, detail: e.message }),
};

/** The draft read has no timeout of its own; a hung read must not keep the button busy forever. */
export const REPORT_DRAFT_READ_TIMEOUT_MS = 15_000;

export function useValidationReport(preview: ReportPreview): { download: () => Promise<void>; downloading: boolean } {
  const { toast } = useToast();
  const { context } = useSession();
  const { mode } = useAuth();
  const [downloading, setDownloading] = useState(false);
  // A ref, not state: two clicks in the same tick both see the old state value.
  const inFlight = useRef(false);
  const controller = useRef<AbortController | undefined>(undefined);

  // Leaving the page cancels the reads and silences the result: syncs with an external resource (the network).
  useEffect(() => () => controller.current?.abort(), []);

  const show = (n: Notice): void => toast(n.title, n.tone, n.detail);

  const download = async (): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    const ctl = new AbortController();
    controller.current = ctl;
    const { signal } = ctl;
    setDownloading(true);
    try {
      const runId = preview.runId;
      if (!runId) return show(NO_RESULT);
      // A timeout surfaces as a network ApiError (retryable), not as our own abort.
      const { creative } = await creativesApi.get(
        preview.creativeId,
        AbortSignal.any([signal, AbortSignal.timeout(REPORT_DRAFT_READ_TIMEOUT_MS)]),
      );
      if (signal.aborted) return;
      // The preview finds its run and image in the draft, else the review package, else this tab's runs.
      // So only what the draft itself names can contradict the preview; silence in the draft is not a change.
      if (creative.version !== preview.version) return show(STALE);
      if (creative.asset_id && creative.asset_id !== preview.asset?.id) return show(STALE);
      const listed = latestValidation(creative);
      if (listed && listed.validation_run_id !== runId) return show(STALE);

      const run = await validationsApi.get(runId, signal);
      if (signal.aborted) return;
      if (run.validation_run_id !== runId || run.creative_version > creative.version) return show(STALE);
      // An image check of another image would describe a picture the preview no longer shows.
      if (run.asset_id && run.asset_id !== preview.asset?.id) return show(STALE);
      if (isInProgress(run.state)) return show(STILL_RUNNING);

      const study = context.studies.find((s) => s.study_id === creative.study_id);
      const isCurrent = run.is_current && run.creative_version === creative.version;
      const draft = { id: creative.id, version: creative.version, studySnapshotVersion: creative.study_snapshot_version };
      const report = buildValidationReport({
        run,
        creative: draft,
        study: study ? { title: study.study_title } : undefined,
        tenantName: context.tenant.name,
        asset: preview.asset,
        isCurrent,
        simulation: mode === 'simulation',
        generatedAt: new Date(),
      });
      saveFile(validationReportFileName({ creative: draft, run }), new Blob([report], { type: 'text/html;charset=utf-8' }));
      if (isCurrent) {
        toast(`Validation report for version ${run.creative_version} downloaded`, 'done', 'It is a draft for review, not an approval.');
      } else {
        toast(
          `Historical validation report for version ${run.creative_version} downloaded`,
          'waiting',
          'It is not the current result. Validate again for the current version.',
        );
      }
    } catch (e) {
      // Our own abort (the user left): nothing to show, and no state to set.
      if (signal.aborted) return;
      if (!isApiError(e)) {
        // Handled here, not rethrown: the caller uses `void download()`, so a rethrow is an unhandled rejection
        // (CLAUDE.local.md). Same dev-only logging as ErrorBoundary; there is no error tracker yet.
        if (import.meta.env.DEV) console.error('Validation report failed', e);
        show(TRY_AGAIN);
        return;
      }
      const notice = NOTICE_FOR[e.kind](e);
      if (notice) show(notice);
    } finally {
      if (!signal.aborted) setDownloading(false);
      inFlight.current = false;
    }
  };

  return { download, downloading };
}
