import {loadFont} from '@remotion/fonts';
import {staticFile} from 'remotion';

export const FONT = 'Onest';
const weights: [string, string][] = [['500', 'Medium'], ['700', 'Bold'], ['800', 'ExtraBold'], ['900', 'Black']];
export const fontsReady = Promise.all(
  weights.map(([w, n]) => loadFont({family: FONT, url: staticFile(`media/fonts/Onest_${w}${n}.ttf`), weight: w})),
);
