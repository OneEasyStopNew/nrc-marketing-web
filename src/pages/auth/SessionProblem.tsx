import { useAuth, type BlockedReason } from '@/auth/AuthProvider';
import { Text } from '@astryxdesign/core/Text';
import { HStack } from '@astryxdesign/core/Layout';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Misc';
import { AuthFrame } from './AuthFrame';

const BLOCKED: Record<BlockedReason, { title: string; text: string }> = {
  disabled: {
    title: 'Account disabled',
    text: 'This NRC account is disabled, so Marketing cannot open. Ask your administrator to re-enable it.',
  },
  no_access: {
    title: 'No access to Marketing',
    text: 'You are signed in, but your account is not a member of any Marketing organisation. Ask your administrator for access.',
  },
  mfa_required: {
    title: 'Two-step sign-in required',
    text: 'Marketing needs two-step sign-in. Set it up on the NRC sign-in page, then sign in again.',
  },
};

/** Signed in, but the server will not open Marketing for this account. */
export function Blocked({ reason }: { reason: BlockedReason }) {
  const { signOut, signIn, mode } = useAuth();
  const b = BLOCKED[reason];
  return (
    <AuthFrame title={b.title} simulation={mode === 'simulation'}>
      <Alert tone="blocked">{b.text}</Alert>
      <HStack gap={2} vAlign="center" wrap="wrap">
        {reason === 'mfa_required'
          ? <Button variant="primary" onClick={() => signIn({ forceLogin: true })}>Sign in again</Button>
          : null}
        <Button variant={reason === 'mfa_required' ? 'ghost' : 'secondary'} icon="logout" onClick={signOut}>Sign out</Button>
      </HStack>
    </AuthFrame>
  );
}

/** Network loss or a server failure while opening the session. Nothing was changed; retry is safe. */
export function SessionFailed({ message, requestId, retryable }: { message: string; requestId?: string; retryable: boolean }) {
  const { retry, signOut, mode } = useAuth();
  return (
    <AuthFrame title="Marketing did not open" simulation={mode === 'simulation'}>
      <Alert tone="blocked">{message}</Alert>
      {requestId && <Text type="supporting" color="secondary">Reference for support: <Text type="code">{requestId}</Text></Text>}
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Button variant={retryable ? 'primary' : 'secondary'} icon="refresh" onClick={retry}>Try again</Button>
        <Button variant="ghost" icon="logout" onClick={signOut}>Sign out</Button>
      </HStack>
    </AuthFrame>
  );
}

/** The build is not configured for sign-in. Shown instead of a blank page. */
export function Misconfigured({ message }: { message: string }) {
  return (
    <AuthFrame title="Sign-in is not set up">
      <Alert tone="blocked">{message}</Alert>
      <Text type="supporting" color="secondary">
        {import.meta.env.DEV
          ? <>Local development: set the values in <Text type="code">.env.local</Text> (see <Text type="code">.env.example</Text>), or use <Text type="code">VITE_AUTH_MODE=simulation</Text> for dummy data. Restart <Text type="code">npm run dev</Text> afterwards.</>
          : 'This is a deployment setting, not something you can fix from here. Tell the Marketing team.'}
      </Text>
    </AuthFrame>
  );
}
