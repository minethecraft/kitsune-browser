'use strict';
// Built-in tracker / ad blocker (Firefox "Enhanced Tracking Protection" style).
// Host-suffix match + a few path patterns. Sub-resources only; top-level navigation is never blocked.

const HOSTS = `
doubleclick.net googlesyndication.com googleadservices.com google-analytics.com googletagmanager.com googletagservices.com
adservice.google.com pagead2.googlesyndication.com 2mdn.net moatads.com adsafeprotected.com scorecardresearch.com
quantserve.com quantcount.com outbrain.com taboola.com criteo.com criteo.net rubiconproject.com pubmatic.com openx.net
adnxs.com advertising.com adform.net adsrvr.org amazon-adsystem.com casalemedia.com contextweb.com indexww.com
smartadserver.com sharethrough.com triplelift.com 33across.com bidswitch.net lijit.com sovrn.com media.net
yieldmo.com teads.tv revcontent.com mgid.com zemanta.com adroll.com perfectaudience.com bluekai.com krxd.net
demdex.net omtrdc.net everesttech.net 2o7.net hotjar.com hotjar.io fullstory.com mouseflow.com crazyegg.com
clicktale.net luckyorange.com inspectlet.com segment.io segment.com mixpanel.com amplitude.com heapanalytics.com
branch.io adjust.com appsflyer.com kochava.com singular.net newrelic.com nr-data.net bugsnag.com
facebook.net connect.facebook.net pixel.facebook.com analytics.twitter.com ads-twitter.com static.ads-twitter.com
ads.linkedin.com px.ads.linkedin.com snap.licdn.com analytics.tiktok.com business-api.tiktok.com ads.tiktok.com
bat.bing.com clarity.ms ads.yahoo.com analytics.yahoo.com adtech.com adtechus.com yimg.com.ad
chartbeat.com chartbeat.net parsely.com permutive.com tapad.com id5-sync.com liveramp.com rlcdn.com
exelator.com eyeota.net mathtag.com turn.com tremorhub.com spotxchange.com spotx.tv springserve.com
imrworldwide.com nielsen.com comscore.com sitescout.com stickyadstv.com serving-sys.com flashtalking.com
innovid.com yieldlab.net improvedigital.com onetag-sys.com adition.com adscale.de zedo.com
popads.net popcash.net propellerads.com exoclick.com juicyads.com trafficjunky.net clickadu.com adsterra.com
hilltopads.net ad-maven.com richpush.co pushwoosh.com onesignal.com.tracker
`.split(/\s+/).filter(Boolean);

// Never block these even if a pattern would match (login / payments / CDNs for essentials).
const ALLOW = ['accounts.google.com', 'gstatic.com', 'recaptcha.net', 'hcaptcha.com', 'stripe.com', 'paypal.com'];

const PATTERNS_STRICT = [
  '/ads/', '/adserver/', '/adframe', '/banners/', '/pagead/', 'googleads', '/tracking/', '/tracker.js', '/pixel.gif',
  '/analytics.js', '/gtag/js', '/fbevents.js', '/beacon.js', 'utm_source=newsletter-tracker'
];

const set = new Set(HOSTS);

function hostMatches(host) {
  let h = host;
  while (h) {
    if (set.has(h)) return true;
    const i = h.indexOf('.');
    if (i < 0) break;
    h = h.slice(i + 1);
  }
  return false;
}
function allowed(host) {
  return ALLOW.some(a => host === a || host.endsWith('.' + a));
}

/** returns true if request should be blocked */
function shouldBlock(url, resourceType, level) {
  if (level === 'off' || resourceType === 'mainFrame') return false;
  let u;
  try { u = new URL(url); } catch (_) { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname;
  if (allowed(host)) return false;
  if (hostMatches(host)) return true;
  if (level === 'strict') {
    const p = (u.pathname + u.search).toLowerCase();
    return PATTERNS_STRICT.some(x => p.includes(x));
  }
  return false;
}

module.exports = { shouldBlock, count: HOSTS.length };
