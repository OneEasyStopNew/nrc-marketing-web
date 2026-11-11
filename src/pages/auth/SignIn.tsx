import { useEffect, useState, type ReactNode } from 'react';
import { useAuth, type SignedOutReason } from '@/auth/AuthProvider';
import { SIMULATION_BUILD } from '@/config/env';
import { Button } from '@/components/ui/Button';
import { Alert, List, ListItem } from '@/components/ui/Misc';
import { Card } from '@astryxdesign/core/Card';
import { VStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Icon } from '@/components/ui/Icon';
import { AuthFrame } from './AuthFrame';

type SimIdentity = { id: string; label: string; sub: string };

/**
 * Dummy identities from the local, git-ignored src/mocks/data.ts, loaded only
 * in simulation mode. `missing` = the file is not there (e.g. a fresh clone).
 */
function useSimIdentities(on: boolean) {
  const [state, setState] = useState<{ list: SimIdentity[]; missing: boolean }>({ list: [], missing: false });
  useEffect(() => {
    if (!on || !SIMULATION_BUILD) return;
    void import('@/mocks/load').then(async (m) => {
      const data = await m.loadMockData();
      setState(data ? { list: data.USERS, missing: false } : { list: [], missing: true });
    });
  }, [on]);
  return state;
}

/** What happened, in plain words, for each way a user reaches this screen. */
const REASON: Record<Exclude<SignedOutReason, 'none'>, { tone: 'info' | 'waiting' | 'blocked'; text: string }> = {
  signed_out: { tone: 'info', text: 'You are signed out. Nothing from your session is kept in this browser.' },
  expired: { tone: 'waiting', text: 'Your session ended. Sign in again to continue where you were.' },
  cancelled: { tone: 'waiting', text: 'Sign-in was cancelled or not allowed. Try again, or ask your administrator for access.' },
  consent: { tone: 'blocked', text: 'The sign-in page needs you to confirm access. Sign in again and accept the request.' },
  expired_link: { tone: 'waiting', text: 'That sign-in link was already used or has expired. Start again.' },
  failed: { tone: 'blocked', text: 'Sign-in did not complete. Try again. If it keeps failing, contact support.' },
};

export default function SignIn({ reason }: { reason: SignedOutReason }) {
  const { signIn, mode } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const { list: identities, missing } = useSimIdentities(mode === 'simulation');
  const r = reason === 'none' ? null : REASON[reason];
  const go = (identity?: string) => { setBusy(identity ?? 'cognito'); signIn({ identity }); };

  let content: ReactNode;
  if (mode === 'simulation') {
    content = (
      <>
        <Text type="supporting" color="secondary">Pick a fixture identity. These are not real accounts and nothing here counts as live evidence.</Text>
        {missing && <Alert tone="blocked">No local dummy data. Create <Text type="code">src/mocks/data.ts</Text> (shape in <Text type="code">src/mocks/types.ts</Text>), or switch to Cognito sign-in.</Alert>}
        {r && <Alert tone={r.tone}>{r.text}</Alert>}
      </>
    );
  } else {
    content = (
      <>
        <Text type="body" color="secondary" justify="center">Use your NRC account. Passwords, two-step sign-in and password resets are handled on the NRC sign-in page.</Text>
        {r && <Alert tone={r.tone}>{r.text}</Alert>}
        <Button variant="primary" size="lg" block loading={busy === 'cognito'} onClick={() => go()}>Continue to sign in</Button>
      </>
    );
  }

  return (
    <AuthFrame
      title={reason === 'signed_out' ? 'Signed out' : 'Sign in'}
      simulation={mode === 'simulation'}
      below={mode === 'simulation' && (
        <Card padding={6} width="100%">
          <VStack gap={3}>
            <Heading level={2}>Simulation identities</Heading>
            <List>
            {identities.map((u) => (
              <ListItem key={u.id} onClick={busy ? undefined : () => go(u.id)} chevron
                lead={<Icon name="user" size={20} color="secondary" />}
                title={u.label} sub={u.sub} />
            ))}
            </List>
          </VStack>
        </Card>
      )}
    >
      {content}
    </AuthFrame>
  );
}
