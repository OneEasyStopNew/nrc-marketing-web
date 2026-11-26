import { useId, type SVGProps, type ReactElement } from 'react';
import { siFacebook, siInstagram, siPinterest, siSnapchat, siThreads, siTiktok, siYoutube, type SimpleIcon } from 'simple-icons';
import { GlobeAltIcon } from '@heroicons/react/24/outline';
import { Icon as AxIcon, type IconType } from '@astryxdesign/core/Icon';
import { HStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';

export type Platform = 'facebook' | 'instagram' | 'threads' | 'tiktok' | 'linkedin' | 'youtube' | 'pinterest' | 'snapchat';

/** The networks' own names, as they write them. */
export const PLATFORM_NAME: Record<Platform, string> = {
  facebook: 'Facebook', instagram: 'Instagram', threads: 'Threads', tiktok: 'TikTok',
  linkedin: 'LinkedIn', youtube: 'YouTube', pinterest: 'Pinterest', snapchat: 'Snapchat',
};

/**
 * The official platform marks (paths from Simple Icons, CC0), unaltered:
 * each in its brand colour; the black marks (Threads, TikTok) follow the text
 * colour so they stay visible in dark mode, as their brand rules allow.
 * Never recolour, stretch or redraw them. Simple Icons has no LinkedIn mark,
 * so LinkedIn shows a neutral icon and its name, never a redrawn logo.
 */
const simple = (icon: SimpleIcon): IconType => function Mark(props: SVGProps<SVGSVGElement>) {
  return <svg {...props} viewBox="0 0 24 24"><path d={icon.path} fill={icon.hex === '000000' ? 'currentColor' : `#${icon.hex}`} /></svg>;
};

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

const MARK: Record<Platform, IconType> = {
  facebook: simple(siFacebook), instagram: InstagramMark, threads: simple(siThreads), tiktok: simple(siTiktok),
  linkedin: GlobeAltIcon, youtube: simple(siYoutube), pinterest: simple(siPinterest), snapchat: simple(siSnapchat),
};

/** Which platform a label such as "Facebook · Feed image (1:1)" names, if any. */
export function platformOf(text: string | null | undefined): Platform | null {
  const t = (text ?? '').toLowerCase();
  return (Object.keys(PLATFORM_NAME) as Platform[]).find((p) => t.startsWith(p)) ?? null;
}

/**
 * A platform's logo at an Astryx icon size. Pass `decorative` when the
 * platform's name is written right next to it, so it is not read twice.
 */
export function PlatformLogo({ platform, size = 20, decorative }: { platform: Platform; size?: 16 | 20 | 24; decorative?: boolean }): ReactElement {
  return <AxIcon icon={MARK[platform]} size={({ 16: 'sm', 20: 'md', 24: 'lg' } as const)[size]} label={decorative ? undefined : PLATFORM_NAME[platform]} />;
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
