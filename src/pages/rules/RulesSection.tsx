import { lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import NoPermission from '@/pages/NoPermission';
import NotFound from '@/pages/NotFound';
import ActivePolicyPage from './ActivePolicyPage';

const RulesPage = lazy(() => import('./RulesPage'));

/**
 * The Rules section. For the 13 Nov demo (NRC-20) the section opens on the
 * read-only active policy (GET /policies/active, creative:read).
 *
 * The rule administration page (RulesPage: draft, edit, activate) depends on
 * the proposed /rules endpoints, which the backend does not provide yet. It is
 * kept unchanged under /marketing/rules/manage for policy administrators, with
 * no link from the menu or the viewer, until rule administration is built.
 */
export default function RulesSection() {
  const { can } = useAuth();
  return (
    <Routes>
      <Route index element={<ActivePolicyPage />} />
      <Route path="manage" element={can('policy:manage') ? <RulesPage /> : <NoPermission section="Rule administration" />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
