import { useEffect, useRef, type ReactElement } from 'react';
import { VStack } from '@astryxdesign/core/Layout';

/**
 * Looping Lottie animation for features still being developed: two gears
 * turning and a progress bar filling (src/assets/in-development.json, drawn
 * for this app). The player (lottie-web, light build: no expressions, no eval)
 * and the animation load only when this is shown. With reduced motion the
 * animation is shown standing still. Decorative: the words beside it carry
 * the meaning.
 */
export function InDevelopmentAnimation({ width = 240 }: { width?: number }): ReactElement {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stopped = false;
    let destroy: (() => void) | undefined;
    void Promise.all([import('lottie-web/build/player/lottie_light'), import('@/assets/in-development.json')])
      .then(([lottie, data]) => {
        if (stopped || !host.current) return;
        const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
        const anim = lottie.default.loadAnimation({
          container: host.current, renderer: 'svg', loop: !still, autoplay: !still, animationData: data.default,
          rendererSettings: { preserveAspectRatio: 'xMidYMid meet' },
        });
        if (still) anim.goToAndStop(60, true);
        destroy = () => anim.destroy();
      })
      .catch(() => { /* decorative: the page still says what it needs to without it */ });
    return () => { stopped = true; destroy?.(); };
  }, []);

  return <VStack ref={host} width={width} height={(width * 180) / 240} maxWidth="100%" aria-hidden="true" />;
}
