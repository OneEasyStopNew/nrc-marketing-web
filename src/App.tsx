import { SIMULATION_BUILD } from '@/config/env';
import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { HOME_PATH } from '@/auth/returnTo';
import { NAV, type NavItem } from '@/config/nav';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageErrorBoundary } from '@/components/ErrorBoundary';
import { PageLoader } from '@/components/ui/Misc';
import { AuthWait } from '@/pages/auth/AuthFrame';
import SignIn from '@/pages/auth/SignIn';
import ChooseTenant from '@/pages/auth/ChooseTenant';
import { Blocked, Misconfigured, SessionFailed } from '@/pages/auth/SessionProblem';
import NoPermission from '@/pages/NoPermission';
import NotFound from '@/pages/NotFound';

const Home = lazy(() => import('@/pages/Home'));
const Section = lazy(() => import('@/pages/Section'));
const CreatePage = lazy(() => import('@/pages/create/CreatePage'));
const ValidationPage = lazy(() => import('@/pages/validation/ValidationPage'));
const MediaPage = lazy(() => import('@/pages/media/MediaPage'));
const RulesPage = lazy(() => import('@/pages/rules/RulesPage'));
const ApprovalsPage = lazy(() => import('@/pages/approvals/ApprovalsPage'));
const PublicationsPage = lazy(() => import('@/pages/publications/PublicationsPage'));
const AccountsPage = lazy(() => import('@/pages/accounts/AccountsPage'));
const TeamPage = lazy(() => import('@/pages/team/TeamPage'));

/** Sections whose page is built; the rest show the not-built-yet state until their ticket. */
const PAGES: Record<string, React.ComponentType> = {
  '/marketing/create': CreatePage,
  '/marketing/validation': ValidationPage,
  '/marketing/media': MediaPage,
  '/marketing/rules': RulesPage,
  '/marketing/approvals': ApprovalsPage,
  '/marketing/publications': PublicationsPage,
  '/marketing/integrations': AccountsPage,
  '/marketing/team': TeamPage,
};

/** Route-level check. Menu visibility is not authorization; the API decides, this keeps the UI honest. */
function Guarded({ item }: { item: NavItem }) {
  const { can } = useAuth();
  if (!can(item.capability)) return <NoPermission section={item.name} />;
  const Page = PAGES[item.href];
  return Page ? <Page /> : <Section item={item} />;
}

/** Simulation only: a page that fails while rendering, to test the error boundary. */
function SimCrash(): never {
  throw new Error('Simulated page crash');
}

export default function App() {
  const { status, mode } = useAuth();

  switch (status.kind) {
    case 'booting': return <AuthWait label="Checking your sign-in" />;
    case 'loading': return <AuthWait label="Opening Marketing" />;
    case 'misconfigured': return <Misconfigured message={status.message} />;
    case 'signed_out': return <SignIn reason={status.reason} />;
    case 'choose_tenant': return <ChooseTenant me={status.me} notice={status.notice} />;
    case 'blocked': return <Blocked reason={status.reason} />;
    case 'failed': return <SessionFailed message={status.message} requestId={status.requestId} retryable={status.retryable} />;
    case 'ready': break;
  }

  return (
    <AppLayout>
      <PageErrorBoundary>
      <Suspense fallback={<PageLoader label="Loading the page" />}>
        <Routes>
          <Route path="/" element={<Navigate to={HOME_PATH} replace />} />
          <Route path="/auth/callback" element={<Navigate to={HOME_PATH} replace />} />
          <Route path="/signed-out" element={<Navigate to={HOME_PATH} replace />} />
          <Route path={HOME_PATH} element={<Home />} />
          {NAV.map((item) => <Route key={item.href} path={`${item.href}/*`} element={<Guarded item={item} />} />)}
          {SIMULATION_BUILD && mode === 'simulation' && <Route path="/marketing/__sim/crash" element={<SimCrash />} />}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      </PageErrorBoundary>
    </AppLayout>
  );
}
