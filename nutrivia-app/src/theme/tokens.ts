/**
 * Токены дизайн-системы Nutrivia (Claude Design → tokens.json).
 * Чёрный / белый / фиолетовый акцент, синий — второй цвет (углеводы, графики). Пожелание фаундера 02.11.
 * Значения менять только вместе с дизайн-системой.
 */
export const palette = {
  light: {
    bg: '#FFFFFF',
    surface: '#F5F4F9',
    surfaceRaised: '#FFFFFF',
    line: '#E8E6F0',
    ink: '#0E0C16',
    onInk: '#FFFFFF',
    muted: '#6E6A7C',
    track: '#ECEAF3',
    accent: '#6B4EFF',
    onAccent: '#FFFFFF',
    accentText: '#5135E0',
    accentTint: '#F0ECFF',
    blue: '#2E6BFF',
    macroProtein: '#0E0C16',
    macroCarbs: '#2E6BFF',
    macroFat: '#A29BB8',
    warning: '#B45309',
  },
  dark: {
    bg: '#0C0B12',
    surface: '#17151F',
    surfaceRaised: '#201D2B',
    line: '#2C2838',
    ink: '#F5F3FB',
    onInk: '#0C0B12',
    muted: '#A19DB0',
    track: '#25222F',
    accent: '#8F7BFF',
    onAccent: '#0C0B12',
    accentText: '#ADA0FF',
    accentTint: '#221B45',
    blue: '#6F9BFF',
    macroProtein: '#F5F3FB',
    macroCarbs: '#6F9BFF',
    macroFat: '#7F7A90',
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
