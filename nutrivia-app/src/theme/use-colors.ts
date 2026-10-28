import { useColorScheme } from '@/hooks/use-color-scheme';

import { palette, type Colors } from './tokens';

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? palette.dark : palette.light;
}
