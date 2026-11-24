const { app, BrowserWindow, ipcMain, Menu, nativeImage, powerMonitor, screen, shell, Tray } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { dateKey, decodeLiveDay, verifySchedule, widgetState } = require('./schedule.cjs');
const { FAZILET_URL, fetchFaziletDays } = require('./fazilet.cjs');

const NAME = 'Gebetszeiten Hannover';
const APP_ID = 'app.gebetszeiten.hannover';
const LICHTER_API = 'https://lichterdererkenntnis.de/api/prayer-times';
const DEFAULT_SIZE = { width: 384, height: 534 };
const MIN_SIZE = { width: 182, height: 96 };
const assets = path.join(__dirname, '..', 'assets');
const calendar = new Map();
const providers = {
  lichter: {
    name: 'Lichter der Erkenntnis', website: 'https://lichterdererkenntnis.de/#gebetszeiten',
    cacheFile: 'live-days.json', days: new Map(), fetchDays: fetchLichterDays,
  },
  fazilet: {
    name: 'Fazilet Kalender', website: FAZILET_URL, daily: true,
    cacheFile: 'fazilet-days.json', days: new Map(), fetchDays: fetchFaziletDays,
  },
};
const preferences = { provider: 'lichter', method: 'asr2', pinned: false, theme: 'classic', position: null, size: DEFAULT_SIZE };
let widget;
let tray;
let boundsTimer;

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
    if (Object.hasOwn(providers, saved.provider)) preferences.provider = saved.provider;
    if (saved.method === 'asr1') preferences.method = saved.method;
    preferences.pinned = saved.pinned === true;
    if (saved.theme === 'glass') preferences.theme = saved.theme;
    if (Number.isInteger(saved.position?.x) && Number.isInteger(saved.position?.y)) {
      preferences.position = saved.position;
    }
    const { width, height } = saved.size ?? {};
    if (Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0) {
      preferences.size = { width, height };
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

  for (const provider of Object.values(providers)) {
    const cache = readJson(path.join(userData, provider.cacheFile));
    const days = provider.daily ? cache?.days : cache;
    if (provider.daily && typeof cache?.requestDay === 'string') provider.requestDay = cache.requestDay;
    if (!Array.isArray(days)) continue;
    for (const entry of days.slice(-3)) {
      const day = verifySchedule(entry?.date, entry?.begins, entry?.jamaah);
      if (day) provider.days.set(day.date, { ...day, source: 'cached' });
    }
  }
}

function getState(now = Date.now()) {
  const id = preferences.provider;
  const provider = providers[id];
  const bundled = id === 'lichter' ? calendar : null;
  return {
    ...widgetState(now, date => provider.days.get(date) ?? bundled?.get(date), preferences.method),
    provider: id,
    providerName: provider.name,
    theme: preferences.theme,
    requesting: Boolean(provider.requesting),
  };
}

function publishState() {
  if (widget?.isVisible() && !widget.webContents.isLoadingMainFrame()) {
    widget.webContents.send('widget:state', getState());
  }
}

function saveProviderCache(provider) {
  const days = [...provider.days.values()];
  saveLocal(provider.cacheFile, provider.daily ? { requestDay: provider.requestDay, days } : days);
}

async function fetchLichterDays(signal) {
  const response = await fetch(LICHTER_API, { signal, redirect: 'error' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  const day = decodeLiveDay(payload, dateKey(Date.now()));
  return day ? [day] : [];
}

async function refresh(force = false) {
  const id = preferences.provider;
  const provider = providers[id];
  const now = Date.now();
  const today = dateKey(now);
  const alreadyRequested = provider.requestDay === today && (provider.daily || now < provider.nextRequest);
  if (provider.requesting || (!force && alreadyRequested)) return;

  provider.requesting = true;
  provider.requestDay = today;
  if (provider.daily) saveProviderCache(provider);
  if (force) publishState();
  let verified = false;
  try {
    const days = await provider.fetchDays(AbortSignal.timeout(7000));
    if (days.length) {
      verified = true;
      for (const day of days) provider.days.set(day.date, { ...day, source: 'live' });
      const dates = [...provider.days.keys()].sort();
      for (const date of dates.slice(0, -3)) provider.days.delete(date);
      saveProviderCache(provider);
    }
  } catch (error) {
    console.warn(`Gebetszeiten von ${provider.name} konnten nicht abgefragt werden.`, error.message);
  } finally {
    if (!verified) {
      for (const day of provider.days.values()) day.source = 'cached';
    }
    provider.requesting = false;
    provider.nextRequest = Date.now() + (verified ? 15 * 60_000 : 60_000);
    if (preferences.provider === id) publishState();
  }
}

function windowBounds(position, size) {
  const display = position
    ? screen.getDisplayMatching({ ...position, ...size })
    : screen.getPrimaryDisplay();
  const area = display.workArea;
  const width = Math.min(Math.max(size.width, MIN_SIZE.width), area.width);
  const height = Math.min(Math.max(size.height, MIN_SIZE.height), area.height);
  const x = position?.x ?? area.x + area.width - width - 22;
  const y = position?.y ?? area.y + 22;
  return {
    x: Math.max(area.x, Math.min(x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(y, area.y + area.height - height)),
    width,
    height,
  };
}

function rememberBounds(resized = false) {
  if (!widget || widget.isDestroyed()) return;
  const { x, y, width, height } = widget.getBounds();
  preferences.position = { x, y };
  // Window creation can round bounds on scaled displays. Persist size only after manual resizing.
  if (resized) preferences.size = { width, height };
  saveLocal('preferences.json', preferences);
}

function queueSaveBounds() {
  clearTimeout(boundsTimer);
  boundsTimer = setTimeout(rememberBounds, 250);
}

function applyWindowTheme() {
  if (!widget) return;
  const glass = preferences.theme === 'glass';
  if (process.platform === 'darwin') widget.setVibrancy(glass ? 'under-window' : null);
  if (process.platform === 'win32') widget.setBackgroundMaterial(glass ? 'acrylic' : 'none');
  widget.setBackgroundColor(glass ? '#00000000' : '#101f1b');
}

function createWindow() {
  const bounds = windowBounds(preferences.position, preferences.size);
  const window = new BrowserWindow({
    ...bounds,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    title: NAME,
    icon: path.join(assets, 'app.png'),
    frame: false,
    resizable: true,
    backgroundColor: '#101f1b',
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
  widget = window;
  applyWindowTheme();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.once('ready-to-show', () => {
    window.setBounds(bounds);
    window.show();
  });
  window.on('show', () => {
    publishState();
    updateTrayMenu();
  });
  window.on('hide', updateTrayMenu);
  window.on('minimize', updateTrayMenu);
  window.on('restore', updateTrayMenu);
  window.on('move', queueSaveBounds);
  window.on('resized', () => rememberBounds(true));
  window.on('close', () => {
    clearTimeout(boundsTimer);
    rememberBounds();
  });
  window.once('closed', () => {
    widget = null;
    updateTrayMenu();
  });
  window.loadFile(path.join(__dirname, 'widget.html')).catch(error => {
    if (window.isDestroyed()) return;
    console.warn('Widget konnte nicht geöffnet werden.', error.message);
    window.close();
  });
}

function togglePinned() {
  preferences.pinned = !preferences.pinned;
  widget?.setAlwaysOnTop(preferences.pinned);
  saveLocal('preferences.json', preferences);
  updateTrayMenu();
}

function chooseMethod(method) {
  preferences.method = method;
  saveLocal('preferences.json', preferences);
  publishState();
  updateTrayMenu();
}

function chooseProvider(id) {
  if (id === preferences.provider) return;
  preferences.provider = id;
  saveLocal('preferences.json', preferences);
  if (widget?.isVisible() && !widget.isMinimized()) void refresh();
  publishState();
  updateTrayMenu();
}

function chooseTheme(theme) {
  if (theme === preferences.theme) return;
  preferences.theme = theme;
  applyWindowTheme();
  saveLocal('preferences.json', preferences);
  publishState();
  updateTrayMenu();
}

function openSource() {
  return shell.openExternal(providers[preferences.provider].website);
}

function menuTemplate() {
  const canUseLoginItem = app.isPackaged && ['win32', 'darwin'].includes(process.platform);
  const items = [
    { label: widget?.isVisible() && !widget.isMinimized() ? 'Widget ausblenden' : 'Widget anzeigen', click: toggleVisibility },
    { label: 'Immer im Vordergrund', type: 'checkbox', checked: preferences.pinned, click: togglePinned },
    {
      label: 'Design',
      submenu: [
        { label: 'Klassisch', type: 'radio', checked: preferences.theme === 'classic', click: () => chooseTheme('classic') },
        { label: 'Glas', type: 'radio', checked: preferences.theme === 'glass', click: () => chooseTheme('glass') },
      ],
    },
    {
      label: 'Gebetszeiten-Quelle',
      submenu: Object.entries(providers).map(([id, provider]) => ({
        label: provider.name, type: 'radio', checked: preferences.provider === id, click: () => chooseProvider(id),
      })),
    },
    {
      label: 'Asr für die Hervorhebung',
      enabled: preferences.provider === 'lichter',
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

function showWidget() {
  if (!widget) createWindow();
  else if (widget.isMinimized()) widget.restore();
  else if (!widget.webContents.isLoadingMainFrame()) widget.show();
}

function toggleVisibility() {
  if (widget?.isVisible() && !widget.isMinimized()) widget.close();
  else showWidget();
}

function updateTrayMenu() {
  if (tray) tray.setContextMenu(Menu.buildFromTemplate(menuTemplate()));
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
    'widget:get-state': () => {
      void refresh();
      return getState();
    },
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
  ipcMain.on('widget:hide', event => {
    if (event.senderFrame === widget?.webContents.mainFrame) widget.close();
  });
}

app.setName(NAME);
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  if (process.platform === 'win32') {
    app.setAppUserModelId(APP_ID);
    // Software rendering avoids the heavier GPU allocations for this static UI on Windows.
    app.disableHardwareAcceleration();
  }
  // Keep the tray available when the widget's window and renderer are closed.
  app.on('window-all-closed', () => {});
  app.whenReady().then(() => {
    loadData();
    registerHandlers();
    if (process.platform === 'darwin') app.dock.hide();
    createTray();
    showWidget();
    app.on('second-instance', showWidget);
    app.on('activate', showWidget);

    powerMonitor.on('resume', () => {
      if (!widget?.isVisible() || widget.isMinimized()) return;
      widget.webContents.send('widget:resume');
    });
    const fitToDisplay = () => {
      if (!widget) return;
      const { x, y, width, height } = widget.getBounds();
      const bounds = windowBounds({ x, y }, { width, height });
      if (bounds.x !== x || bounds.y !== y || bounds.width !== width || bounds.height !== height) {
        widget.setBounds(bounds);
      }
    };
    screen.on('display-removed', fitToDisplay);
    screen.on('display-metrics-changed', fitToDisplay);
  });
}
