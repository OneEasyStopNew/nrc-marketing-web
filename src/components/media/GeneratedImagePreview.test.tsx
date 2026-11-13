// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http as mock, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { configureHttp } from '@/api/http';
import { GeneratedImagePreview } from './GeneratedImagePreview';

/**
 * The preview against a fake API (MSW): the image loads lazily with its size reserved, a
 * placeholder covers the frame until the browser has drawn it, and a failed load still renews
 * the signed link once (imageRenewal.ts has the rules).
 */

const BASE = 'http://api.test/v1/marketing';
const ASSET_ID = 'sim-asset-0001';
const ALT = 'Generated image for the brief: a clinic waiting room';

vi.mock('@/auth/AuthProvider', () => ({ useSession: () => ({ context: { tenant: { tenant_id: 'tenant-1' } } }) }));

const asset = (link: string) => ({
  asset_id: ASSET_ID,
  creative_id: 'sim-cr-0001',
  origin: 'generated',
  mime_type: 'image/png',
  width_px: 1080,
  height_px: 1350,
  size_bytes: 2048,
  checksum_sha256: 'ab'.repeat(32),
  provider: 'higgsfield',
  model: 'soul',
  created_at: '2026-11-13T09:00:00Z',
  download_url: link,
  download_url_expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
});

let reads = 0;
const server = setupServer();

/** jsdom's AbortSignal is refused by Node's fetch; keep it out, as useDraftChecks.generation.test.tsx does. */
const fetchHonouringJsdomSignal: typeof fetch = (input, init) => {
  const { signal, ...rest } = init ?? {};
  return new Promise<Response>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason as Error);
    signal?.addEventListener('abort', () => reject(signal.reason as Error));
    fetch(input, rest).then(resolve, reject);
  });
};

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  configureHttp({ baseUrl: BASE, fetch: fetchHonouringJsdomSignal });
});
beforeEach(() => {
  reads = 0;
  server.use(
    mock.get(`${BASE}/assets/:id`, () => {
      reads++;
      return HttpResponse.json(asset(`https://media.example.test/${ASSET_ID}.png?sig=${reads}`));
    }),
  );
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

function renderPreview(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  render(<GeneratedImagePreview assetId={ASSET_ID} alt={ALT} ratio={1080 / 1350} />, { wrapper });
}

const placeholder = (): Element | null => document.querySelector('[data-loading]');

describe('GeneratedImagePreview', () => {
  it('loads the image lazily, with its size reserved so the layout does not move', async () => {
    renderPreview();
    const img = await screen.findByRole('img', { name: ALT });
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
    expect(img.getAttribute('width')).toBe('1080');
    expect(img.getAttribute('height')).toBe('1350');
  });

  it('shows a placeholder until the image has loaded, then the image alone', async () => {
    renderPreview();
    const img = await screen.findByRole('img', { name: ALT });
    expect(placeholder()).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Open full size' })).toBeNull();

    fireEvent.load(img);

    expect(placeholder()).toBeNull();
    expect(screen.getByRole('button', { name: 'Open full size' })).toBeTruthy();
  });

  it('still renews the signed link once when the image fails to load, with the placeholder back meanwhile', async () => {
    renderPreview();
    const first = await screen.findByRole('img', { name: ALT });
    expect(first.getAttribute('src')).toContain('sig=1');

    fireEvent.error(first);

    await waitFor(() => expect(screen.getByRole('img', { name: ALT }).getAttribute('src')).toContain('sig=2'));
    expect(reads).toBe(2);
    expect(placeholder()).not.toBeNull();
    expect(screen.getByRole('img', { name: ALT }).getAttribute('loading')).toBe('lazy');
  });
});
