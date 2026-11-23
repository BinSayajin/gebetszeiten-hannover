const api = window.prayerWidget;
const byId = id => document.getElementById(id);
const dateFormatter = new Intl.DateTimeFormat('de-DE', { dateStyle: 'full', timeZone: 'UTC' });
const sourceLabels = {
  live: ['Live', 'Heute von der Website geladen'],
  cached: ['Gespeichert', 'Zuletzt für heute geladene Zeiten'],
  annual: ['Jahreskalender', 'Gebetszeiten aus dem Offline-Jahreskalender'],
};

let currentKey;
let rowKey;

function duration(minutes) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `in ${remainder} Min.`;
  return `in ${hours} Std.${remainder ? ` ${remainder} Min.` : ''}`;
}

function renderCurrent({ current, source, requesting }) {
  const prayer = source ? current : null;
  const name = prayer?.name ?? (source ? 'Gebetspause' : requesting ? 'Lade Zeiten …' : 'Keine Zeiten');
  const time = prayer?.time ?? '';
  const detail = prayer?.detail ?? '';
  const key = JSON.stringify([name, time, detail]);
  if (key === currentKey) return;
  currentKey = key;

  byId('current-name').textContent = name;
  const clock = byId('current-time');
  clock.textContent = time;
  clock.dateTime = time;
  clock.hidden = !time;
  byId('current-detail').textContent = detail;
  byId('current-detail').hidden = !detail;
}

function renderNext(state) {
  const { next } = state;
  const evening = state.current && ['isha', 'haraj'].includes(state.current.id);
  byId('next-name').textContent = next?.name ?? (evening && state.source ? 'Fajr' : '—');
  byId('next-time').textContent = next?.time ?? '';
  byId('next-time').hidden = !next;
  byId('next-countdown').textContent = next
    ? `${next.tomorrow ? 'Morgen · ' : ''}${duration(next.minutes)}`
    : evening && state.source ? 'Morgen' : '';
  byId('next-name').title = next?.detail ? `${next.name} · ${next.detail}` : '';
}

function makeTime(value, className, afterMidnight = false) {
  const cell = document.createElement('td');
  cell.className = className;
  if (value) {
    const time = document.createElement('time');
    time.dateTime = value;
    time.textContent = value;
    cell.append(time);
    if (afterMidnight) {
      const marker = document.createElement('span');
      marker.className = 'after-midnight';
      marker.textContent = '⁺';
      cell.title = 'Nach Mitternacht, am folgenden Kalendertag';
      marker.setAttribute('aria-label', cell.title);
      cell.append(marker);
    }
  } else {
    cell.classList.add('missing');
    cell.textContent = '—';
    cell.title = 'Keine Zeit verfügbar';
  }
  return cell;
}

function renderRows(rows, current, today) {
  const key = JSON.stringify([rows, current?.id, current?.date, today]);
  if (key === rowKey) return;
  rowKey = key;

  const body = byId('prayer-rows');
  body.replaceChildren(...rows.map(prayer => {
    const row = document.createElement('tr');
    row.dataset.prayer = prayer.id;
    const name = document.createElement('th');
    name.scope = 'row';
    name.textContent = prayer.name;
    if (prayer.detail) {
      const detail = document.createElement('span');
      detail.className = 'prayer-detail';
      detail.textContent = prayer.detail;
      name.append(detail);
    }
    if (prayer.id === current?.id && prayer.time) {
      row.className = 'active';
      name.setAttribute('aria-current', 'true');
      name.title = current.date === today ? 'Aktuelles Gebet' : 'Aktuelles Gebet vom Vorabend';
    }
    row.append(name, makeTime(prayer.time, 'begin', prayer.afterMidnight), makeTime(prayer.jamaah, 'jamaah'));
    return row;
  }));
}

function render(state) {
  document.querySelector('.widget').dataset.theme = state.theme;
  const date = byId('date');
  date.dateTime = state.date;
  date.textContent = dateFormatter.format(new Date(`${state.date}T12:00:00Z`));
  renderCurrent(state);
  renderNext(state);
  renderRows(state.rows, state.current, state.date);
  byId('schedule-table').hidden = !state.source;
  byId('empty').hidden = Boolean(state.source);
  const message = state.requesting ? 'Gebetszeiten werden geladen …' : 'Für heute sind keine Zeiten verfügbar.';
  if (byId('empty-message').textContent !== message) byId('empty-message').textContent = message;
  byId('retry').hidden = state.requesting;

  const status = byId('source-status');
  status.hidden = !state.source;
  if (state.source) {
    const [label, tooltip] = sourceLabels[state.source];
    status.dataset.source = state.source;
    status.title = tooltip;
    byId('source-label').textContent = label;
  }
}

byId('menu').addEventListener('click', () => api.openMenu());
byId('hide').addEventListener('click', () => api.hide());
byId('retry').addEventListener('click', () => api.refresh());
byId('source').addEventListener('click', () => api.openSource());
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') api.hide();
});
api.onState(render);
api.getState().then(state => { if (state) render(state); });
