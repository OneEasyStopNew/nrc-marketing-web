import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Misc';

interface State { error: Error | null; reference: string | null }

/**
 * Catches a crash in one page so the shell (menu, account, sign-out) keeps
 * working. Shows a short reference instead of the error text, which could
 * contain user content. Resets when the user goes to another page.
 */
class Boundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, reference: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, reference: `ui-${Date.now().toString(36)}` };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Development aid only. No prompt text, tokens or signed links are sent anywhere.
    if (import.meta.env.DEV) console.error('Page error', this.state.reference, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert">
        <EmptyState icon="warn" title="This page stopped working"
          description={`Your saved work is safe. Reload the page to try again. If it happens again, quote reference ${this.state.reference}.`}
          action={<Button variant="secondary" size="sm" icon="refresh" onClick={() => window.location.reload()}>Reload the page</Button>} />
      </div>
    );
  }
}

/** One boundary per address: moving to another page clears the error. */
export function PageErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <Boundary key={pathname}>{children}</Boundary>;
}

/** Last resort for a crash outside any page (the router's errorElement). */
export function AppCrash() {
  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 560, margin: '64px auto' }}>
      <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>NRC Marketing stopped working</h1>
      <p style={{ margin: '0 0 16px' }}>Your saved work is safe. Reload the page to continue.</p>
      <button type="button" onClick={() => window.location.reload()} style={{ padding: '8px 14px', cursor: 'pointer' }}>Reload</button>
    </main>
  );
}
