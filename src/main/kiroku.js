'use strict';
// Kiroku library -> AniList artwork. Bundled snapshot of the user's watched/watching list,
// optionally replaced by an imported list. Artwork is fetched live from AniList and cached.
const fs = require('fs');
const path = require('path');
const { app, net } = require('electron');
const storage = require('./storage');

const bundled = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/library.json'), 'utf8'));
const override = storage.open('kiroku-library', { items: null });
const cacheStore = storage.open('anilist-cache', { time: 0, media: {} });
const TTL = 3 * 24 * 3600 * 1000;
const hdStore = storage.open('hd-art', { v: 2, art: {} });   // anilist id -> { url, w, h, src, poster, t }
const HD_TTL = 14 * 24 * 3600 * 1000;
let hdRunning = false;
const api = { onHd: null };


const QUERY = `query($ids:[Int],$p:Int){Page(page:$p,perPage:50){media(id_in:$ids,type:ANIME){
  id title{romaji english native} bannerImage coverImage{extraLarge large color} genres isAdult averageScore episodes seasonYear format }}}`;

function library(settings) {
  const base = override.data.items || bundled.items;
  const extra = (settings.customAnilistIds || []).filter(n => Number.isInteger(n))
    .filter(id => !base.some(b => b.id === id)).map(id => ({ id, t: '', s: 'watched' }));
  const hidden = new Set(settings.bgHidden || []);
  const picks = (settings.bgPicks || []).filter(p => p && Number.isInteger(p.id)).filter(p => !base.some(b => b.id === p.id) && !extra.some(b => b.id === p.id)).map(p => ({ id: p.id, t: p.t || '', s: 'pick' }));
  return { aniwatchBase: bundled.aniwatchBase, items: base.concat(extra, picks).filter(i => !hidden.has(i.id)) };
}

function importLibrary(json) {
  // accepts {items:[...]}, an array of items, or an array of AniList ids
  let arr = Array.isArray(json) ? json : json && json.items;
  if (!Array.isArray(arr)) throw new Error('Expected an array or {items:[...]}');
  arr = arr.map(x => typeof x === 'number' ? { id: x, t: '', s: 'watched' } : {
    id: x.id || x.anilist_id, t: x.t || x.title || '', s: x.s || (x.status === 'watched' ? 'watched' : x.status === 'watching' ? 'watching' : 'watched'),
    r: x.r || x.rating || undefined, e: x.e || (x.genres || []).includes('Ecchi') || undefined, mal: x.mal
  }).filter(x => Number.isInteger(x.id));
  override.data.items = arr; override.flush();
  return arr.length;
}
function resetLibrary() { override.data.items = null; override.flush(); }

async function fetchPage(ids, p) {
  const res = await net.fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: QUERY, variables: { ids, p } })
  });
  if (!res.ok) throw new Error('AniList ' + res.status);
  const j = await res.json();
  return (j.data && j.data.Page && j.data.Page.media) || [];
}

async function ensureMedia(ids) {
  const c = cacheStore.data;
  const fresh = Date.now() - c.time < TTL;
  const missing = ids.filter(id => !c.media[id]);
  if (fresh && !missing.length) return;
  const need = fresh ? missing : ids;
  try {
    for (let i = 0; i < need.length; i += 50) {
      const chunk = need.slice(i, i + 50);
      const media = await fetchPage(chunk, 1);
      for (const m of media) c.media[m.id] = m;
    }
    c.time = Date.now(); cacheStore.save();
  } catch (e) { console.warn('[kiroku] AniList fetch failed:', e.message); }
}

// ---- HD artwork: TMDB backdrops (when a key is set) -> Kitsu wide covers (up to 3360px) -> AniList banner
async function getJson(url, headers) {
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 12000);
  try { const r = await net.fetch(url, { headers: Object.assign({ Accept: 'application/json' }, headers || {}), signal: ctl.signal }); if (!r.ok) return null; return await r.json(); }
  catch (_) { return null; } finally { clearTimeout(to); }
}
async function kitsuArt(id) {
  const d = await getJson(`https://kitsu.io/api/edge/mappings?filter%5BexternalSite%5D=anilist%2Fanime&filter%5BexternalId%5D=${id}&include=item`, { Accept: 'application/vnd.api+json' });
  const a = d && d.included && d.included[0] && d.included[0].attributes; if (!a) return null;
  const c = a.coverImage, dim = c && c.meta && c.meta.dimensions && c.meta.dimensions.large;
  return { cover: c && (c.large || c.original) ? { url: c.large || c.original, w: dim ? dim.width : 1920, h: dim ? dim.height : 450 } : null, poster: a.posterImage && (a.posterImage.large || a.posterImage.original) || null };
}
async function tmdbArt(key, m) {
  const names = [m.title && m.title.english, m.title && m.title.romaji].filter(Boolean);
  const kind = m.format === 'MOVIE' ? 'movie' : 'tv';
  for (const q of names) {
    const sr = await getJson(`https://api.themoviedb.org/3/search/${kind}?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(q)}`);
    const hit = sr && sr.results && sr.results.find(r => r.backdrop_path && (r.original_language === 'ja' || (r.genre_ids || []).includes(16))) || (sr && sr.results && sr.results[0]);
    if (!hit) continue;
    const im = await getJson(`https://api.themoviedb.org/3/${kind}/${hit.id}/images?api_key=${encodeURIComponent(key)}&include_image_language=null`);
    const bd = im && im.backdrops && im.backdrops.filter(b => b.width >= 1920).sort((a, b) => (b.vote_average - a.vote_average) || (b.width - a.width))[0] || (hit.backdrop_path ? { file_path: hit.backdrop_path, width: 1920, height: 1080 } : null);
    if (bd) return { url: 'https://image.tmdb.org/t/p/w1920_and_h1080_bestv2' + bd.file_path, w: Math.min(bd.width, 1920), h: Math.min(bd.height, 1080) };
  }
  return null;
}
async function enrichHd(settings) {
  if (hdRunning || !settings.hdBackgrounds) return;
  hdRunning = true;
  try {
    const lib = library(settings); const art = hdStore.data.art; let changed = 0;
    const todo = lib.items.filter(it => { const a = art[it.id]; return !a || Date.now() - a.t > HD_TTL || (settings.tmdbKey && a.src !== 'tmdb' && !a.triedTmdb); });
    let i = 0;
    const worker = async () => {
      while (i < todo.length) {
        const it = todo[i++]; const m = cacheStore.data.media[it.id]; if (!m) continue;
        const prev = art[it.id] || {}; const e = { t: Date.now() };
        if (settings.tmdbKey) { const t = await tmdbArt(settings.tmdbKey, m); e.triedTmdb = true; if (t) Object.assign(e, t, { src: 'tmdb' }); }
        const k = await kitsuArt(it.id).catch(() => null);
        if (k && k.poster) e.poster = k.poster;
        if (!e.url && k && k.cover) Object.assign(e, k.cover, { src: 'kitsu' });
        if (!e.url && prev.url) Object.assign(e, { url: prev.url, w: prev.w, h: prev.h, src: prev.src });
        art[it.id] = e; changed++;
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    if (changed) { hdStore.save(); if (api.onHd) api.onHd(); }
  } finally { hdRunning = false; }
}

/** Returns display-ready entries (banner + cover + colour + links), filtered and ranked. */
async function backgrounds(settings) {
  const lib = library(settings);
  await ensureMedia(lib.items.map(i => i.id));
  enrichHd(settings).catch(() => {});
  const out = [];
  for (const it of lib.items) {
    const m = cacheStore.data.media[it.id];
    if (!m) continue;
    const ecchi = it.e || m.isAdult || (m.genres || []).includes('Ecchi');
    if (ecchi && !settings.showEcchi) continue;
    out.push({
      id: it.id,
      title: (m.title && (m.title.english || m.title.romaji)) || it.t,
      status: it.s,
      rating: it.r || null,
      banner: m.bannerImage || null,
      hd: settings.hdBackgrounds && hdStore.data.art[it.id] && hdStore.data.art[it.id].url ? { url: hdStore.data.art[it.id].url, w: hdStore.data.art[it.id].w, h: hdStore.data.art[it.id].h, src: hdStore.data.art[it.id].src } : null,
      cover: (settings.hdBackgrounds && hdStore.data.art[it.id] && hdStore.data.art[it.id].poster) || (m.coverImage && (m.coverImage.extraLarge || m.coverImage.large)) || null,
      color: (m.coverImage && m.coverImage.color) || null,
      score: m.averageScore || null,
      watchUrl: it.mal ? lib.aniwatchBase + it.mal : `https://anilist.co/anime/${it.id}`,
      pageUrl: `https://anilist.co/anime/${it.id}`
    });
  }
  // weight: currently watching first, then top-rated, then rest
  const w = e => (e.status === 'watching' ? 3 : e.status === 'pick' ? 1 : 0) + (e.rating >= 9 ? 2 : e.rating >= 8 ? 1 : 0) + (e.banner ? 1 : 0);
  return out.map(e => ({ e, k: w(e) + Math.random() * 2.5 })).sort((a, b) => b.k - a.k).map(x => x.e);
}

/** Full library for the Anime Hub page (no shuffling, ecchi still filtered unless enabled). */
async function hub(settings) {
  const list = await backgrounds(settings);
  return list.sort((a, b) => (a.status === b.status ? (b.rating || 0) - (a.rating || 0) : a.status === 'watching' ? -1 : 1));
}

const SEARCH = `query($q:String,$p:Int){Page(page:$p,perPage:24){pageInfo{hasNextPage} media(search:$q,type:ANIME,isAdult:false,sort:[SEARCH_MATCH,POPULARITY_DESC]){id title{romaji english} coverImage{large color} bannerImage seasonYear format averageScore}}}`;
const POPULAR = `query($p:Int,$s:[MediaSort]){Page(page:$p,perPage:24){pageInfo{hasNextPage} media(type:ANIME,isAdult:false,sort:$s){id title{romaji english} coverImage{large color} bannerImage seasonYear format averageScore}}}`;
/** Browse the whole AniList catalogue so the user can pick more anime for their backgrounds. */
async function browse(q, page, sort) {
  const body = q ? { query: SEARCH, variables: { q, p: page || 1 } } : { query: POPULAR, variables: { p: page || 1, s: [sort === 'trending' ? 'TRENDING_DESC' : sort === 'score' ? 'SCORE_DESC' : 'POPULARITY_DESC'] } };
  const res = await net.fetch('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error('AniList ' + res.status);
  const j = await res.json(); const pg = j.data && j.data.Page; if (!pg) throw new Error('AniList returned nothing');
  return { more: !!(pg.pageInfo && pg.pageInfo.hasNextPage), items: pg.media.map(m => ({ id: m.id, title: (m.title.english || m.title.romaji), year: m.seasonYear, format: m.format, score: m.averageScore, cover: m.coverImage && m.coverImage.large, color: m.coverImage && m.coverImage.color, banner: !!m.bannerImage })) };
}

module.exports = { browse, api, backgrounds, hub, importLibrary, resetLibrary, library };
