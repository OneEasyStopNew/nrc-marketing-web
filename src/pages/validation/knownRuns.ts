import { z } from 'zod';
import { ValidationInputKind } from '@/api/schemas.gen';

/**
 * Validation runs started in this tab, so the draft can link back to their
 * results. The draft's own `validation_runs` list is used first whenever the
 * API fills it; this covers runs the API does not list there yet.
 *
 * Only ids and version numbers are kept (sessionStorage, this tab only). No
 * text, findings or links are stored.
 */
const RunRefSchema = z.object({
  id: z.string(),
  kind: ValidationInputKind,
  /** The draft version that was checked. */
  version: z.number().int(),
  /** Image runs: the image that was checked. */
  asset_id: z.string().nullable().optional(),
});
export type RunRef = z.infer<typeof RunRefSchema>;

const key = (tenantId: string, creativeId: string): string => `nrc.runs.${tenantId}.${creativeId}`;
const KEEP = 20;

/** Newest first. */
export function knownRuns(tenantId: string, creativeId: string): RunRef[] {
  try {
    // Stored values are checked like any other input (JS-14, JS-59); anything else is ignored.
    const raw: unknown = JSON.parse(sessionStorage.getItem(key(tenantId, creativeId)) ?? '[]');
    const parsed = z.array(RunRefSchema).safeParse(raw);
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function rememberRun(tenantId: string, creativeId: string, ref: RunRef): void {
  try {
    const rest = knownRuns(tenantId, creativeId).filter((r) => r.id !== ref.id);
    sessionStorage.setItem(key(tenantId, creativeId), JSON.stringify([ref, ...rest].slice(0, KEEP)));
  } catch { /* storage blocked: the results page still opens; only the link back is missing */ }
}
