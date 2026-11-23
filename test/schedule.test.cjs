const test = require('node:test');
const assert = require('node:assert/strict');
const { dateKey, decodeLiveDay, verifySchedule, widgetState } = require('../src/schedule.cjs');
const annual = require('../data/hannover-2026.json');

function offlineState(isoTime, asr = 'asr2') {
  return widgetState(Date.parse(isoTime), date => {
    const day = verifySchedule(date, annual[date]);
    return day && { ...day, source: 'annual' };
  }, asr);
}

test('every entry of the 2026 PDF calendar has a usable timetable', () => {
  assert.equal(Object.keys(annual).length, 365);
  for (const [day, begins] of Object.entries(annual)) assert.ok(verifySchedule(day, begins), day);
  assert.deepEqual(annual['2026-11-23'], {
    fajr: '05:54', shuruq: '07:53', thuhr: '12:12', asr1: '13:59', asr2: '14:31',
    maghrib: '16:25', isha: '18:07',
  });
});

test('only the selected Asr starts the highlighting', () => {
  const saved = offlineState('2026-11-23T14:15:00+01:00');
  assert.equal(saved.current.id, 'thuhr');
  assert.equal(saved.next.id, 'asr2');
  assert.equal(saved.next.minutes, 16);
  assert.equal(offlineState('2026-11-23T14:15:00+01:00', 'asr1').current.id, 'asr1');
  assert.equal(offlineState('2026-11-23T14:31:00+01:00').current.id, 'asr2');
});

test('Shuruq ends the Fajr highlighting until Thuhr', () => {
  assert.equal(offlineState('2026-11-23T07:52:00+01:00').current.id, 'fajr');
  const state = offlineState('2026-11-23T07:53:00+01:00');
  assert.equal(state.current, null);
  assert.equal(state.next.id, 'thuhr');
});

test('midnight rolls over in Hannover and preserves an Ischa after midnight', () => {
  const tomorrow = offlineState('2026-05-18T23:58:00+02:00');
  assert.equal(tomorrow.next.id, 'isha');
  assert.equal(tomorrow.next.tomorrow, true);
  assert.equal(tomorrow.next.minutes, 3);
  assert.ok(tomorrow.rows.find(row => row.id === 'isha').afterMidnight);
  const afterMidnight = offlineState('2026-05-18T22:02:00Z');
  assert.equal(afterMidnight.date, '2026-05-19');
  assert.equal(afterMidnight.current.id, 'isha');
  assert.equal(afterMidnight.current.date, '2026-05-18');
});

test('Haraj is used when Ischa has no regular time', () => {
  const normal = offlineState('2026-05-01T22:52:00+02:00');
  assert.equal(normal.current.id, 'maghrib');
  assert.equal(normal.next.id, 'isha');
  assert.equal(offlineState('2026-06-01T23:05:00+02:00').current.id, 'haraj');
});

test('the countdown follows elapsed time across the daylight-saving transition', () => {
  const evening = offlineState('2026-03-28T23:30:00+01:00');
  assert.equal(evening.next.id, 'fajr');
  assert.equal(evening.next.time, annual['2026-03-29'].fajr);
  const expected = Date.parse(`2026-03-29T${evening.next.time}:00+02:00`);
  assert.equal(evening.next.minutes, (expected - Date.parse('2026-03-28T23:30:00+01:00')) / 60_000);
  assert.equal(dateKey(Date.parse('2026-10-24T22:05:00Z')), '2026-10-25');
});

test('live entries accept the published format and reject stale or incomplete schedules', () => {
  const today = '2026-11-23';
  const rows = [
    ['Fajr', '05:54:00', '06:45:00'], ['Shuruq', '07:53:00'], ['Thuhr', '12:12:00'],
    ['Asr - Mithl 1', '13:59:00'], ['Asr - Mithl 2', '14:31:00'], ['Maghrib', '16:25:00'], ['Isha', '18:07:00'],
  ].map(([salah, begin_time, jamat_zeit]) => ({ salah, begin_time, jamat_zeit, salah_date: today }));
  assert.deepEqual(decodeLiveDay({ date: today, rows }, today), {
    date: today, begins: annual[today], jamaah: { fajr: '06:45' },
  });
  assert.equal(decodeLiveDay({ date: today, rows }, '2026-11-24'), null);
  assert.equal(decodeLiveDay({ date: today, rows: rows.slice(1) }, today), null);
  assert.equal(decodeLiveDay({ date: today, rows: [...rows, rows[0]] }, today), null);
});
