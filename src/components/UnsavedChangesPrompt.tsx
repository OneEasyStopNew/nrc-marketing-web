import { useEffect, useRef } from 'react';
import { Text } from '@astryxdesign/core/Text';
import { useBlocker } from 'react-router-dom';
import { Modal } from '@/components/ui/Overlay';
import { Button } from '@/components/ui/Button';

/**
 * Warns before leaving a page with unsaved work: in-app links, the back button
 * (Modal) and closing or reloading the tab (the browser's own prompt).
 * `when` is read at navigation time, so a page can clear it and navigate in
 * the same handler (e.g. after "Create draft" succeeds).
 */
export function UnsavedChangesPrompt({ when, message }: { when: boolean; message: string }) {
  const active = useRef(when);
  active.current = when;

  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    active.current && currentLocation.pathname !== nextLocation.pathname);

  useEffect(() => {
    if (!when) return;
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [when]);

  const stay = () => blocker.reset?.();
  return (
    <Modal open={blocker.state === 'blocked'} onClose={stay} title="Leave without saving?" icon="warn"
      footer={(
        <>
          <Button variant="ghost" onClick={stay}>Stay on this page</Button>
          <Button variant="danger" onClick={() => blocker.proceed?.()}>Leave and discard</Button>
        </>
      )}>
      <Text type="body" wordBreak="break-word">{message}</Text>
    </Modal>
  );
}
