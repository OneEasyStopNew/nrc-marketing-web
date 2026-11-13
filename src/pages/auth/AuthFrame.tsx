import { useEffect, useRef, type ReactNode, type ReactElement } from 'react';
import { Card } from '@astryxdesign/core/Card';
import { Center } from '@astryxdesign/core/Center';
import { VStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Badge } from '@/components/ui/Badge';
import { RingLoader } from '@/components/ui/RingLoader';
import { useTheme } from '@/context/ThemeContext';
import nrcLogo from '@/assets/nrc-logo.png';
import nrcLogoDark from '@/assets/nrc-logo-dark.png';

/**
 * SignIn layout (design-system/components/SignIn.md): a 760px card split into a
 * 300px brand-dark slab and the content. On a phone the slab becomes a band
 * above. Used by every screen shown before the signed-in shell, so the user
 * never meets a blank page while the session resolves.
 */
export function AuthFrame({ title, children, simulation, below }: { title: string; children: ReactNode; simulation?: boolean; below?: ReactNode }): ReactElement {
  const { resolved } = useTheme();
  const heading = useRef<HTMLDivElement>(null);
  // When the state changes (e.g. "Sign in" → "Signed out"), move focus to the heading so
  // screen readers announce it. Not on first load: the page is read from the top anyway,
  // and a focused heading shows a focus box around it.
  const firstTitle = useRef(title);
  useEffect(() => {
    if (title === firstTitle.current) return;
    firstTitle.current = title;
    heading.current?.focus();
  }, [title]);
  useEffect(() => { document.title = `${title} · NRC Marketing`; }, [title]);

  return (
    <main>
      <Center axis="both" padding={6} minHeight="100dvh">
        <VStack gap={4} hAlign="center" width="100%" maxWidth={480}>
          {simulation && <Badge variant="waiting">Simulation sign-in</Badge>}
          <Card padding={8} width="100%">
            <VStack gap={4} hAlign="stretch">
              {/* The NRC logo inside the card, light or dark to match the theme (same files as the top bar). */}
              <VStack hAlign="center">
                <img src={resolved === 'dark' ? nrcLogoDark : nrcLogo} alt="National Research Centers" width={160} height={72} />
              </VStack>
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
export function AuthWait({ label }: { label: string }): ReactElement {
  useEffect(() => { document.title = 'NRC Marketing'; }, []);
  return (
    // aria-busy: the page is still loading (the Astryx Spinner used to say this; the ring is decorative).
    <main role="status" aria-live="polite" aria-busy="true">
      <Center axis="both" minHeight="100dvh">
        <VStack gap={4} hAlign="center">
          <RingLoader />
          {/* Light text under the ring; still the page's one heading for screen readers. */}
          <Text as="h1" type="body" color="secondary" weight="normal">{label}</Text>
        </VStack>
      </Center>
    </main>
  );
}
