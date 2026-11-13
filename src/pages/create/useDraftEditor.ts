import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { creativesApi, fieldErrorsOf, newIdempotencyKey, textOf, type BriefText, type DraftSetup, type FieldErrors, type Versioned } from '@/api/creatives';
import { isApiError } from '@/api/errors';

/**
 * Editing one brief against the server's versioned draft.
 *
 * - Nothing is created until `create()` is called from an explicit action.
 *   The create carries an Idempotency-Key, reused when the same save is retried.
 * - After that, prompt and caption autosave after a pause, one request at a
 *   time, always with If-Match. Typed text is never dropped: a failed save
 *   keeps it, and a 412 opens a conflict instead of overwriting either side.
 */
export type SaveState =
  | { kind: 'unsaved' } //     new brief, no draft on the server yet
  | { kind: 'saved' }
  | { kind: 'dirty' } //       local edits waiting for autosave
  | { kind: 'saving' }
  | { kind: 'failed'; message: string; retryable: boolean; requestId?: string }
  | { kind: 'conflict'; server: Versioned }
  | { kind: 'readonly' }; //   closed study: history only

export const AUTOSAVE_MS = 1500;
const RETRY_MS = 3000;

export const sameText = (a: BriefText, b: BriefText): boolean => a.prompt === b.prompt && a.caption.trim() === b.caption.trim();

/** What the composer gets from useDraftEditor. */
export interface DraftEditor {
  /** The server's current draft, or null before the first create. */
  base: Versioned | null;
  /** The text on screen, saved or not. */
  text: BriefText;
  errors: FieldErrors;
  setErrors: (errors: FieldErrors) => void;
  state: SaveState;
  /** True when the text on screen differs from the server's current version. */
  dirty: boolean;
  setField: <K extends keyof BriefText>(key: K, value: BriefText[K]) => void;
  /** Saves now (autosave calls this too). */
  save: () => Promise<void>;
  /** Creates the draft from an explicit action; null when it did not happen. */
  create: (studyId: string, setup: DraftSetup) => Promise<Versioned | null>;
  /** Conflict: drop my edits and keep the other person's version. */
  takeServerVersion: () => void;
  /** Conflict: save my text as a new version on top of theirs. */
  saveMineOnTop: () => void;
}

export function useDraftEditor(opts: { initial: Versioned | null; readOnly?: boolean }): DraftEditor {
  const [base, setBase] = useState<Versioned | null>(opts.initial);
  const [text, setText] = useState<BriefText>(opts.initial ? textOf(opts.initial.creative) : { prompt: '', caption: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [state, setState] = useState<SaveState>(
    opts.readOnly ? { kind: 'readonly' } : opts.initial ? { kind: 'saved' } : { kind: 'unsaved' },
  );

  // Refs so timers and in-flight requests always see the latest values.
  const textRef = useRef(text);
  const baseRef = useRef(base);
  useLayoutEffect(() => { textRef.current = text; baseRef.current = base; }, [text, base]);
  const inFlight = useRef(false);
  const retried = useRef(false);
  /** The create attempt in progress: its payload and key, so a retry of the same payload reuses the key. */
  const createKey = useRef<{ payload: string; key: string } | null>(null);

  const dirty = base ? !sameText(text, textOf(base.creative)) : text.prompt.trim() !== '' || text.caption.trim() !== '';

  const setField = useCallback(<K extends keyof BriefText>(key: K, value: BriefText[K]) => {
    setText((t) => ({ ...t, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
    setState((s) => (s.kind === 'saved' || s.kind === 'failed' ? { kind: 'dirty' } : s));
  }, []);

  const handleError = useCallback(async (e: unknown, id?: string) => {
    if (isApiError(e)) {
      if (e.kind === 'stale' && id) {
        try {
          setState({ kind: 'conflict', server: await creativesApi.get(id) });
        } catch {
          setState({ kind: 'failed', message: 'Someone saved a newer version, and it could not be loaded. Try again.', retryable: true });
        }
        return;
      }
      if (e.kind === 'invalid') {
        setErrors(fieldErrorsOf(e));
        setState({ kind: 'failed', message: e.message, retryable: false, requestId: e.requestId });
        return;
      }
      if (e.code === 'STUDY_CLOSED') { setState({ kind: 'readonly' }); return; }
      setState({ kind: 'failed', message: e.message, retryable: e.retryable, requestId: e.requestId });
      return;
    }
    setState({ kind: 'failed', message: 'The draft could not be saved. Your text is still here.', retryable: true });
  }, []);

  /** Saves the current text as a new version. Safe to call repeatedly; one request runs at a time. */
  const save = useCallback(async () => {
    const current = baseRef.current;
    if (!current || inFlight.current) return;
    const sent = textRef.current;
    if (sameText(sent, textOf(current.creative))) { setState({ kind: 'saved' }); return; }
    inFlight.current = true;
    setState({ kind: 'saving' });
    try {
      const next = await creativesApi.update(current.creative.id, current.etag, sent);
      retried.current = false;
      setBase(next);
      baseRef.current = next;
      // Typing during the request leaves the new text dirty for the next autosave.
      setState(sameText(textRef.current, textOf(next.creative)) ? { kind: 'saved' } : { kind: 'dirty' });
    } catch (e) {
      await handleError(e, current.creative.id);
    } finally {
      inFlight.current = false;
    }
  }, [handleError]);

  /** Explicit "Create draft". Resolves to the new draft, or null when it failed (the text stays). */
  const create = useCallback(async (studyId: string, setup: DraftSetup) => {
    if (inFlight.current) return null;
    const body = { study_id: studyId, ...setup, ...textRef.current };
    const payload = JSON.stringify(body);
    if (createKey.current?.payload !== payload) createKey.current = { payload, key: newIdempotencyKey() };
    inFlight.current = true;
    setState({ kind: 'saving' });
    try {
      const created = await creativesApi.create(body, createKey.current.key);
      createKey.current = null;
      setBase(created);
      baseRef.current = created;
      setState({ kind: 'saved' });
      return created;
    } catch (e) {
      await handleError(e);
      return null;
    } finally {
      inFlight.current = false;
    }
  }, [handleError]);

  // Autosave after a pause in typing.
  useEffect(() => {
    if (state.kind !== 'dirty' || !base) return;
    const t = setTimeout(() => { void save(); }, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [text, state.kind, base, save]);

  // One automatic retry for a temporary failure; after that the user retries.
  useEffect(() => {
    if (state.kind !== 'failed' || !state.retryable || !base || retried.current) return;
    retried.current = true;
    const t = setTimeout(() => { void save(); }, RETRY_MS);
    return () => clearTimeout(t);
  }, [state, base, save]);

  /* Conflict choices. None of them drops text without the user asking. */

  const takeServerVersion = useCallback(() => {
    if (state.kind !== 'conflict') return;
    setBase(state.server);
    setText(textOf(state.server.creative));
    setErrors({});
    setState({ kind: 'saved' });
  }, [state]);

  const saveMineOnTop = useCallback(() => {
    if (state.kind !== 'conflict') return;
    setBase(state.server);
    baseRef.current = state.server;
    setState({ kind: 'dirty' });
    void save();
  }, [state, save]);

  return { base, text, errors, setErrors, state, dirty, setField, save, create, takeServerVersion, saveMineOnTop };
}
