import { z } from 'zod';
import { http } from './http';

/**
 * Dashboards: usage and cost, validation quality and social performance
 * (NRC-46; analytics API NRC-45, Dinesh; metric meanings from Firoz).
 *
 * PROPOSED CONTRACT, not in the backend yet; the page is gated
 * (config/inDevelopment.ts, analytics) and only the simulation answers.
 *
 * A figure the backend does not have is null, never 0, and says why. Reach
 * and views are per account only: networks count them differently, so they
 * are never added up across networks.
 */

const isoDateTime = z.iso.datetime({ offset: true });
const Money = z.string().regex(/^\d+(\.\d{1,6})?$/);

const Freshness = z.object({
  /** When this source was last brought up to date; null when it has no data. */
  as_of: isoDateTime.nullable(),
  /** Why some of it is missing, in words; null when complete. */
  partial: z.string().nullable(),
});
export type Freshness = z.infer<typeof Freshness>;

const UsageSchema = z.object({
  freshness: Freshness,
  attempts: z.number().int(),
  /** Outputs used in a post (not rejected, replaced or discarded). */
  usable_outputs: z.number().int(),
  /** Posts with at least one confirmed publication. */
  published_posts: z.number().int(),
  confirmed: Money,
  /** Attempts not yet billed: estimate only, kept apart from billed money. */
  unconfirmed_estimate: Money,
  /** Billed money / usable outputs; null with no usable output. */
  cost_per_usable: Money.nullable(),
  /** Billed money / published posts; null with none published. Each post's cost counts once, however many accounts got it. */
  cost_per_published: Money.nullable(),
  median_latency_s: z.number().nullable(),
  by_model: z.array(z.object({ model_label: z.string(), attempts: z.number().int(), usable: z.number().int(), confirmed: Money })),
});

const ValidationSchema = z.object({
  freshness: Freshness,
  runs: z.number().int(),
  pass: z.number().int(),
  fail: z.number().int(),
  needs_review: z.number().int(),
  /** Runs where a required check could not be assessed. */
  unable_to_assess: z.number().int(),
  /** Average versions a post took to pass; null when none passed. */
  avg_correction_rounds: z.number().nullable(),
  top_rules: z.array(z.object({ rule_id: z.string(), title: z.string(), findings: z.number().int() })),
});

const SocialSchema = z.object({
  freshness: Freshness,
  published: z.number().int(),
  failed: z.number().int(),
  unknown: z.number().int(),
  partial: z.number().int(),
  manual: z.number().int(),
  by_account: z.array(z.object({
    account_id: z.string(),
    channel: z.string(),
    account_name: z.string(),
    posts: z.number().int(),
    /** As the network reports them; null when it reports none for this account. */
    impressions: z.number().int().nullable(),
    engagements: z.number().int().nullable(),
    video_views: z.number().int().nullable(),
    unavailable_reason: z.string().nullable(),
  })),
});

const DashboardSchema = z.object({
  generated_at: isoDateTime,
  usage: UsageSchema,
  validation: ValidationSchema,
  social: SocialSchema,
});
export type Dashboard = z.infer<typeof DashboardSchema>;

export interface DashboardFilter {
  from?: string;
  to?: string;
  study_id?: string;
  social_set_id?: string;
  workflow?: 'AI_CREATE' | 'VALIDATION_ONLY';
}

export const analyticsApi = {
  dashboard: (f: DashboardFilter, signal?: AbortSignal): Promise<Dashboard> => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) p.set(k, String(v));
    const s = p.toString();
    return http.get(`/analytics/dashboard${s ? `?${s}` : ''}`, DashboardSchema, { signal });
  },
};
