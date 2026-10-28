import Svg, { Circle, Path, Rect } from 'react-native-svg';

/** Линейные иконки 24px, линия 1.75 — до выбора набора иконок (см. дизайн-систему). */
export type IconName =
  | 'back' | 'close' | 'flash' | 'edit' | 'home' | 'people' | 'camera' | 'chart' | 'user'
  | 'plus' | 'minus' | 'search' | 'heart' | 'comment' | 'check' | 'clock' | 'image' | 'fridge';

export function Icon({ name, size = 24, color, fill = 'none', strokeWidth = 1.75 }: {
  name: IconName; size?: number; color: string; fill?: string; strokeWidth?: number;
}) {
  const p = { stroke: color, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  const shapes: Record<IconName, React.ReactNode> = {
    back: <Path d="M15 5l-7 7 7 7" {...p} />,
    close: <Path d="M6 6l12 12M18 6L6 18" {...p} />,
    flash: <Path d="M13 3L5 14h6l-1 7 8-11h-6z" {...p} />,
    edit: <><Path d="M4 20h4l10-10-4-4L4 16z" {...p} /><Path d="M13.5 6.5l4 4" {...p} /></>,
    home: <Path d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z" {...p} />,
    people: <><Circle cx="9" cy="9" r="3" {...p} /><Circle cx="17" cy="10" r="2.5" {...p} /><Path d="M3.5 19a5.5 5.5 0 0 1 11 0M14 19a4 4 0 0 1 7 0" {...p} /></>,
    camera: <><Path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" {...p} /><Circle cx="12" cy="13" r="3.5" {...p} /></>,
    chart: <Path d="M5 20V12M10 20V6M15 20v-9M20 20V9" {...p} />,
    user: <><Circle cx="12" cy="9" r="3.5" {...p} /><Path d="M5 20a7 7 0 0 1 14 0" {...p} /></>,
    plus: <Path d="M6 12h12M12 6v12" {...p} />,
    minus: <Path d="M6 12h12" {...p} />,
    search: <><Circle cx="11" cy="11" r="6" {...p} /><Path d="M20 20l-4.5-4.5" {...p} /></>,
    heart: <Path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" {...p} fill={fill} />,
    comment: <Path d="M5 18l1-3.5A7 7 0 1 1 9 18z" {...p} />,
    check: <Path d="M5 12.5l4.5 4.5L19 7.5" {...p} />,
    clock: <><Circle cx="12" cy="12" r="9" {...p} /><Path d="M12 7v5l3 2" {...p} /></>,
    image: <><Rect x="4" y="5" width="16" height="14" rx="2" {...p} /><Circle cx="9" cy="10" r="1.5" {...p} /><Path d="M20 16l-5-5-8 8" {...p} /></>,
    fridge: <><Rect x="6" y="3" width="12" height="18" rx="2" {...p} /><Path d="M6 10h12M9 6v2M9 13v3" {...p} /></>,
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no">
      {shapes[name]}
    </Svg>
  );
}
