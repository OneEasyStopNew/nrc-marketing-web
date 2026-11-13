/**
 * How long a downloaded file's object URL stays valid. Some browsers start
 * reading the blob only after the click returns, so revoking it in the same
 * tick can produce an empty or failed download.
 */
export const OBJECT_URL_REVOKE_DELAY_MS = 10_000;

/** Saves a blob through a temporary link, then frees the object URL once the download has started. */
export function saveFile(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_REVOKE_DELAY_MS);
}
