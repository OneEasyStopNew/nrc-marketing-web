// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OBJECT_URL_REVOKE_DELAY_MS, saveFile } from './download';

describe('saveFile', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('downloads under the given name and frees the object URL only after the download has started', () => {
    vi.useFakeTimers();
    // jsdom has no object URLs.
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: vi.fn(() => 'blob:synthetic') });
    const revoke = vi.fn();
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revoke });
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
      clicked.push(`${this.download} ${this.href}`);
    });

    saveFile('synthetic.html', new Blob(['x'], { type: 'text/html' }));

    expect(clicked).toEqual(['synthetic.html blob:synthetic']);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(OBJECT_URL_REVOKE_DELAY_MS);
    expect(revoke).toHaveBeenCalledWith('blob:synthetic');
  });
});
