import { useId, type SVGProps, type ReactElement } from 'react';
import { siFacebook, siInstagram } from 'simple-icons';
import { Icon as AxIcon } from '@astryxdesign/core/Icon';
import { HStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';

export type Platform = 'facebook' | 'instagram';

const NAME: Record<Platform, string> = { facebook: 'Facebook', instagram: 'Instagram' };

/**
 * The official platform marks (paths from Simple Icons, CC0), unaltered:
 * Facebook in its brand blue, the Instagram glyph in its brand gradient.
 * Never recolour, stretch or redraw them.
 */
function FacebookMark(props: SVGProps<SVGSVGElement>) {
  return <svg {...props} viewBox="0 0 24 24"><path d={siFacebook.path} fill={`#${siFacebook.hex}`} /></svg>;
}

function InstagramMark(props: SVGProps<SVGSVGElement>) {
  const id = useId();
  return (
    <svg {...props} viewBox="0 0 24 24">
      <defs>
        <linearGradient id={id} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#FFD600" />
          <stop offset="0.25" stopColor="#FF7A00" />
          <stop offset="0.5" stopColor="#FF0069" />
          <stop offset="0.75" stopColor="#D300C5" />
          <stop offset="1" stopColor="#7638FA" />
        </linearGradient>
      </defs>
      <path d={siInstagram.path} fill={`url(#${id})`} />
    </svg>
  );
}

const MARK = { facebook: FacebookMark, instagram: InstagramMark };

/** Which platform a label such as "Facebook · Feed image (1:1)" names, if any. */
export function platformOf(text: string | null | undefined): Platform | null {
  const t = (text ?? '').toLowerCase();
  return t.startsWith('facebook') ? 'facebook' : t.startsWith('instagram') ? 'instagram' : null;
}

/**
 * A platform's logo at an Astryx icon size. Pass `decorative` when the
 * platform's name is written right next to it, so it is not read twice.
 */
export function PlatformLogo({ platform, size = 20, decorative }: { platform: Platform; size?: 16 | 20 | 24; decorative?: boolean }): ReactElement {
  return <AxIcon icon={MARK[platform]} size={({ 16: 'sm', 20: 'md', 24: 'lg' } as const)[size]} label={decorative ? undefined : NAME[platform]} />;
}

/** "Facebook · Feed image (1:1)" with the Facebook logo in front; plain text when no platform is named. */
export function ChannelLabel({ text, supporting }: { text: string; supporting?: boolean }): ReactElement {
  const platform = platformOf(text);
  const label = <Text type={supporting ? 'supporting' : 'body'} color={supporting ? 'secondary' : 'primary'} wordBreak="break-word">{text}</Text>;
  if (!platform) return label;
  return (
    <HStack gap={2} vAlign="center">
      <PlatformLogo platform={platform} size={16} decorative />
      {label}
    </HStack>
  );
}
