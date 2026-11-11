import type { ComponentProps } from 'react';
import { Icon as AxIcon, type IconType } from '@astryxdesign/core/Icon';
import {
  ArrowDownTrayIcon, ArrowPathIcon, ArrowRightStartOnRectangleIcon, ArrowUpTrayIcon, ArrowsUpDownIcon, AdjustmentsHorizontalIcon,
  Bars3Icon, BellIcon, CalendarIcon, ChartBarIcon, ChatBubbleLeftIcon, CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ChevronUpIcon,
  ClockIcon, CodeBracketIcon, Cog6ToothIcon, CurrencyDollarIcon, DocumentDuplicateIcon, DocumentTextIcon, EllipsisHorizontalIcon, EnvelopeIcon,
  ExclamationTriangleIcon, EyeIcon, FlagIcon, FunnelIcon, GlobeAltIcon, HomeIcon, InformationCircleIcon, KeyIcon, LinkIcon, LockClosedIcon,
  MagnifyingGlassIcon, MapPinIcon, MegaphoneIcon, PaperAirplaneIcon, PaperClipIcon, PencilIcon, PhoneIcon, PhotoIcon, PlayIcon, PlusIcon,
  ShieldCheckIcon, SparklesIcon, StarIcon, TrashIcon, UserIcon, UsersIcon, VideoCameraIcon, XMarkIcon,
} from '@heroicons/react/24/outline';

/**
 * Icons: Heroicons (the set the Astryx templates use), drawn by the Astryx
 * Icon component. Code keeps the short names the app already uses.
 */
const ICONS = {
  check: CheckIcon, x: XMarkIcon, chev: ChevronDownIcon, 'chev-right': ChevronRightIcon, 'chev-left': ChevronLeftIcon, 'chev-up': ChevronUpIcon,
  plus: PlusIcon, search: MagnifyingGlassIcon, info: InformationCircleIcon, warn: ExclamationTriangleIcon, shield: ShieldCheckIcon, lock: LockClosedIcon,
  bell: BellIcon, cal: CalendarIcon, user: UserIcon, users: UsersIcon, home: HomeIcon, chart: ChartBarIcon, mega: MegaphoneIcon, dollar: CurrencyDollarIcon,
  clip: PaperClipIcon, gear: Cog6ToothIcon, more: EllipsisHorizontalIcon, dl: ArrowDownTrayIcon, up: ArrowUpTrayIcon, mail: EnvelopeIcon, phone: PhoneIcon,
  msg: ChatBubbleLeftIcon, eye: EyeIcon, edit: PencilIcon, trash: TrashIcon, clock: ClockIcon, spark: SparklesIcon, img: PhotoIcon, code: CodeBracketIcon,
  video: VideoCameraIcon, play: PlayIcon, pin: MapPinIcon, flag: FlagIcon, send: PaperAirplaneIcon, copy: DocumentDuplicateIcon, filter: FunnelIcon,
  sort: ArrowsUpDownIcon, refresh: ArrowPathIcon, globe: GlobeAltIcon, key: KeyIcon, sliders: AdjustmentsHorizontalIcon, wand: SparklesIcon,
  doc: DocumentTextIcon, menu: Bars3Icon, star: StarIcon, link: LinkIcon, logout: ArrowRightStartOnRectangleIcon,
} satisfies Record<string, IconType>;

export type IconName = keyof typeof ICONS;
export type IconColor = ComponentProps<typeof AxIcon>['color'];

const SIZE = { 16: 'sm', 20: 'md', 22: 'md', 24: 'lg' } as const;

export function Icon({ name, size = 16, color, title }: { name: IconName; size?: 16 | 20 | 22 | 24; color?: IconColor; title?: string }) {
  return <AxIcon icon={ICONS[name]} size={SIZE[size]} color={color} label={title} />;
}

/** The icon component itself, for Astryx slots that take one (SideNavItem, DropdownMenuItem). */
export function iconComponent(name: IconName): IconType {
  return ICONS[name];
}
