import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { useToast as useAxToast } from '@astryxdesign/core/Toast';
import { ApiError } from '@/api/errors';

/**
 * Short confirmations and failures, shown as Astryx toasts. Blocked and
 * regulatory toasts stay until dismissed; the rest hide after a few seconds.
 * Toasts name codes, never participants or prompt text.
 */
export type ToastKind = 'done' | 'blocked' | 'waiting' | 'regulatory' | 'info';
type LegacyKind = 'success' | 'error' | 'warning';

interface ToastApi {
  toast: (title: string, kind?: ToastKind | LegacyKind, body?: ReactNode) => void;
  apiError: (e: unknown) => void;
}

const Ctx = createContext<ToastApi | null>(null);
const normalise = (k: ToastKind | LegacyKind): ToastKind => (k === 'success' ? 'done' : k === 'error' ? 'blocked' : k === 'warning' ? 'waiting' : k);

export function ToastProvider({ children }: { children: ReactNode }) {
  const ax = useAxToast();
  const toast = useCallback((title: string, kind: ToastKind | LegacyKind = 'done', body?: ReactNode) => {
    const k = normalise(kind);
    const sticky = k === 'blocked' || k === 'regulatory';
    ax({
      type: k === 'blocked' ? 'error' : 'info',
      isAutoHide: !sticky,
      autoHideDuration: 6000,
      body: (
        <VStack gap={0.5}>
          <Text type="body" weight="semibold" color="inherit">{title}</Text>
          {body && <Text type="supporting" color="inherit">{body}</Text>}
        </VStack>
      ),
    });
  }, [ax]);
  const apiError = useCallback((e: unknown) => {
    if (e instanceof ApiError) toast(e.message, 'blocked', e.requestId ? `Reference ${e.requestId}` : undefined);
    else toast('Something broke on our side', 'blocked', 'Nothing you entered was lost.');
  }, [toast]);
  const value = useMemo(() => ({ toast, apiError }), [toast, apiError]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useToast must be used within ToastProvider');
  return c;
}
