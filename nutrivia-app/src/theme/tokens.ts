/**
 * Токены дизайн-системы Nutrivia (Claude Design → tokens.json).
 * Белый / чёрный / один зелёный. Значения менять только вместе с дизайн-системой.
 */
export const palette = {
  light: {
    bg: '#FFFFFF',
    surface: '#F4F5F3',
    surfaceRaised: '#FFFFFF',
    line: '#E6E9E6',
    ink: '#0B0D0C',
    onInk: '#FFFFFF',
    muted: '#6B716D',
    track: '#ECEEEB',
    green: '#1FA463',
    onGreen: '#0B0D0C',
    greenText: '#137A47',
    greenTint: '#E6F6EC',
    macroProtein: '#0B0D0C',
    macroCarbs: '#1FA463',
    macroFat: '#858C88',
    warning: '#B45309',
  },
  dark: {
    bg: '#0B0D0C',
    surface: '#171B19',
    surfaceRaised: '#1F2421',
    line: '#2A302D',
    ink: '#F4F6F5',
    onInk: '#0B0D0C',
    muted: '#9AA19D',
    track: '#262B28',
    green: '#3DDC84',
    onGreen: '#0B0D0C',
    greenText: '#5BE69A',
    greenTint: '#12301F',
    macroProtein: '#F4F6F5',
    macroCarbs: '#3DDC84',
    macroFat: '#7A827D',
    warning: '#F5A524',
  },
} as const;

export type Colors = { [K in keyof typeof palette.light]: string };

export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 32 } as const;
export const radius = { s: 12, m: 20, l: 28, full: 999 } as const;

export const font = {
  regular: 'Onest_400Regular',
  medium: 'Onest_500Medium',
  semibold: 'Onest_600SemiBold',
  bold: 'Onest_700Bold',
  extrabold: 'Onest_800ExtraBold',
} as const;

export const type = {
  numberXl: { fontFamily: font.extrabold, fontSize: 48, lineHeight: 52, letterSpacing: -1.4 },
  numberM: { fontFamily: font.bold, fontSize: 22, lineHeight: 26, letterSpacing: -0.4 },
  display: { fontFamily: font.extrabold, fontSize: 32, lineHeight: 38, letterSpacing: -0.6 },
  title: { fontFamily: font.bold, fontSize: 22, lineHeight: 28, letterSpacing: -0.2 },
  headline: { fontFamily: font.semibold, fontSize: 17, lineHeight: 24 },
  body: { fontFamily: font.regular, fontSize: 16, lineHeight: 24 },
  caption: { fontFamily: font.medium, fontSize: 13, lineHeight: 18 },
  label: { fontFamily: font.semibold, fontSize: 12, lineHeight: 16 },
} as const;

export type TypeVariant = keyof typeof type;
