import { addWorkingMinutes, subtractWorkingMinutes } from './src/lib/calendar-utils';
import { format } from 'date-fns';

const date = new Date('2026-03-22T12:00:00'); // Sunday
const earlier = subtractWorkingMinutes(date, 60); // Expected: Friday 16:00
console.log('Start (Sun 12:00):', format(date, 'yyyy-MM-dd HH:mm'));
console.log('-60 mins:', format(earlier, 'yyyy-MM-dd HH:mm'));

const fridayEnd = new Date('2026-03-20T17:00:00'); // Friday
const fridayEarlier = subtractWorkingMinutes(fridayEnd, 120); // Expected: Friday 15:00
console.log('Start (Fri 17:00):', format(fridayEnd, 'yyyy-MM-dd HH:mm'));
console.log('-120 mins:', format(fridayEarlier, 'yyyy-MM-dd HH:mm'));

const wednesday = new Date('2026-03-18T13:30:00'); // Wednesday 13:30
const wedEarlier = subtractWorkingMinutes(wednesday, 120); // Expected: Wednesday 10:30 (crosses lunch 12:00-13:00)
console.log('Start (Wed 13:30):', format(wednesday, 'yyyy-MM-dd HH:mm'));
console.log('-120 mins:', format(wedEarlier, 'yyyy-MM-dd HH:mm'));
