import { z } from 'zod';
import { http } from './http';
import * as S from './schemas.gen';

/**
 * GET /me and GET /context, as published by the backend (NRC-1 / NRC-2, see
 * docs/contracts/session.md). The wire shapes are converted here into the
 * models the screens use, so only this file knows the API's field names.
 * Responses are checked against the schemas in src/api/schemas.gen.ts,
 * generated from the backend's openapi.json, and the types come from them.
 */

/**
 * Capabilities the server grants within a tenant (e.g. "creative:write"). The
 * UI only uses them to show or hide; the API decides.
 */
export type Capability = S.Capability;

/* ---------- Models used by the screens ---------- */

export interface TenantMembership {
  tenant_id: string;
  name: string;
}

export interface Me {
  /** Cognito `sub`. */
  user_id: string;
  username: string;
  /** From the ID token (the access token carries no name or email). */
  display_name: string;
  email?: string;
  /** Tenants this user may work in. Empty = signed in but not given access to Marketing. */
  tenants: TenantMembership[];
}

/**
 * Approved, versioned facts about one study (StudySnapshotRead). Read-only in
 * Marketing; never edited or shortened. Closed studies stay readable as history.
 */
export type StudySnapshot = S.StudySnapshotRead;
/**
 * Values for a new post. The backend contract accepts only English, Facebook
 * and feed images today; the extra values are proposed so the UI (and the
 * simulation) can already offer a choice. The real API rejects them until it
 * adds them.
 */
export const LanguageOption = z.union([S.Language, z.literal('es')]);
export const ChannelOption = z.union([S.Channel, z.literal('instagram')]);
export type Language = z.infer<typeof LanguageOption>;
export type Channel = z.infer<typeof ChannelOption>;
export type PostFormatKind = S.PostFormat;
const PostFormatChoice = S.PostFormatOption.extend({ channel: ChannelOption });
export type PostFormat = z.infer<typeof PostFormatChoice>;

export interface MarketingContext {
  tenant: TenantMembership;
  /** Display labels, e.g. "Marketing creator". Never used for decisions. */
  roles: S.Role[];
  capabilities: Capability[];
  /** Studies this user may see in this tenant (recruiting and closed). Empty = none configured. */
  studies: StudySnapshot[];
  /** Language codes accepted for new drafts, e.g. ["en"]. */
  languages: Language[];
  post_formats: PostFormat[];
  /** The rule set validation uses in this tenant; null when it has none. */
  active_policy: S.PolicySummary | null;
}

/* ---------- Wire shapes ---------- */

/** ContextRead, with the proposed languages and channels allowed (see Language). */
const ContextWireSchema = S.ContextRead.extend({ languages: z.array(LanguageOption), post_formats: z.array(PostFormatChoice) });
export type MeWire = S.MeRead;
export type ContextWire = z.infer<typeof ContextWireSchema>;

/** Display details from the identity provider's ID token. */
export interface Profile {
  name?: string;
  email?: string;
}

/** Error codes the session flow must tell apart. */
export const SESSION_CODES = {
  /** /context: not a member of that tenant, or the role does not allow Marketing. */
  forbidden: 'FORBIDDEN',
} as const;

export const sessionApi = {
  me: async (profile: Profile, signal?: AbortSignal): Promise<Me> => {
    const w = await http.get('/me', S.MeRead, { signal });
    return {
      user_id: w.sub,
      username: w.username,
      display_name: profile.name || profile.email || w.username,
      email: profile.email,
      tenants: w.memberships.map((m) => ({ tenant_id: m.tenant_id, name: m.tenant_name })),
    };
  },

  /** The tenant travels in the X-Tenant-Id header set by setTenant(). */
  context: async (signal?: AbortSignal): Promise<MarketingContext> => {
    const w = await http.get('/context', ContextWireSchema, { signal });
    return {
      tenant: { tenant_id: w.tenant_id, name: w.tenant_name },
      roles: w.roles,
      capabilities: w.capabilities,
      studies: w.studies,
      languages: w.languages,
      post_formats: w.post_formats,
      active_policy: w.active_policy ?? null,
    };
  },
};
