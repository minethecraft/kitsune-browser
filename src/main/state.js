'use strict';
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { app } = require('electron');

// ---------- edition ----------
function readEdition() {
  if (process.env.KITSUNE_EDITION) return process.env.KITSUNE_EDITION;
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '../../edition.json'), 'utf8')).edition; } catch (_) { return 'full'; }
}
const EDITION = readEdition() === 'lite' ? 'lite' : 'full';
const LITE = EDITION === 'lite';

const ALL_THEMES = ['sakura', 'neon', 'umbra', 'aqua', 'crimson', 'dusk', 'hanami', 'rain'];
const FEAT = LITE
  ? { assistant: false, sidebar: false, containers: false, split: false, extensions: false, particles: false, themes: ['sakura', 'umbra', 'hanami'] }
  : { assistant: false, sidebar: true, containers: true, split: true, extensions: true, particles: true, themes: ALL_THEMES };

// title-bar overlay colours per theme (Windows caption buttons) + light/dark
const THEME_META = {
  sakura: { bg: '#2b1830', fg: '#ffe3ef' }, neon: { bg: '#0e1027', fg: '#c9f9ff' }, umbra: { bg: '#0b0912', fg: '#e6dcff' },
  aqua: { bg: '#0c2233', fg: '#d6f3ff' }, crimson: { bg: '#1d0b10', fg: '#ffd9dd' }, dusk: { bg: '#1d1630', fg: '#ffe6d1' },
  hanami: { bg: '#ffe3ee', fg: '#3a2540' }, rain: { bg: '#0b1418', fg: '#d3fff0' }
};

const themeMeta = (name, list) => {
  if (THEME_META[name]) return THEME_META[name];
  const c = (list || []).find(t => 'custom:' + t.id === name);
  return c ? { bg: c.bg, fg: c.fg } : THEME_META.sakura;
};
const SEARCH_ENGINES = {
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  google: { name: 'Google', url: 'https://www.google.com/search?q=%s' },
  brave: { name: 'Brave', url: 'https://search.brave.com/search?q=%s' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  startpage: { name: 'Startpage', url: 'https://www.startpage.com/do/search?q=%s' },
  ecosia: { name: 'Ecosia', url: 'https://www.ecosia.org/search?q=%s' }
};
const KEYWORDS = {
  yt: 'https://www.youtube.com/results?search_query=%s', gh: 'https://github.com/search?q=%s', w: 'https://en.wikipedia.org/w/index.php?search=%s',
  al: 'https://anilist.co/search/anime?search=%s', mal: 'https://myanimelist.net/anime.php?q=%s', r: 'https://www.reddit.com/search/?q=%s',
  mr: 'https://modrinth.com/mods?q=%s', npm: 'https://www.npmjs.com/search?q=%s'
};

const DEFAULTS = {
  theme: 'sakura',
  pageTheme: 'system',            // system | dark | light  (prefers-color-scheme for websites)
  animations: 'full',             // full | reduced | off
  particles: 'auto',              // auto | sakura | ember | snow | rain | firefly | none
  adaptiveAccent: true,
  bgKiroku: true,
  showEcchi: false,
  bgInterval: 30,
  displayName: '',
  searchEngine: 'duckduckgo',
  homepage: 'kitsune://newtab/',
  restoreSession: true,
  showBookmarksBar: true,
  blocker: 'standard',            // off | standard | strict
  httpsOnly: true,
  sendGPC: true,
  sleepMinutes: 15,               // 0 = never
  batterySaver: true,             // auto-reduce animation on battery
  downloadDir: '',
  customAnilistIds: [],
  kirokuUrl: 'https://kiroku.zeabur.app',
  kirokuConnected: false,
  kirokuTrack: true,               // report what I watch on the six supported streaming sites (when connected)
  kirokuNewtab: true,              // show Continue watching with live progress on the new tab
  sidebarOn: true,
  zoomDefault: 0,
  updateServer: '',               // blank = same server as the account server
  autoUpdateCheck: true,
  setupDone: false,
  accountServer: 'https://kitsune.zeabur.app',
  accountEmail: '',
  syncOn: true,
  syncWhat: { bookmarks: true, settings: true, history: false, pins: true, themes: true, extensions: true },
  vpnOn: false,
  vpnActive: '',
  vpnProfiles: [],                // {id,name,scheme,host,port,user}  (password lives in the encrypted secret store)
  vpnFreeInit: false,             // set once the built-in free VPN has been switched on by default
  vpnBypass: '',                  // comma-separated hosts that skip the VPN
  vpnWebrtc: true,
  customThemes: [],               // {id,name,bg,bg2,bg3,fg,muted,accent,accent2,image?,particles?}
  nimbusServer: 'https://nimbus.zeabur.app',
  nimbusModel: '',
  aiMode: 'assistant',            // assistant | cowork
  aiOpen: false,
  aiPageContext: true,
  tmdbKey: '',
  hdBackgrounds: true,
  containers: [
    { id: 'default', name: 'Personal', color: '#ff8fb8', icon: '🌸' },
    { id: 'work', name: 'Work', color: '#5ab0ff', icon: '💼' },
    { id: 'anime', name: 'Anime', color: '#b48cff', icon: '⛩️' },
    { id: 'shop', name: 'Shopping', color: '#ffd166', icon: '🛒' }
  ],
  pins: [
    { title: 'Aniwatch', url: 'https://aniwatch.zeabur.app/' },
    { title: 'AniList', url: 'https://anilist.co/' },
    { title: 'Crunchyroll', url: 'https://www.crunchyroll.com/' },
    { title: 'YouTube', url: 'https://www.youtube.com/' },
    { title: 'GitHub', url: 'https://github.com/' }
  ],
  extensions: [],
  sitePerms: {},
  bgPicks: [],                    // anime the user added from the picker: [{id,t}]
  bgHidden: [],                   // anime ids to leave out of backgrounds
  bgMode: 'mix',                  // mix | anime | mine
  sfx: { pack: 'off', volume: 0.5, hover: false, custom: {} },
  communityServer: '',
  vaultAutoLock: 15,
  vaultOffer: true
};

const storage = require('./storage');
let settingsStore = null, bookmarksStore = null, historyStore = null, sessionStore = null;
const bus = new EventEmitter();
const runtime = { dynamicAccent: null, onBattery: false };

function init() {
  settingsStore = storage.open('settings', DEFAULTS);
  bookmarksStore = storage.open('bookmarks', { items: [] });
  historyStore = storage.open('history', { items: [] });
  sessionStore = storage.open('session', { tabs: [], active: 0 });
  // sanitise
  const s = settingsStore.data;
  if (!FEAT.themes.includes(s.theme) && !(String(s.theme).startsWith('custom:') && (s.customThemes || []).some(t => 'custom:' + t.id === s.theme))) s.theme = 'sakura';
  if (!bookmarksStore.data.items.length) {
    bookmarksStore.data.items = [
      { id: 'b1', title: 'Aniwatch', url: 'https://aniwatch.zeabur.app/', added: Date.now(), bar: true },
      { id: 'b2', title: 'AniList', url: 'https://anilist.co/', added: Date.now(), bar: true },
      { id: 'b3', title: 'Crunchyroll', url: 'https://www.crunchyroll.com/', added: Date.now(), bar: true }
    ];
  }
}

const get = () => settingsStore.data;
function patch(p) {
  const s = settingsStore.data;
  const keys = Object.keys(p).sort((a, b) => (a === 'customThemes' ? -1 : b === 'customThemes' ? 1 : 0));
  for (const k of keys) {
    if (!(k in DEFAULTS)) continue;
    let v = p[k];
    if (k === 'theme' && !FEAT.themes.includes(v) && !(typeof v === 'string' && v.startsWith('custom:') && (s.customThemes || []).some(t => 'custom:' + t.id === v))) continue;
    if (typeof DEFAULTS[k] !== typeof v && !(Array.isArray(DEFAULTS[k]) && Array.isArray(v))) continue;
    if (k === 'bgInterval') v = Math.max(8, Math.min(600, v | 0));
    if (k === 'sleepMinutes') v = Math.max(0, Math.min(240, v | 0));
    if (k === 'blocker' && !['off', 'standard', 'strict'].includes(v)) continue;
    if (k === 'animations' && !['full', 'reduced', 'off'].includes(v)) continue;
    if (k === 'searchEngine' && !SEARCH_ENGINES[v]) continue;
    s[k] = v;
  }
  settingsStore.save();
  bus.emit('settings', s);
  return s;
}

module.exports = {
  EDITION, LITE, FEAT, THEME_META, themeMeta, SEARCH_ENGINES, KEYWORDS, DEFAULTS, bus, runtime, init, get, patch,
  bookmarks: () => bookmarksStore, history: () => historyStore, session: () => sessionStore,
  SRC: path.join(__dirname, '..'), get app() { return app; }
};
