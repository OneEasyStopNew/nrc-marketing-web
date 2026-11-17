// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PostPreview } from './parts';

/** The Preview card's image area: empty, generating a first image, generating a new one. */

afterEach(cleanup);

// The stored image itself is covered by its own component; here it only has to be there.
vi.mock('@/components/media/GeneratedImagePreview', () => ({
  GeneratedImagePreview: ({ alt }: { alt: string }) => <img alt={alt} src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" />,
}));

const EMPTY = 'The image is generated from the brief after it passes validation.';
const IMAGE = { assetId: '0a1b2c3d-1111-4aaa-8bbb-000000000001', alt: 'Generated image for the brief: a waiting room' };
const busyFrame = (text: string) => screen.getByText(text).closest('[aria-busy="true"]');

describe('PostPreview while an image is generated', () => {
  it('shows the empty frame text when nothing is being generated', () => {
    render(<PostPreview tenantName="NRC" caption="" />);
    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('replaces the empty frame with a busy placeholder and the step for a first image', () => {
    render(<PostPreview tenantName="NRC" caption="" generating="Step 3 of 5" />);
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(busyFrame('Generating image…')).toBeTruthy();
    expect(screen.getByText('Step 3 of 5')).toBeTruthy();
  });

  it('keeps the earlier image under a "Generating a new image" label until the new one arrives', () => {
    render(<PostPreview tenantName="NRC" caption="" image={IMAGE} generating="Step 2 of 5" />);
    const frame = busyFrame('Generating a new image…');
    expect(frame).toBeTruthy();
    expect(frame?.querySelector(`img[alt="${IMAGE.alt}"]`)).toBeTruthy();
  });

  it('shows the image alone once generation has ended', () => {
    render(<PostPreview tenantName="NRC" caption="" image={IMAGE} />);
    expect(screen.getByRole('img', { name: IMAGE.alt })).toBeTruthy();
    expect(screen.queryByText(/Generating/)).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });
});
