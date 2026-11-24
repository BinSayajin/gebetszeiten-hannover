const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeFaziletDays, fetchFaziletDays } = require('../src/fazilet.cjs');
const { shiftDay, widgetState } = require('../src/schedule.cjs');

const rows = [
  ['Imsak', 'imsak', '05:30'], ['Fedschr-Gebet', 'fajr', '05:50'],
  ['Sonnenaufgang', 'shuruq', '07:20'], ['Zuhr', 'thuhr', '12:10'],
  ['Asr', 'asr', '14:10'], ['Maghrib', 'maghrib', '16:45'], ['&rsquo;Isch&acirc;', 'isha', '18:30'],
];
const autumnChange = [
  { date: '2026-10-24', offset: '+02:00' },
  { date: '2026-10-25', offset: '+01:00' },
  { date: '2026-10-26', offset: '+01:00' },
];

function makeTable(days) {
  const markup = rows.map(([label, id, defaultTime]) => {
    const cells = days.map(({ date, offset, lateIsha }) => {
      const late = id === 'isha' && lateIsha;
      const time = late ? '00:05' : defaultTime;
      const timestamp = new Date(`${late ? shiftDay(date, 1) : date}T${time}:00${offset}`);
      return `<td><time dateTime="${timestamp.toISOString()}">${time}</time></td>`;
    });
    return `<tr><th scope="row">${label}</th>${cells.join('')}</tr>`;
  });
  return `<table><caption>Gebetszeiten für Hannover, drei Tage</caption><tbody>${markup.join('')}</tbody></table>`;
}

test('Fazilet timings stay attached to the Berlin date across a daylight-saving change', () => {
  const days = decodeFaziletDays(makeTable(autumnChange), '2026-10-25');
  assert.deepEqual(days.map(day => day.date), autumnChange.map(day => day.date));
  assert.deepEqual(days[1].begins, Object.fromEntries(rows.map(([, id, time]) => [id, time])));
  assert.deepEqual(days[1].jamaah, {});
});

test('the Fazilet decoder rejects another city, dates outside the table, and contradictory times', () => {
  const table = makeTable(autumnChange);
  assert.deepEqual(decodeFaziletDays(table.replace('Hannover', 'Hamburg'), '2026-10-25'), []);
  assert.deepEqual(decodeFaziletDays(table, '2026-10-27'), []);
  assert.deepEqual(decodeFaziletDays(table.replace('04:50:00.000Z', '05:50:00.000Z'), '2026-10-25'), []);
});

test('late Ischa keeps its table date, and Imsak stays separate from Fajr', () => {
  const dates = ['2026-05-18', '2026-05-19', '2026-05-20'];
  const table = makeTable(dates.map(date => ({ date, offset: '+02:00', lateIsha: true })));
  const days = decodeFaziletDays(table, dates[1]);
  assert.equal(days[0].begins.isha, '00:05');
  const lookup = date => days.find(day => day.date === date);
  const beforeFajr = widgetState(Date.parse('2026-05-19T05:35:00+02:00'), lookup, 'asr2');
  assert.equal(beforeFajr.current.id, 'isha');
  assert.equal(beforeFajr.current.date, '2026-05-18');
  assert.equal(beforeFajr.next.id, 'fajr');
  assert.equal(beforeFajr.rows[0].id, 'imsak');
  const afterAsr = widgetState(Date.parse('2026-05-19T14:20:00+02:00'), lookup, 'asr2');
  assert.equal(afterAsr.current.id, 'asr');
});

test('the Fazilet download is bounded', async context => {
  context.mock.method(globalThis, 'fetch', async () => new Response('x'.repeat(513 * 1024)));
  await assert.rejects(fetchFaziletDays(AbortSignal.timeout(1000)), /zu groß/);
});
