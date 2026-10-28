/** Даты и слова на русском. Неделя с понедельника (weekday 0), как на сервере. */
export const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WEEKDAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** «Вторник, 4 ноября» */
export function todayTitle(d = new Date()) {
  return `${WEEKDAYS[(d.getDay() + 6) % 7]}, ${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
}

/** «2026-11-04» → день месяца */
export function dayOfMonth(iso: string) {
  return Number(iso.slice(8, 10));
}

/** «29 октября — 4 ноября» */
export function rangeLabel(fromIso: string, toIso: string) {
  const f = (iso: string) => `${dayOfMonth(iso)} ${MONTHS_GEN[Number(iso.slice(5, 7)) - 1]}`;
  return `${f(fromIso)} — ${f(toIso)}`;
}

/** 1 день, 2 дня, 5 дней */
export function daysWord(n: number) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'день';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'дня';
  return 'дней';
}
