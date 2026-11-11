import { useEffect, useRef, type ReactNode } from 'react';
import { Card } from '@astryxdesign/core/Card';
import { Center } from '@astryxdesign/core/Center';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Icon } from '@/components/ui/Icon';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Misc';

/**
 * SignIn layout (design-system/components/SignIn.md): a 760px card split into a
 * 300px brand-dark slab and the content. On a phone the slab becomes a band
 * above. Used by every screen shown before the signed-in shell, so the user
 * never meets a blank page while the session resolves.
 */
export function AuthFrame({ title, children, simulation, below }: { title: string; children: ReactNode; simulation?: boolean; below?: ReactNode }) {
  const heading = useRef<HTMLDivElement>(null);
  // Move focus to the heading so screen readers announce the new state.
  useEffect(() => { heading.current?.focus(); }, [title]);
  useEffect(() => { document.title = `${title} · NRC Marketing`; }, [title]);

  return (
    <main>
      <Center axis="both" padding={6} minHeight="100dvh">
        <VStack gap={4} hAlign="center" width="100%" maxWidth={480}>
          <VStack gap={2} hAlign="center">
            <Icon name="mega" size={24} color="accent" />
            <Text type="body" weight="bold" size="lg">NRC Connect</Text>
            <Text type="supporting" color="secondary" justify="center">Marketing: create study posts, check them against the rules, and send them for review.</Text>
            {simulation && <Badge variant="waiting">Simulation sign-in</Badge>}
          </VStack>
          <Card padding={8} width="100%">
            <VStack gap={4} hAlign="stretch">
              <div ref={heading} tabIndex={-1}>
                <VStack hAlign="center"><Heading level={1}>{title}</Heading></VStack>
              </div>
              {children}
            </VStack>
          </Card>
          {below}
        </VStack>
      </Center>
    </main>
  );
}

/** Whole-screen wait that always says what it is waiting for. */
export function AuthWait({ label }: { label: string }) {
  useEffect(() => { document.title = 'NRC Marketing'; }, []);
  return (
    <main role="status" aria-live="polite">
      <Center axis="both" minHeight="100dvh">
        <HStack gap={3} vAlign="center">
          <Spinner size="lg" />
          <Heading level={1}>{label}</Heading>
        </HStack>
      </Center>
    </main>
  );
}
