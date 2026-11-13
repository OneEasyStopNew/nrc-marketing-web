import { useId, type ReactElement } from 'react';
import { Text } from '@astryxdesign/core/Text';

/**
 * Full-screen loading ring: a solid round head with a tail that fades out
 * behind it, turning clockwise. Drawn as two half-rings with linear gradients
 * (SVG has no conic gradient), in the theme's text colour (currentColor), so
 * it is dark on light and light on dark. Decorative: the label next to it
 * says what is happening. With reduced motion the ring stands still.
 */
export function RingLoader({ size = 64 }: { size?: number }): ReactElement {
  const id = useId().replace(/:/g, '');
  const still = typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const R = 40, W = 12, C = 50;
  const top = C - R, bottom = C + R;
  return (
    <Text color="primary" display="block">
      <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <defs>
          {/* Left half, just behind the head: from full to half strength. */}
          <linearGradient id={`${id}-l`} gradientUnits="userSpaceOnUse" x1={0} y1={top} x2={0} y2={bottom}>
            <stop offset="0" stopColor="currentColor" stopOpacity={1} />
            <stop offset="1" stopColor="currentColor" stopOpacity={0.55} />
          </linearGradient>
          {/* Right half, the end of the tail: from half strength to almost nothing. */}
          <linearGradient id={`${id}-r`} gradientUnits="userSpaceOnUse" x1={0} y1={bottom} x2={0} y2={top}>
            <stop offset="0" stopColor="currentColor" stopOpacity={0.55} />
            <stop offset="1" stopColor="currentColor" stopOpacity={0.04} />
          </linearGradient>
        </defs>
        <g>
          {/* The head is at the top; the tail runs anticlockwise from it, so turning clockwise it trails behind. */}
          <path d={`M${C} ${top} A${R} ${R} 0 0 0 ${C} ${bottom}`} fill="none" stroke={`url(#${id}-l)`} strokeWidth={W} />
          <path d={`M${C} ${bottom} A${R} ${R} 0 0 0 ${C} ${top}`} fill="none" stroke={`url(#${id}-r)`} strokeWidth={W} />
          <circle cx={C} cy={top} r={W / 2} fill="currentColor" />
          {!still && <animateTransform attributeName="transform" type="rotate" from={`0 ${C} ${C}`} to={`360 ${C} ${C}`} dur="1s" repeatCount="indefinite" />}
        </g>
      </svg>
    </Text>
  );
}
