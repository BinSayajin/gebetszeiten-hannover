const TIME_ZONE = 'Europe/Berlin';
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const API_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

const PRAYERS = [
  { id: 'fajr', name: 'Fajr' },
  { id: 'shuruq', name: 'Schuruq', detail: 'Sonnenaufgang' },
  { id: 'thuhr', name: 'Thuhr' },
  { id: 'asr', name: 'Asr' },
  { id: 'asr1', name: 'Asr', detail: 'Mithl 1' },
  { id: 'asr2', name: 'Asr', detail: 'Mithl 2' },
  { id: 'maghrib', name: 'Maghrib' },
  { id: 'isha', name: 'Ischa' },
  { id: 'haraj', name: 'Ischa', detail: 'Haraj' },
];

const API_NAMES = new Map([
  ['fajr', 'fajr'], ['shuruq', 'shuruq'], ['schuruq', 'shuruq'], ['thuhr', 'thuhr'],
  ['asr', 'asr'], ['asr - mithl 1', 'asr1'], ['asr - mithl 2', 'asr2'],
  ['maghrib', 'maghrib'], ['isha', 'isha'], ['ischa', 'isha'], ['haraj', 'haraj'],
]);

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});
const offsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE, timeZoneName: 'shortOffset',
});

function dateKey(timestamp) {
  return dayFormatter.format(timestamp);
}

function shiftDay(day, days) {
  const time = Date.parse(`${day}T12:00:00Z`) + days * 86_400_000;
  return new Date(time).toISOString().slice(0, 10);
}

function offsetAt(timestamp) {
  const offset = offsetFormatter.formatToParts(timestamp).find(part => part.type === 'timeZoneName');
  return Number(offset.value.slice(3)) * 3_600_000;
}

function berlinTimestamp(day, time) {
  const wallTime = Date.parse(`${day}T${time}:00Z`);
  return wallTime - offsetAt(wallTime - offsetAt(wallTime));
}

function hasMainTimes(begins) {
  const { fajr, shuruq, thuhr, asr, asr1, asr2, maghrib, isha, haraj } = begins;
  const afternoon = [asr, asr1, asr2].filter(Boolean);
  return fajr && shuruq && thuhr && maghrib && (isha || haraj) && afternoon.length > 0
    && fajr < shuruq && shuruq < thuhr && afternoon.every(time => thuhr < time && time < maghrib)
    && (!asr1 || !asr2 || asr1 <= asr2)
    && [isha, haraj].filter(Boolean).every(time => time >= maghrib || time < '04:00');
}

function verifySchedule(day, begins, jamaah = {}) {
  if (!DATE_KEY.test(day) || !begins || !jamaah) return null;

  const verifiedBegins = {};
  const verifiedJamaah = {};
  for (const { id } of PRAYERS) {
    if (Object.hasOwn(begins, id)) {
      if (begins[id] !== null && !CLOCK_TIME.test(begins[id])) return null;
      verifiedBegins[id] = begins[id];
    }
    if (CLOCK_TIME.test(jamaah[id])) verifiedJamaah[id] = jamaah[id];
  }

  if (!hasMainTimes(verifiedBegins)) return null;
  return { date: day, begins: verifiedBegins, jamaah: verifiedJamaah };
}

function decodeLiveDay(payload, today) {
  if (payload?.date !== today || !Array.isArray(payload.rows)) return null;

  const begins = {};
  const jamaah = {};
  for (const row of payload.rows) {
    const id = API_NAMES.get(String(row?.salah).trim().toLowerCase());
    if (!id) continue;
    if (row.salah_date !== today || Object.hasOwn(begins, id)) return null;

    const time = row.begin_time;
    if (time != null && time !== '--:--' && !API_TIME.test(time)) return null;
    begins[id] = API_TIME.test(time) ? time.slice(0, 5) : null;
    if (API_TIME.test(row.jamat_zeit)) jamaah[id] = row.jamat_zeit.slice(0, 5);
  }

  return verifySchedule(today, begins, jamaah);
}

function prayerEvents(schedule, method) {
  if (!schedule) return [];

  const { date, begins } = schedule;
  const alternative = method === 'asr1' ? 'asr2' : 'asr1';
  const asr = [method, 'asr', alternative].find(id => begins[id]);
  const isha = begins.isha ? 'isha' : 'haraj';

  return ['fajr', 'shuruq', 'thuhr', asr, 'maghrib', isha].map(id => {
    const time = begins[id];
    // The annual calendar groups a late Ischa with the preceding evening.
    const day = id === isha && time < begins.maghrib ? shiftDay(date, 1) : date;
    return { id, date, day, time, timestamp: berlinTimestamp(day, time) };
  });
}

function widgetState(now, lookup, method) {
  const today = dateKey(now);
  const schedule = lookup(today);
  const events = [lookup(shiftDay(today, -1)), schedule, lookup(shiftDay(today, 1))]
    .flatMap(day => prayerEvents(day, method))
    .sort((a, b) => a.timestamp - b.timestamp);

  const latest = events.findLast(event => event.timestamp <= now);
  const current = latest && latest.id !== 'shuruq' ? latest : null;
  const next = events.find(event => event.timestamp > now && event.id !== 'shuruq');
  const rows = schedule ? PRAYERS.filter(prayer => Object.hasOwn(schedule.begins, prayer.id)
    && (prayer.id !== 'haraj' || schedule.begins.haraj || schedule.jamaah.haraj)) : [];

  return {
    date: today,
    source: schedule?.source ?? null,
    current: current ? { ...current, ...PRAYERS.find(prayer => prayer.id === current.id) } : null,
    next: next ? {
      ...PRAYERS.find(prayer => prayer.id === next.id),
      time: next.time,
      tomorrow: next.day !== today,
      minutes: Math.ceil((next.timestamp - now) / 60_000),
    } : null,
    rows: rows.map(prayer => ({
      ...prayer,
      time: schedule.begins[prayer.id],
      jamaah: schedule.jamaah[prayer.id] ?? null,
      afterMidnight: ['isha', 'haraj'].includes(prayer.id)
        && Boolean(schedule.begins[prayer.id] && schedule.begins[prayer.id] < schedule.begins.maghrib),
    })),
  };
}

module.exports = { dateKey, decodeLiveDay, verifySchedule, widgetState };
