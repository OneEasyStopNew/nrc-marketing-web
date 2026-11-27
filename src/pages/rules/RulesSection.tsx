import { lazy, type ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import NoPermission from '@/pages/NoPermission';
import NotFound from '@/pages/NotFound';
import ActivePolicyPage from './ActivePolicyPage';
import { RULEBOOKS_PATH } from './admin/paths';
import { useCanReadRulebooks } from './admin/useRulebooks';

const RulebooksPage = lazy(() => import('./admin/RulebooksPage'));
const RulebookPage = lazy(() => import('./admin/RulebookPage'));
const SourcesPage = lazy(() => import('./admin/SourcesPage'));
const SourcePage = lazy(() => import('./admin/SourcePage'));

/**
 * The Rules section. It opens on the read-only active policy (GET
 * /policies/active, creative:read).
 *
 * Rulebooks (NRC-20 on Firoz's NRC-4 endpoints, /policy-bundles): every policy
 * version, its rules, checks and history, and the policy files, for policy
 * administrators, owners and activators only. A deep link from any other role
 * shows "no permission", and the API refuses it anyway.
 *
 * /marketing/rules/manage was the older rule screen on the proposed /rules
 * endpoints, which the backend never built; Rulebooks replaced it. Old links
 * to it open Rulebooks.
 */
export default function RulesSection(): ReactElement {
  const rulebooks = useCanReadRulebooks();
  return (
    <Routes>
      <Route index element={<ActivePolicyPage />} />
      <Route path="rulebooks" element={rulebooks ? <RulebooksPage /> : <NoPermission section="Rulebooks" />} />
      <Route path="rulebooks/:bundleId" element={rulebooks ? <RulebookPage /> : <NoPermission section="Rulebooks" />} />
      <Route path="sources" element={rulebooks ? <SourcesPage /> : <NoPermission section="Policy files" />} />
      <Route path="sources/:sourceId" element={rulebooks ? <SourcePage /> : <NoPermission section="Policy files" />} />
      <Route path="manage" element={<Navigate to={RULEBOOKS_PATH} replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
