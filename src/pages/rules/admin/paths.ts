/** Addresses of the rulebook screens (NRC-20). Kept apart so linking to them does not load the screens. */
export const RULEBOOKS_PATH = '/marketing/rules/rulebooks';
export const rulebookHref = (id: string): string => `${RULEBOOKS_PATH}/${encodeURIComponent(id)}`;
export const SOURCES_PATH = '/marketing/rules/sources';
export const sourceHref = (id: string): string => `${SOURCES_PATH}/${encodeURIComponent(id)}`;
