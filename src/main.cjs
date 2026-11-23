const { app, BrowserWindow, ipcMain, Menu, nativeImage, powerMonitor, screen, shell, Tray } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { dateKey, decodeLiveDay, verifySchedule, widgetState } = require('./schedule.cjs');

const NAME = 'Gebetszeiten Hannover';
const APP_ID = 'app.gebetszeiten.hannover';
const SOURCE = 'https://lichterdererkenntnis.de/#gebetszeiten';
const API = 'https://lichterdererkenntnis.de/api/prayer-times';
const assets = path.join(__dirname, '..', 'assets');
const calendar = new Map();
const liveDays = new Map();
let preferences = { method: 'asr2', pinned: false, position: null };
let widget;
let tray;
let quitting = false;
let requesting = false;
let nextRequest = 0;
let positionTimer;

function readJson(filename) {
  try {
    return JSON.parse(fs.readFileSync(filename, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(`Lesefehler: ${path.basename(filename)}`, error.message);
    return null;
  }
}

function saveLocal(filename, value) {
  const target = path.join(app.getPath('userData'), filename);
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(`${target}.tmp`, JSON.stringify(value));
    fs.renameSync(`${target}.tmp`, target);
  } catch (error) {
    console.warn(`Speicherfehler: ${filename}`, error.message);
  }
}

function loadData() {
  const userData = app.getPath('userData');
  const saved = readJson(path.join(userData, 'preferences.json'));
  if (saved) {
    if (saved.method === 'asr1') preferences.method = saved.method;
    preferences.pinned = saved.pinned === true;
    if (Number.isInteger(saved.position?.x) && Number.isInteger(saved.position?.y)) {
      preferences.position = saved.position;
    }
  }

  const bundled = path.join(__dirname, '..', 'data');
  for (const filename of fs.readdirSync(bundled)) {
    if (!/^hannover-\d{4}\.json$/.test(filename)) continue;
    const days = readJson(path.join(bundled, filename));
    for (const [date, begins] of Object.entries(days ?? {})) {
      const day = verifySchedule(date, begins);
      if (day) calendar.set(date, { ...day, source: 'annual' });
    }
  }

  const cache = readJson(path.join(userData, 'live-days.json'));
  if (!Array.isArray(cache)) return;
  for (const entry of cache.slice(-3)) {
    const day = verifySchedule(entry?.date, entry?.begins, entry?.jamaah);
    if (day) liveDays.set(day.date, { ...day, source: 'cached' });
  }
}

function getState(now = Date.now()) {
  return {
    ...widgetState(now, date => liveDays.get(date) ?? calendar.get(date), preferences.method),
    requesting,
  };
}

function publishState() {
  if (widget?.isVisible() && !widget.webContents.isLoadingMainFrame()) {
    widget.webContents.send('widget:state', getState());
  }
}

async function refresh(force = false) {
  const now = Date.now();
  if (requesting) return;
  if (!force && now < nextRequest) {
    publishState();
    return;
  }

  requesting = true;
  publishState();
  let verified = false;
  try {
    const response = await fetch(API, { signal: AbortSignal.timeout(7000), redirect: 'error' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const day = decodeLiveDay(payload, dateKey(Date.now()));
    if (day) {
      verified = true;
      liveDays.set(day.date, { ...day, source: 'live' });
      const dates = [...liveDays.keys()].sort();
      for (const date of dates.slice(0, -3)) liveDays.delete(date);
      saveLocal('live-days.json', [...liveDays.values()]);
    }
  } catch (error) {
    console.warn('Gebetszeiten konnten nicht abgefragt werden.', error.message);
  } finally {
    if (!verified) {
      for (const day of liveDays.values()) day.source = 'cached';
    }
    requesting = false;
    nextRequest = Date.now() + (verified ? 15 * 60_000 : 60_000);
    publishState();
  }
}

function windowBounds(position) {
  const display = position ? screen.getDisplayNearestPoint(position) : screen.getPrimaryDisplay();
  const area = display.workArea;
  const width = Math.min(384, area.width);
  const height = Math.min(534, area.height);
  const x = position?.x ?? area.x + area.width - width - 22;
  const y = position?.y ?? area.y + 22;
  return {
    x: Math.max(area.x, Math.min(x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(y, area.y + area.height - height)),
    width,
    height,
  };
}

function rememberPosition() {
  if (!widget || widget.isDestroyed()) return;
  const [x, y] = widget.getPosition();
  preferences.position = { x, y };
  saveLocal('preferences.json', preferences);
}

function createWindow() {
  widget = new BrowserWindow({
    ...windowBounds(preferences.position),
    title: NAME,
    icon: path.join(assets, 'app.png'),
    frame: false,
    transparent: true,
    resizable: false,
    fullscreenable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: preferences.pinned,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
    },
  });
  widget.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  widget.webContents.on('will-navigate', event => event.preventDefault());
  widget.on('ready-to-show', () => widget.show());
  widget.on('show', () => {
    publishState();
    updateTrayMenu();
  });
  widget.on('hide', updateTrayMenu);
  widget.on('move', () => {
    clearTimeout(positionTimer);
    positionTimer = setTimeout(rememberPosition, 250);
  });
  widget.on('close', event => {
    if (quitting) return;
    event.preventDefault();
    widget.hide();
  });
  widget.loadFile(path.join(__dirname, 'widget.html'));
}

function togglePinned() {
  preferences.pinned = !preferences.pinned;
  widget.setAlwaysOnTop(preferences.pinned);
  saveLocal('preferences.json', preferences);
  updateTrayMenu();
}

function chooseMethod(method) {
  preferences.method = method;
  saveLocal('preferences.json', preferences);
  publishState();
  updateTrayMenu();
}

function openSource() {
  return shell.openExternal(SOURCE);
}

function menuTemplate() {
  const canUseLoginItem = app.isPackaged && ['win32', 'darwin'].includes(process.platform);
  const items = [
    { label: widget.isVisible() ? 'Widget ausblenden' : 'Widget anzeigen', click: toggleVisibility },
    { label: 'Immer im Vordergrund', type: 'checkbox', checked: preferences.pinned, click: togglePinned },
    {
      label: 'Asr für die Hervorhebung',
      submenu: [
        { label: 'Mithl 1', type: 'radio', checked: preferences.method === 'asr1', click: () => chooseMethod('asr1') },
        { label: 'Mithl 2 (Hanafi)', type: 'radio', checked: preferences.method === 'asr2', click: () => chooseMethod('asr2') },
      ],
    },
  ];
  if (canUseLoginItem) {
    items.push({
      label: 'Beim Anmelden starten',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: item => {
        app.setLoginItemSettings({ openAtLogin: item.checked });
        updateTrayMenu();
      },
    });
  }
  return [
    ...items,
    { type: 'separator' },
    { label: 'Zeiten aktualisieren', click: () => refresh(true) },
    { label: 'Quelle öffnen', click: openSource },
    { type: 'separator' },
    { label: 'Beenden', click: () => app.quit() },
  ];
}

function toggleVisibility() {
  if (widget.isVisible()) widget.hide();
  else widget.show();
}

function updateTrayMenu() {
  if (tray && widget) tray.setContextMenu(Menu.buildFromTemplate(menuTemplate()));
}

function createTray() {
  const icon = process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png';
  tray = new Tray(nativeImage.createFromPath(path.join(assets, icon)));
  tray.setToolTip(NAME);
  if (process.platform !== 'darwin') tray.on('click', toggleVisibility);
  updateTrayMenu();
}

function registerHandlers() {
  const actions = {
    'widget:get-state': getState,
    'widget:hide': () => widget.hide(),
    'widget:menu': () => Menu.buildFromTemplate(menuTemplate()).popup({ window: widget }),
    'widget:source': openSource,
    'widget:refresh': () => refresh(true),
  };
  for (const [channel, handler] of Object.entries(actions)) {
    ipcMain.handle(channel, event => {
      if (event.senderFrame !== widget?.webContents.mainFrame) return;
      return handler();
    });
  }
}

app.setName(NAME);
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
  app.on('second-instance', () => widget?.show());
  app.on('activate', () => widget?.show());
  app.on('before-quit', () => {
    quitting = true;
    clearTimeout(positionTimer);
    rememberPosition();
  });
  app.whenReady().then(() => {
    loadData();
    registerHandlers();
    if (process.platform === 'darwin') app.dock.hide();
    createWindow();
    createTray();

    let day = dateKey(Date.now());
    const timer = setInterval(() => {
      const today = dateKey(Date.now());
      void refresh(today !== day);
      day = today;
    }, 5000);
    timer.unref();
    powerMonitor.on('resume', () => void refresh(true));
    const fitToDisplay = () => {
      const [x, y] = widget.getPosition();
      widget.setBounds(windowBounds({ x, y }));
    };
    screen.on('display-removed', fitToDisplay);
    screen.on('display-metrics-changed', fitToDisplay);
    void refresh();
  });
}
