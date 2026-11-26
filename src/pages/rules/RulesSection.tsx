import { lazy, type ReactElement } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import NoPermission from '@/pages/NoPermission';
import NotFound from '@/pages/NotFound';
import ActivePolicyPage from './ActivePolicyPage';
import { useCanReadRulebooks } from './admin/useRulebooks';

const RulesPage = lazy(() => import('./RulesPage'));
const RulebooksPage = lazy(() => import('./admin/RulebooksPage'));
const RulebookPage = lazy(() => import('./admin/RulebookPage'));
const SourcesPage = lazy(() => import('./admin/SourcesPage'));
const SourcePage = lazy(() => import('./admin/SourcePage'));

/**
 * The Rules section. It opens on the read-only active policy (GET
 * /policies/active, creative:read).
 *
 * Rulebooks (NRC-20 on Firoz's NRC-4 endpoints, /policy-bundles): every policy
 * version, its rules, checks and history, for policy administrators, owners
 * and activators only. A deep link from any other role shows "no permission",
 * and the API refuses it anyway.
 *
 * The older rule administration page (RulesPage) depends on the proposed
 * /rules endpoints, which the backend does not provide. It stays under
 * /marketing/rules/manage until the rulebook screens replace it.
 */
export default function RulesSection(): ReactElement {
  const { can } = useAuth();
  const rulebooks = useCanReadRulebooks();
  return (
    <Routes>
      <Route index element={<ActivePolicyPage />} />
      <Route path="rulebooks" element={rulebooks ? <RulebooksPage /> : <NoPermission section="Rulebooks" />} />
      <Route path="rulebooks/:bundleId" element={rulebooks ? <RulebookPage /> : <NoPermission section="Rulebooks" />} />
      <Route path="sources" element={rulebooks ? <SourcesPage /> : <NoPermission section="Policy files" />} />
      <Route path="sources/:sourceId" element={rulebooks ? <SourcePage /> : <NoPermission section="Policy files" />} />
      <Route path="manage" element={can('policy:manage') ? <RulesPage /> : <NoPermission section="Rule administration" />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
