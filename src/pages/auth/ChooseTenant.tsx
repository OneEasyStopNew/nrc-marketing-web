import { useAuth } from '@/auth/AuthProvider';
import type { Me } from '@/api/session';
import { Button } from '@/components/ui/Button';
import { Alert, List, ListItem } from '@/components/ui/Misc';
import { VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { Icon } from '@/components/ui/Icon';
import { AuthFrame } from './AuthFrame';

/** Explicit organisation choice when the account belongs to more than one. */
export default function ChooseTenant({ me, notice }: { me: Me; notice?: string }) {
  const { chooseTenant, signOut, mode } = useAuth();
  return (
    <AuthFrame title="Choose an organisation" simulation={mode === 'simulation'}>
      <Text type="body" color="secondary" justify="center">Signed in as {me.display_name}. Work in one organisation at a time; switching clears what was loaded.</Text>
      {notice && <Alert tone="waiting">{notice}</Alert>}
      <List>
        {me.tenants.map((t) => (
          <ListItem key={t.tenant_id} onClick={() => chooseTenant(t.tenant_id)} chevron
            lead={<Icon name="globe" size={20} color="secondary" />} title={t.name} />
        ))}
      </List>
      <VStack hAlign="center"><Button variant="ghost" icon="logout" onClick={signOut}>Sign out</Button></VStack>
    </AuthFrame>
  );
}
