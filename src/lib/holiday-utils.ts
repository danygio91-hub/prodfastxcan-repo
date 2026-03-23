import { format, isSameDay } from 'date-fns';

/**
 * Calculates Easter Sunday for a given year using the Meeus/Jones/Butcher algorithm.
 */
export function getEaster(year: number): Date {
  const f = Math.floor;
  const G = year % 19;
  const C = f(year / 100);
  const H = (C - f(C / 4) - f((8 * C + 13) / 25) + 19 * G + 15) % 30;
  const I = H - f(H / 28) * (1 - f(29 / (H + 1)) * f((21 - G) / 11));
  const J = (year + f(year / 4) + I + 2 - C + f(C / 4)) % 7;
  const L = I - J;
  const month = 3 + f((L + 40) / 44);
  const day = L + 28 - 31 * f(month / 4);
  return new Date(year, month - 1, day);
}

/**
 * Returns a list of Italian public holidays for a given year.
 */
export function getItalianHolidays(year: number): { date: string; name: string }[] {
  const easter = getEaster(year);
  const easterMonday = new Date(easter);
  easterMonday.setDate(easter.getDate() + 1);

  const holidays = [
    { date: `${year}-01-01`, name: 'Capodanno' },
    { date: `${year}-01-06`, name: 'Epifania' },
    { date: format(easter, 'yyyy-MM-dd'), name: 'Pasqua' },
    { date: format(easterMonday, 'yyyy-MM-dd'), name: 'Lunedì dell\'Angelo' },
    { date: `${year}-04-25`, name: 'Liberazione' },
    { date: `${year}-05-01`, name: 'Festa dei Lavoratori' },
    { date: `${year}-06-02`, name: 'Festa della Repubblica' },
    { date: `${year}-08-15`, name: 'Ferragosto' },
    { date: `${year}-11-01`, name: 'Ognissanti' },
    { date: `${year}-12-08`, name: 'Immacolata Concezione' },
    { date: `${year}-12-25`, name: 'Natale' },
    { date: `${year}-12-26`, name: 'Santo Stefano' },
  ];

  return holidays;
}

/**
 * Checks if a given date is an Italian public holiday.
 */
export function isItalianHoliday(date: Date): { isHoliday: boolean; name?: string } {
  const year = date.getFullYear();
  const holidays = getItalianHolidays(year);
  const dateStr = format(date, 'yyyy-MM-dd');
  
  const holiday = holidays.find(h => h.date === dateStr);
  return {
    isHoliday: !!holiday,
    name: holiday?.name
  };
}
