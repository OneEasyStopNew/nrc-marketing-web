import { z } from 'zod';
import { stagingLabel } from '@/lib/utils';
import { http } from './http';

/**
 * Generation usage, balance and forecasts (NRC-44; backend NRC-42/NRC-43, Firoz).
 *
 * PROPOSED CONTRACT. None of these endpoints exists yet; the shapes are the
 * frontend's proposal for Firoz to confirm or change. Until then the page is
 * gated (config/inDevelopment.ts, usage) and only the simulation answers.
 *
 * Money is a decimal string in the provider's currency (USD for the Higgsfield
 * API), never a float, so totals and exported statements match the backend to
 * the cent. Estimated, reserved, confirmed and refunded amounts are separate
 * fields and are never added together as if they were the same thing.
 */

const isoDateTime = z.iso.datetime({ offset: true });
/** A non-negative decimal amount with up to 6 places, e.g. "0.04". */
const Money = z.string().regex(/^\d+(\.\d{1,6})?$/);

/** Where the balance figure comes from. Only LIVE may be worded as the current balance. */
export const BalanceSource = z.enum(['LIVE', 'SNAPSHOT', 'UNAVAILABLE']);
export type BalanceSource = z.infer<typeof BalanceSource>;

const BalanceSchema = z.object({
  provider: z.string(),
  currency: z.literal('USD'),
  source: BalanceSource,
  /** Provider balance; null when unavailable. */
  amount: Money.nullable(),
  /** When the provider reported it. */
  as_of: isoDateTime.nullable(),
  /** Held for generations that are running and not yet billed. */
  reserved: Money,
  /** This organisation's share of the provider balance, when one is set. */
  allocation: z.object({
    allocated: Money,
    confirmed_used: Money,
    reserved: Money,
    remaining: Money,
  }).nullable(),
  /** Below this the page warns that the balance is low. */
  low_threshold: Money,
  /** A provider-console link for adding funds, only when an administrator approved one. */
  recharge_url: z.url().nullable(),
  /** Tokens, only when the provider reports them itself. */
  provider_tokens: z.number().nullable(),
});
export type Balance = z.infer<typeof BalanceSchema>;

export const AttemptStatus = z.enum(['RESERVED', 'CONFIRMED', 'REFUNDED', 'FAILED', 'UNKNOWN']);
export type AttemptStatus = z.infer<typeof AttemptStatus>;
export const AttemptOutcome = z.enum(['USED', 'REJECTED_BY_VALIDATION', 'REPLACED', 'DISCARDED', 'NO_OUTPUT']);
export type AttemptOutcome = z.infer<typeof AttemptOutcome>;

const AttemptSchema = z.object({
  attempt_id: z.string(),
  created_at: isoDateTime,
  creative_id: z.string(),
  creative_version: z.number().int(),
  study_title: z.string().transform(stagingLabel),
  /** AI_CREATE: a post made with AI. VALIDATION_ONLY: a paid AI fix of a client's own post. */
  workflow: z.enum(['AI_CREATE', 'VALIDATION_ONLY']),
  kind: z.enum(['image', 'video']),
  model: z.string(),
  model_label: z.string(),
  settings: z.object({
    resolution: z.string(),
    count: z.number().int(),
    duration_s: z.number().nullable(),
    audio: z.boolean(),
  }),
  status: AttemptStatus,
  /** What was expected before the request. */
  estimated: Money,
  /** What the provider billed; null until reconciled. */
  confirmed: Money.nullable(),
  /** Returned by the provider, when it refunded. */
  refunded: Money.nullable(),
  reconciled_at: isoDateTime.nullable(),
  outcome: AttemptOutcome,
  requested_by: z.string(),
});
export type Attempt = z.infer<typeof AttemptSchema> & Record<string, unknown>;

const AttemptPageSchema = z.object({
  items: z.array(AttemptSchema),
  next_cursor: z.string().nullable(),
  /** Totals for the whole filtered range, not only this page. */
  totals: z.object({
    attempts: z.number().int(),
    estimated: Money,
    reserved: Money,
    confirmed: Money,
    refunded: Money,
    /** Attempts whose billed amount is not known yet. */
    unknown: z.number().int(),
  }),
});
export type AttemptPage = z.infer<typeof AttemptPageSchema>;

/** Price of one model setting, per image or per second of video. */
const PriceSchema = z.object({
  model: z.string(),
  label: z.string(),
  kind: z.enum(['image', 'video']),
  resolution: z.string(),
  /** Per image, or per second of video. */
  unit_price: Money,
  /** Extra per second when audio is on (video only). */
  audio_unit_price: Money.nullable(),
  /** Video lengths the model accepts, in seconds. */
  durations_s: z.array(z.number()).nullable(),
});
export type Price = z.infer<typeof PriceSchema>;

const PriceListSchema = z.object({
  currency: z.literal('USD'),
  as_of: isoDateTime,
  items: z.array(PriceSchema),
});
export type PriceList = z.infer<typeof PriceListSchema>;

export interface AttemptFilter {
  from?: string;
  to?: string;
  model?: string;
  creative_id?: string;
  cursor?: string | null;
}

const qs = (f: AttemptFilter): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const usageApi = {
  balance: (signal?: AbortSignal): Promise<Balance> => http.get('/usage/balance', BalanceSchema, { signal }),
  attempts: (filter: AttemptFilter, signal?: AbortSignal): Promise<AttemptPage> =>
    http.get(`/usage/attempts${qs(filter)}`, AttemptPageSchema, { signal }),
  prices: (signal?: AbortSignal): Promise<PriceList> => http.get('/usage/prices', PriceListSchema, { signal }),
};

/* ---------- Exact money arithmetic ---------- */

const SCALE = 1_000_000n;

/** A decimal string as millionths of a dollar, exactly. */
export function toMicros(amount: string): bigint {
  const [whole, frac = ''] = amount.split('.');
  return BigInt(whole) * SCALE + BigInt((frac + '000000').slice(0, 6));
}

/** Millionths back to a decimal string with at least 2 places. */
export function fromMicros(micros: bigint): string {
  const neg = micros < 0n;
  const abs = neg ? -micros : micros;
  const whole = abs / SCALE;
  let frac = (abs % SCALE).toString().padStart(6, '0').replace(/0+$/, '');
  if (frac.length < 2) frac = frac.padEnd(2, '0');
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

export const sumMoney = (amounts: string[]): string => fromMicros(amounts.reduce((t, a) => t + toMicros(a), 0n));

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 });
/** "$0.04". Formats the exact decimal; never rounds a total that was summed exactly. */
export const fmtUsd = (amount: string): string => usd.format(Number(amount));
