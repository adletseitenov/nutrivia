import words from './words.json';

export const FPS = 30;
export const f = (sec: number) => Math.round(sec * FPS);

/** Когда начинается каждая реплика (с). «Нутривию» в s03 попадает ровно на сброс музыки 19.9 с. */
export const VO: Record<string, number> = {
  s01_hook: 1.0,
  s02_problem: 5.7,
  s03_intro: 19.34,
  s04_photo: 22.6,
  s05_advice: 31.7,
  s06_streak: 39.0,
  s07_trainer: 44.3,
  s08_business: 51.9,
  s09_end: 58.6,
};
export const DROP = 19.9;
export const TOTAL = 68;

type W = {dur: number; words: [string, number, number][]};
const all = words as unknown as Record<string, W>;

/** Глобальное время (с), когда в реплике звучит слово, начинающееся на `prefix` (n-е вхождение). */
export function wordAt(line: string, prefix: string, n = 0): number {
  const ws = all[line].words;
  let k = 0;
  for (const [w, s] of ws) {
    if (w.toLowerCase().replace(/[^а-яёa-z0-9]/g, '').startsWith(prefix.toLowerCase())) {
      if (k === n) return VO[line] + s;
      k++;
    }
  }
  throw new Error(`нет слова ${prefix} в ${line}`);
}
export const voEnd = (line: string) => VO[line] + all[line].dur;

/** Сцены: [начало, конец] в секундах */
export const SCENES = {
  hook: [0, 5.7],
  problem: [5.7, 16.9],
  tension: [16.9, 19.9],
  reveal: [19.9, 22.5],
  photo: [22.5, 31.6],
  advice: [31.6, 38.9],
  streak: [38.9, 44.1],
  trainer: [44.1, 51.9],
  business: [51.9, 58.4],
  end: [58.4, TOTAL],
} as const;
