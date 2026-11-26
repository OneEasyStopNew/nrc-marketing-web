import type { MediaItem } from '@/api/assets';

/**
 * How a media item is named and where it leads. A generated image belongs to
 * a draft version; an uploaded file may belong to no draft (creative_id null),
 * and then has its own file name.
 */

const shortId = (id: string): string => id.slice(0, 8);

const draftWords = (m: MediaItem, separator: string): string | null =>
  m.creative_id == null
    ? null
    : `Draft ${shortId(m.creative_id)}${m.creative_version != null ? `${separator}version ${m.creative_version}` : ''}`;

/** A readable name: the draft it was made for, else the file's own name, else its id. */
export const mediaName = (m: MediaItem): string =>
  draftWords(m, ' · ') ?? (m.name?.trim() || `File ${shortId(m.asset_id)}`);

/** The draft's page, or null when the file belongs to no draft. */
export const mediaDraftHref = (m: MediaItem): string | null =>
  m.creative_id == null ? null : `/marketing/create/${encodeURIComponent(m.creative_id)}`;

/** Where the file came from, for the details panel. */
export const mediaSource = (m: MediaItem): string => draftWords(m, ', ') ?? 'Not attached to a draft';
