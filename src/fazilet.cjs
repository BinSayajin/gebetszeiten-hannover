const { TIME_ZONE, dateKey, shiftDay, verifySchedule } = require('./schedule.cjs');

const FAZILET_URL = 'https://fazilettakvimi.com/de/namaz-vakitleri/deutschland/hannover/';
const MAX_PAGE_BYTES = 512 * 1024;
const PRAYER_IDS = new Map([
  ['imsak', 'imsak'], ['fedschrgebet', 'fajr'], ['sonnenaufgang', 'shuruq'],
  ['zuhr', 'thuhr'], ['asr', 'asr'], ['maghrib', 'maghrib'], ['ischa', 'isha'],
]);
const berlinClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function prayerId(heading) {
  const key = heading.replace(/<[^>]*>/g, '')
    .replace(/&(?:rsquo|lsquo|apos|#0*39|#821[67]);/gi, '')
    .replace(/&acirc;/gi, 'â')
    .normalize('NFD').toLowerCase().replace(/[^a-z]/g, '');
  return PRAYER_IDS.get(key);
}

function readTime(cell) {
  const timeElement = /<time\b([^>]*)>\s*(\d{2}:\d{2})\s*<\/time\s*>/i.exec(cell);
  if (!timeElement) return null;
  const [, attributes, printed] = timeElement;
  const iso = /(?:^|\s)datetime\s*=\s*["'](\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))["']/i.exec(attributes)?.[1];
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp) || berlinClock.format(timestamp) !== printed) return null;
  return { date: dateKey(timestamp), time: printed };
}

function decodeFaziletDays(html, today) {
  const table = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table\s*>/gi)]
    .find(([, body]) => /<caption\b[^>]*>\s*Gebetszeiten f(?:ü|&uuml;)r Hannover\s*,/i.test(body));
  if (!table) return [];

  const times = new Map();
  for (const [, row] of table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)) {
    const heading = /<th\b[^>]*>([\s\S]*?)<\/th\s*>/i.exec(row)?.[1];
    const id = heading && prayerId(heading);
    if (!id) continue;

    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td\s*>/gi)].map(([, cell]) => readTime(cell));
    if (times.has(id) || cells.length !== 3 || cells.some(cell => !cell)) return [];
    times.set(id, cells);
  }
  if (times.size !== PRAYER_IDS.size) return [];

  const dates = times.get('fajr').map(cell => cell.date);
  if (!dates.includes(today) || dates[0] !== shiftDay(dates[1], -1) || dates[2] !== shiftDay(dates[1], 1)) return [];

  const days = dates.map((date, index) => {
    const begins = {};
    for (const [id, cells] of times) {
      const cell = cells[index];
      const nextDayIsha = id === 'isha' && cell.time < '04:00' && cell.date === shiftDay(date, 1);
      if (cell.date !== date && !nextDayIsha) return null;
      begins[id] = cell.time;
    }
    return verifySchedule(date, begins);
  });
  return days.every(Boolean) ? days : [];
}

async function fetchFaziletDays(signal) {
  const response = await fetch(FAZILET_URL, { signal, redirect: 'error' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const decoder = new TextDecoder();
  let bytes = 0;
  let html = '';
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > MAX_PAGE_BYTES) throw new Error('Die Fazilet-Seite ist zu groß.');
    html += decoder.decode(chunk, { stream: true });
  }
  return decodeFaziletDays(html + decoder.decode(), dateKey(Date.now()));
}

module.exports = { FAZILET_URL, decodeFaziletDays, fetchFaziletDays };
