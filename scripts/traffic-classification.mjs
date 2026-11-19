// Source and user-agent classifiers adapted from surf-cam-wall. These describe evidence, not people.
import { ORIGIN_HOST, ANSWER_ENGINES, SEARCH_ENGINES } from "./crawler-visits.mjs";
export const SOCIAL = {
  'facebook.com': 'Facebook', 'fb.com': 'Facebook', 'instagram.com': 'Instagram', 't.co': 'X', 'twitter.com': 'X', 'x.com': 'X',
  'reddit.com': 'Reddit', 'linkedin.com': 'LinkedIn', 'lnkd.in': 'LinkedIn', 'youtube.com': 'YouTube', 'pinterest.com': 'Pinterest', 'tiktok.com': 'TikTok',
  'threads.net': 'Threads', 'bsky.app': 'Bluesky', 'vk.com': 'VK',
};
// Chats and mail. Most send no referer at all (WhatsApp, iMessage and Telegram open links with none), so a visit from
// a message usually reads as direct; these catch the web clients and the `android-app://<package>` referer Chrome
// adds when an Android app opens a link in a custom tab.
export const MESSAGING = {
  'whatsapp.com': 'WhatsApp', 'telegram.org': 'Telegram', 't.me': 'Telegram', 'messenger.com': 'Messenger', 'mail.google.com': 'Gmail',
  'outlook.live.com': 'Outlook', 'outlook.office.com': 'Outlook', 'outlook.office365.com': 'Outlook', 'mail.yahoo.com': 'Yahoo Mail',
  'discord.com': 'Discord', 'discordapp.com': 'Discord', 'slack.com': 'Slack', 'teams.microsoft.com': 'Teams', 'teams.live.com': 'Teams',
  'statics.teams.cdn.office.net': 'Teams', 'web.skype.com': 'Skype', 'signal.org': 'Signal',
};
const APPS = {
  'com.google.android.googlequicksearchbox': ['search', 'Google app'],
  'com.whatsapp': ['message', 'WhatsApp'], 'com.whatsapp.w4b': ['message', 'WhatsApp'], 'org.telegram.messenger': ['message', 'Telegram'], 'org.telegram.plus': ['message', 'Telegram'],
  'com.facebook.orca': ['message', 'Messenger'], 'com.facebook.mlite': ['message', 'Messenger'], 'com.google.android.apps.messaging': ['message', 'Google Messages'],
  'com.samsung.android.messaging': ['message', 'Samsung Messages'], 'org.thoughtcrime.securesms': ['message', 'Signal'], 'com.slack': ['message', 'Slack'],
  'com.discord': ['message', 'Discord'], 'com.microsoft.teams': ['message', 'Teams'], 'com.google.android.gm': ['message', 'Gmail'],
  'com.microsoft.office.outlook': ['message', 'Outlook'], 'com.viber.voip': ['message', 'Viber'], 'jp.naver.line.android': ['message', 'LINE'], 'com.tencent.mm': ['message', 'WeChat'],
  'com.facebook.katana': ['social', 'Facebook'], 'com.facebook.lite': ['social', 'Facebook'], 'com.instagram.android': ['social', 'Instagram'], 'com.twitter.android': ['social', 'X'],
  'com.linkedin.android': ['social', 'LinkedIn'], 'com.reddit.frontpage': ['social', 'Reddit'], 'com.snapchat.android': ['social', 'Snapchat'], 'com.zhiliaoapp.musically': ['social', 'TikTok'], 'com.pinterest': ['social', 'Pinterest'],
};
const UTM = { 'chatgpt.com': ['answer', 'ChatGPT'], chatgpt: ['answer', 'ChatGPT'], perplexity: ['answer', 'Perplexity'], copilot: ['answer', 'Copilot'], gemini: ['answer', 'Gemini'], claude: ['answer', 'Claude'] };

const hostMatch = (host, needle) => host === needle || host.endsWith(`.${needle}`);

// Where a request came from: the referer, or a utm_source our pages never add themselves (ChatGPT appends
// `utm_source=chatgpt.com` to the links in its answers and sends no referer).
export function sourceOf({ referer, params }) {
  const utm = params?.get('utm_source');
  if (utm) { const known = UTM[utm.toLowerCase()]; return known ? { kind: known[0], name: known[1] } : { kind: 'other', name: `utm ${utm}` }; }
  if (!referer) return { kind: 'direct', name: 'direct' };
  let url; try { url = new URL(referer); } catch { return { kind: 'other', name: 'malformed referer' }; }
  const host = url.hostname;
  if (url.protocol === 'android-app:') { const app = APPS[host.toLowerCase()]; return app ? { kind: app[0], name: app[1], host } : { kind: 'other', name: `app ${host}`, host }; }
  if (hostMatch(host, ORIGIN_HOST) || host === 'vobarna.b-cdn.net') return { kind: 'direct', name: 'direct' };
  for (const [needle, name] of Object.entries(ANSWER_ENGINES)) if (hostMatch(host, needle)) return { kind: 'answer', name, host };
  for (const [needle, name] of Object.entries(MESSAGING)) if (hostMatch(host, needle)) return { kind: 'message', name, host };
  for (const [needle, name] of Object.entries(SEARCH_ENGINES)) {
    const matches = needle === 'google.' ? /^(?:(?:www\d*|images|news|lens)\.)?google\.(?:com|[a-z]{2}|(?:co|com)\.[a-z]{2})$/.test(host)
      : needle === 'yandex.' ? /^(?:www\.)?yandex\.(?:com|ru|by|kz|com\.tr)$/.test(host) : hostMatch(host, needle);
    if (matches) return { kind: 'search', name, host };
  }
  for (const [needle, name] of Object.entries(SOCIAL)) if (hostMatch(host, needle)) return { kind: 'social', name, host };
  return { kind: 'other', name: host, host };
}

// ---------------------------------------------------------------------------------------------- user agents
// Apple's Messages and Mail build the preview on the sender's device: a Safari string with the three bot names appended
// fetches the page, then NetworkingExtension (iOS) or com.apple.WebKit.Networking (macOS) the icons and images. The
// compound string must be matched before Facebook's own crawler, which comes from Meta's addresses without a prefix.
export const PREVIEW_AGENTS = [
  ['facebookexternalhit/1.1 Facebot Twitterbot/1.0', 'Apple (Messages or Mail page fetch)'],
  ['WhatsApp', 'WhatsApp'], ['facebookexternalhit', 'Facebook'], ['Facebot', 'Facebook'], ['Twitterbot', 'X'], ['Slackbot', 'Slack'], ['TelegramBot', 'Telegram'],
  ['Discordbot', 'Discord'], ['LinkedInBot', 'LinkedIn'], ['SkypeUriPreview', 'Skype'], ['Snapchat', 'Snapchat'], ['Iframely', 'embed'], ['Embedly', 'embed'],
  ['com.apple.WebKit.Networking', 'Apple (iMessage or Mail, macOS)'], ['NetworkingExtension', 'Apple (iMessage or Mail, iOS)'], ['Google-PageRenderer', 'Google'],
];
export const previewOf = agent => PREVIEW_AGENTS.find(([token]) => agent.includes(token))?.[1] ?? null;
// The channel a preview label stands for: Apple's several strings are one channel.
export const shareChannelOf = label => /^Apple/.test(label) ? 'Apple Messages or Mail' : label;
// Channels whose preview is fetched from the sender's own device, so the fetching address is the sharer's.
export const DEVICE_SIDE_CHANNELS = /^(WhatsApp|Apple|Android share sheet)/;

const ICON = /^\/(favicon\.(ico|png)|apple-touch-icon[^/]*\.png)$|^\/assets\/[^/]+\/(favicon|apple-touch-icon)[^/]*\.png$/;
const REDUCED_ANDROID = /^Mozilla\/5\.0 \(Linux; Android \d+;\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) Chrome\/\d+\.0\.0\.0 Mobile Safari\/537\.36$/;
// Android's share sheet draws a preview of a link before the person picks an app: a Chrome string without a device
// model fetches the page and its touch icon, nothing else, from the sharer's own address (seen 2026-10-18 just before
// WhatsApp's own fetch). A browser that rendered the page would have loaded assets.
export function shareSheetOf(group) {
  const { records, agent } = group;
  if (records.length > 6 || group.last - group.first > 120000) return null;
  if (!records.some(r => r.html) || !records.every(r => r.html || ICON.test(r.path))) return null;
  return REDUCED_ANDROID.test(agent) ? 'Android share sheet' : null;
}

const IN_APP = /FBAN|FBAV|FB_IAB|Instagram|MessengerLite/;
// The app a page was opened inside, from the browser string: the social apps name themselves, Android's WebView
// carries `; wv)`, an iOS WebView lacks the Safari token. Null for a plain browser (links from WhatsApp or iMessage
// open in Safari or a Chrome custom tab and look like any other visit).
export function inAppOf(agent) {
  if (/FB_IAB\/MESSENGER|MessengerLite|FBAN\/Messenger/i.test(agent)) return 'Messenger';
  if (/FBAN|FBAV|FB_IAB/.test(agent)) return 'Facebook app';
  if (/Instagram/.test(agent)) return 'Instagram app';
  if (/LinkedInApp/.test(agent)) return 'LinkedIn app';
  if (/MicroMessenger/.test(agent)) return 'WeChat';
  if (/\bLine\//.test(agent)) return 'LINE';
  if (/TikTok|musical_ly|BytedanceWebview/.test(agent)) return 'TikTok';
  if (/GSA\//.test(agent)) return 'Google app';
  if (/; wv\)/.test(agent)) return 'Android app (WebView)';
  if (/iPhone|iPad/.test(agent) && /^Mozilla.*AppleWebKit/.test(agent) && !/Safari\/|CriOS|FxiOS|EdgiOS|OPT\/|Brave|DuckDuckGo/.test(agent)) return 'iOS app (WebView)';
  return null;
}

// The name of a robot or script, or null for a browser. Crawlers and previews are named before this is asked.
export function botName(agent) {
  if (!agent || agent === '-') return 'no user agent';
  if (/^https?:\/\//.test(agent)) return 'a URL as user agent';
  if (/^Mozlila/.test(agent)) return 'Mozlila (misspelt browser)';
  if (IN_APP.test(agent)) return null;
  if (!/Mozilla\//.test(agent)) {
    if (agent === 'Chrome Privacy Preserving Prefetch Proxy') return 'Chrome prefetch proxy (Google)';
    if (/^Lavf\//.test(agent)) return 'Lavf (ffmpeg)';
    if (/^Dalvik\//.test(agent)) return 'Dalvik (Android app)';
    if (/aiohttp/.test(agent)) return 'Python aiohttp';
    return agent.match(/^[^/ (\[;]+/)?.[0] ?? agent.slice(0, 40);
  }
  if (!/AppleWebKit|Gecko\/|Trident|Presto|Goanna/.test(agent)) return agent.match(/compatible;\s*([^;)\s]+)/)?.[1] ?? agent.match(/\(([^;)\s]+)/)?.[1] ?? 'unnamed robot';
  const token = agent.match(/[\w.-]*(?:bot|crawler|spider|heritrix|scanner|validator|monitor|Lighthouse|PTST|GTmetrix|Pingdom|HeadlessChrome)[\w.-]*/i)?.[0];
  return token ?? null;
}

// Device, system and browser from a browser's user agent, for the visitor tables.
export function describeAgent(agent) {
  const get = re => agent.match(re)?.[1];
  let device = 'desktop', os = 'other';
  if (/iPhone/.test(agent)) { device = 'phone'; os = `iOS ${get(/OS (\d+)_/) ?? ''}`.trim(); }
  else if (/iPad/.test(agent)) { device = 'tablet'; os = 'iPadOS'; }
  else if (/Android/.test(agent)) { device = /Mobile/.test(agent) ? 'phone' : 'tablet'; os = `Android ${get(/Android (\d+)/) ?? ''}`.trim(); }
  else if (/Windows NT/.test(agent)) os = 'Windows';
  else if (/Macintosh/.test(agent)) os = 'macOS';
  else if (/CrOS/.test(agent)) os = 'ChromeOS';
  else if (/Linux|X11/.test(agent)) os = 'Linux';
  else device = 'other';
  let browser;
  if (/HeadlessChrome/.test(agent)) browser = 'HeadlessChrome';
  else if (/FBAN|FBAV|FB_IAB|MessengerLite/.test(agent)) browser = 'Facebook app';
  else if (/Instagram/.test(agent)) browser = 'Instagram app';
  else if (/Edg(e|A|iOS)?\//.test(agent)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(agent)) browser = 'Opera';
  else if (/SamsungBrowser/.test(agent)) browser = 'Samsung Internet';
  else if (/YaBrowser/.test(agent)) browser = 'Yandex Browser';
  else if (/DuckDuckGo/.test(agent)) browser = 'DuckDuckGo';
  else if (/Firefox\/|FxiOS/.test(agent)) browser = 'Firefox';
  else if (/ Brave\b/.test(agent)) browser = 'Brave';
  else if (/; wv\)/.test(agent)) browser = 'in-app WebView';
  else if (/CriOS\//.test(agent)) browser = 'Chrome';
  else if (/Chrome\//.test(agent)) browser = `Chrome ${get(/Chrome\/(\d+)/)}`;
  else if (/Version\/.*Safari\//.test(agent)) browser = 'Safari';
  else if (/AppleWebKit/.test(agent)) browser = 'WebKit';
  else browser = 'other';
  const chrome = Number(get(/Chrome\/(\d+)/)), ios = Number(get(/iPhone OS (\d+)_/));
  const old = (browser.startsWith('Chrome') && chrome > 0 && chrome < 100) || (ios > 0 && ios < 15);
  return { device, os, browser, label: `${os} ${browser}`.trim(), old };
}
