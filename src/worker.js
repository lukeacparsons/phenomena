/**
 * Phenomena Experience — Cloudflare Worker
 * 
 * Handles:
 *   /api/checkout    — drives full purchase flow, returns Redsys payment URL
 *   /api/availability — live seat counts for an event
 *   /api/health      — health check + last refresh info
 *   /api/logs        — recent refresh logs
 *   Cron trigger     — refreshes programme data every 15 min
 */

const SITE = 'phenomena-experience.com';
const POSTER_PATH_RE = /^\/obj\/LCinesD_dat\/eventos\/[A-Za-z0-9_-]+\.(?:jpe?g|png|webp)$/i;
const PUBLIC_CORS_ORIGINS = new Set([
  'https://phenomenarapida.com',
  'https://www.phenomenarapida.com',
  'https://phenomena-rapida.onrender.com',
]);

// ─── Helpers ───

async function siteRequest(method, path, { body, headers, cookies } = {}) {
  const url = `https://${SITE}${path}`;
  const hdrs = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    'Accept': 'text/html,application/json,*/*',
    'Origin': `https://${SITE}`,
    'Referer': `https://${SITE}/`,
    ...headers,
  };
  if (cookies) hdrs['Cookie'] = cookies;

  const opts = { method, headers: hdrs };
  if (body) {
    if (typeof body === 'object' && !(body instanceof URLSearchParams)) {
      opts.body = JSON.stringify(body);
      hdrs['Content-Type'] = 'application/json';
    } else {
      opts.body = body.toString();
      if (!hdrs['Content-Type']) hdrs['Content-Type'] = 'application/x-www-form-urlencoded';
    }
  }

  const resp = await fetch(url, opts);
  const text = await resp.text();
  const setCookie = resp.headers.get('set-cookie') || '';
  return { status: resp.status, text, setCookie };
}

function bin2hex(s) {
  return Array.from(new TextEncoder().encode(s)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getFreshSession() {
  const { text, setCookie } = await siteRequest('GET', '/');

  let uuid, recinto = '200', subdominio = 'phenomenaexperience', key = 'apirswebphp';

  const cookieMatch = setCookie.match(/cookies=(\{.*?\})(?:;|$)/);
  if (cookieMatch) {
    try {
      const cdata = JSON.parse(cookieMatch[1]);
      uuid = cdata?.uuid?.valor;
      recinto = cdata?.recinto?.valor || '200';
      subdominio = cdata?.subdominio?.valor || 'phenomenaexperience';
      key = cdata?.key?.valor || 'apirswebphp';
    } catch (e) {}
  }

  return { uuid, recinto, subdominio, key };
}

function extractJson(html, varType) {
  const re = new RegExp(`addToJSON\\('${varType}',\\s*(\\{.*?\\})\\)`, 'gs');
  const result = {};
  let m;
  while ((m = re.exec(html)) !== null) {
    try { Object.assign(result, JSON.parse(m[1])); } catch (e) {}
  }
  return result;
}

function decodeBase64Latin1(b64) {
  if (!b64) return '';
  try {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    return new TextDecoder('latin1').decode(bytes);
  } catch (e) { return b64; }
}

function jsonResponse(data, status = 200, corsOrigin = '*') {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
  };
  if (corsOrigin) {
    headers['Access-Control-Allow-Origin'] = corsOrigin;
    headers['Vary'] = 'Origin';
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function getCorsOrigin(request) {
  const origin = request.headers.get('Origin');
  return origin && PUBLIC_CORS_ORIGINS.has(origin) ? origin : null;
}

function detectSuspiciousEventDrop(prevEventList = [], nextEventList = []) {
  const prevCount = prevEventList.length;
  const nextCount = nextEventList.length;
  if (prevCount < 12) return null;

  const prevIds = new Set(prevEventList.map(e => String(e.evento_id)));
  const nextIds = new Set(nextEventList.map(e => String(e.evento_id)));

  let removedCount = 0;
  for (const id of prevIds) {
    if (!nextIds.has(id)) removedCount++;
  }

  let addedCount = 0;
  for (const id of nextIds) {
    if (!prevIds.has(id)) addedCount++;
  }

  const collapsedCount = nextCount <= Math.max(5, Math.floor(prevCount * 0.4));
  const heavyRemoval = removedCount >= Math.max(8, Math.floor(prevCount * 0.5));
  const lowReplacement = addedCount <= Math.max(2, Math.floor(prevCount * 0.1));

  if (!collapsedCount || !heavyRemoval || !lowReplacement) return null;
  return { prevCount, nextCount, removedCount, addedCount };
}

function sanitizeText(value, { maxLen, pattern, field }) {
  const str = String(value ?? '').trim();
  if (str.length > maxLen) throw new Error(`${field} too long`);
  if (/[|\u0000-\u001F\u007F]/.test(str)) throw new Error(`${field} contains invalid characters`);
  if (str && pattern && !pattern.test(str)) throw new Error(`${field} is invalid`);
  return str;
}

function parseCheckoutPayload(payload) {
  const sessionId = String(payload?.sessionId ?? '').trim();
  if (!/^\d+$/.test(sessionId)) throw new Error('sessionId must be numeric');

  const qtyRaw = payload?.qty ?? 1;
  const qty = Number.parseInt(String(qtyRaw), 10);
  if (!Number.isInteger(qty) || qty < 1 || qty > 12) throw new Error('qty must be an integer between 1 and 12');

  return { sessionId, qty };
}

function getInputValue(html, name) {
  const inputRe = /<input\b[^>]*>/gi;
  let match;
  while ((match = inputRe.exec(html)) !== null) {
    const tag = match[0];
    const nameMatch = tag.match(/\bname\s*=\s*["']?([^"'\s>]+)/i);
    if (nameMatch?.[1] !== name) continue;
    const valueMatch = tag.match(/\bvalue\s*=\s*["']?([^"'>\s]*)/i);
    return valueMatch?.[1] || '';
  }
  return '';
}

function getBearerToken(request) {
  const auth = request.headers.get('Authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function requireAdmin(request, env) {
  if (!env.ADMIN_TOKEN) return jsonResponse({ error: 'Admin auth not configured' }, 500, null);
  const token = getBearerToken(request);
  if (!token) return jsonResponse({ error: 'Authorization required' }, 401, null);
  if (token !== env.ADMIN_TOKEN) return jsonResponse({ error: 'Invalid admin token' }, 403, null);
  return null;
}

async function getAllowedPosterPaths(env) {
  const stored = await env.KV.get('allowed_poster_paths');
  if (stored) {
    try {
      return new Set(JSON.parse(stored));
    } catch (e) {}
  }

  try {
    const data = JSON.parse(await env.KV.get('data') || '{"events":[]}');
    return new Set((data.events || []).map(ev => ev.poster_v).filter(Boolean));
  } catch (e) {
    return new Set();
  }
}

function imageResponse(body, headers, method = 'GET') {
  return new Response(method === 'HEAD' ? null : body, { headers });
}

async function warmImageCache(imgPath, env) {
  if (!imgPath || !imgPath.startsWith('/')) return false;

  const cacheKey = `img:${imgPath}`;
  const cached = await env.KV.get(cacheKey, 'arrayBuffer');
  if (cached) return false;

  const originUrl = `https://${SITE}${imgPath}`;
  const resp = await fetch(originUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'image/*' },
    cf: {
      image: {
        width: 400,
        quality: 75,
        format: 'webp',
        fit: 'scale-down',
      },
    },
  });

  if (!resp.ok) {
    const fallback = await fetch(originUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'image/*' },
    });
    if (!fallback.ok) return false;
    const buf = await fallback.arrayBuffer();
    await env.KV.put(cacheKey, buf, { expirationTtl: 604800 });
    return true;
  }

  const buf = await resp.arrayBuffer();
  await env.KV.put(cacheKey, buf, { expirationTtl: 604800 });
  return true;
}

// ─── /img/proxy ───

async function handleImageProxy(request, env) {
  const corsOrigin = getCorsOrigin(request);
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response('Method not allowed', { status: 405, headers: { 'Allow': 'GET, HEAD' } });
  }

  const url = new URL(request.url);
  const imgPath = (url.searchParams.get('path') || '').trim();
  if (!imgPath || !imgPath.startsWith('/') || imgPath.length > 200 || imgPath.includes('..') || !POSTER_PATH_RE.test(imgPath)) {
    return new Response('Missing path', { status: 400 });
  }

  const allowedPaths = await getAllowedPosterPaths(env);
  if (!allowedPaths.has(imgPath)) {
    return new Response('Image path not allowed', { status: 403 });
  }

  // Check KV cache first
  const cacheKey = `img:${imgPath}`;
  const cached = await env.KV.get(cacheKey, 'arrayBuffer');
  if (cached) {
    return imageResponse(cached, {
      'Content-Type': 'image/webp',
      'Cache-Control': 'public, max-age=604800, immutable',
      ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin, 'Vary': 'Origin' } : {}),
    }, request.method);
  }

  // Fetch from origin
  const originUrl = `https://${SITE}${imgPath}`;
  const resp = await fetch(originUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'image/*' },
    cf: {
      image: {
        width: 400,
        quality: 75,
        format: 'webp',
        fit: 'scale-down',
      },
    },
  });

  if (!resp.ok) {
    // Fallback: return the original without resizing
    const fallback = await fetch(originUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'image/*' },
    });
    if (!fallback.ok) return new Response('Image not found', { status: 404 });
    const buf = await fallback.arrayBuffer();
    // Cache in KV for 7 days (even unoptimised, avoids re-fetching)
    await env.KV.put(cacheKey, buf, { expirationTtl: 604800 });
    return imageResponse(buf, {
      'Content-Type': fallback.headers.get('content-type') || 'image/jpeg',
      'Cache-Control': 'public, max-age=604800',
      ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin, 'Vary': 'Origin' } : {}),
    }, request.method);
  }

  const buf = await resp.arrayBuffer();
  // Cache optimised image in KV for 7 days
  await env.KV.put(cacheKey, buf, { expirationTtl: 604800 });
  return imageResponse(buf, {
    'Content-Type': 'image/webp',
    'Cache-Control': 'public, max-age=604800, immutable',
    ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin, 'Vary': 'Origin' } : {}),
  }, request.method);
}

// ─── /api/availability-all ───

async function handleAvailabilityAll(request) {
  const corsOrigin = getCorsOrigin(request);
  try {
    // Scrape the cartelera page which has all session data inline
    const { text } = await siteRequest('GET', '/index?pag=cartelera');
    const raw = extractJson(text, 's');
    
    // Group by event name, but we need evento IDs. Get fichas too.
    const fichas = extractJson(text, 'f');
    const eventoMap = {}; // session_id → evento_id
    for (const [fid, fd] of Object.entries(fichas)) {
      if (fd.evento && String(fd.evento) !== '0') {
        eventoMap[fid] = String(fd.evento);
      }
    }
    
    const events = {};
    for (const [k, v] of Object.entries(raw)) {
      const sesId = String(v.Id);
      // Find which evento this session belongs to by matching event name
      let eventoId = null;
      for (const [fid, fd] of Object.entries(fichas)) {
        if (fd.nombre === v.NombreEvento && fd.evento && String(fd.evento) !== '0') {
          eventoId = String(fd.evento);
          break;
        }
      }
      if (!eventoId) continue;
      
      if (!events[eventoId]) events[eventoId] = {};
      events[eventoId][sesId] = {
        available: v.Disponibles || 0,
        capacity: v.Aforo || 0,
        purchase_open: v.CompraAbierta === 1,
        closed_reason: v.RazonCompraCerradaTexto || '',
      };
    }
    
    return jsonResponse({ events }, 200, corsOrigin);
  } catch (e) {
    return jsonResponse({ error: e.message }, 500, corsOrigin);
  }
}

// ─── /api/checkout ───

async function handleCheckout(request) {
  const corsOrigin = getCorsOrigin(request);
  try {
    const payload = await request.json();
    const { sessionId, qty } = parseCheckoutPayload(payload);
    const subdominio = 'phenomenaexperience';
    const fallbackRecinto = '200';

    const cartSeedResp = await fetch(
      `https://www.reservaentradas.com/entrada/sessionone/buy/${subdominio}/tickets/${sessionId}?destatic=false&sala=0&step=2`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'text/html,*/*',
        },
      }
    );
    const cartSeedHtml = await cartSeedResp.text();
    if (!cartSeedResp.ok) {
      return jsonResponse({ error: `ReservaEntradas returned ${cartSeedResp.status}` }, 502, corsOrigin);
    }

    const usu = getInputValue(cartSeedHtml, 'usu');
    const recinto = getInputValue(cartSeedHtml, 'recinto') || fallbackRecinto;
    const cine = getInputValue(cartSeedHtml, 'cine') || subdominio;
    const ses = getInputValue(cartSeedHtml, 'w-ses') || sessionId;

    if (!/^[0-9a-f-]{36}$/i.test(usu)) {
      return jsonResponse({ error: 'ReservaEntradas did not return a cart token' }, 502, corsOrigin);
    }

    return jsonResponse({
      postUrl: 'https://www.reservaentradas.com/cart',
      fields: {
        'w-num-ent': String(qty),
        'w-ses': ses,
        usu,
        cine,
        recinto,
      },
    }, 200, corsOrigin);
  } catch (e) {
    const isClientError = e instanceof SyntaxError || /sessionId|qty|invalid|too long/i.test(e.message || '');
    return jsonResponse({ error: e.message }, isClientError ? 400 : 500, corsOrigin);
  }
}

// ─── /api/availability ───

async function handleAvailability(request) {
  const corsOrigin = getCorsOrigin(request);
  try {
    const url = new URL(request.url);
    const eventoId = url.searchParams.get('evento');
    if (!eventoId) return jsonResponse({ error: 'evento param required' }, 400, corsOrigin);

    const { text } = await siteRequest('GET', `/index?pag=ficha&evento=${eventoId}`);
    const sessions = {};
    const raw = extractJson(text, 's');
    for (const [k, v] of Object.entries(raw)) {
      sessions[String(v.Id)] = {
        available: v.Disponibles || 0,
        capacity: v.Aforo || 0,
        purchase_open: v.CompraAbierta === 1,
        closed_reason: v.RazonCompraCerradaTexto || '',
      };
    }
    return jsonResponse({ sessions }, 200, corsOrigin);
  } catch (e) {
    return jsonResponse({ error: e.message }, 500, corsOrigin);
  }
}

// ─── /api/health ───

async function handleHealth(request, env) {
  const corsOrigin = getCorsOrigin(request);
  try {
    const meta = JSON.parse(await env.KV.get('refresh_meta') || '{}');
    return jsonResponse({
      ok: true,
      lastRefresh: meta.scraped_at || null,
      events: meta.total_events || 0,
      sessions: meta.total_sessions || 0,
      staleMinutes: meta.scraped_at ? Math.round((Date.now() - new Date(meta.scraped_at).getTime()) / 60000) : null,
    }, 200, corsOrigin);
  } catch (e) {
    return jsonResponse({ ok: false, error: e.message }, 500, corsOrigin);
  }
}

// ─── /api/logs ───

async function handleLogs(env) {
  try {
    const logs = JSON.parse(await env.KV.get('refresh_logs') || '[]');
    return jsonResponse({ logs });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

// ─── Cron: Refresh data ───

async function refreshData(env) {
  const logs = JSON.parse(await env.KV.get('refresh_logs') || '[]');
  const prevData = JSON.parse(await env.KV.get('data') || '{"events":[]}');
  const prevEvents = new Set(prevData.events?.map(e => e.evento_id) || []);

  const log = { time: new Date().toISOString(), status: 'ok', changes: [] };

  try {
    // Scrape cartelera
    const { text: carteleraHtml } = await siteRequest('GET', '/index?pag=cartelera');
    const fichas = extractJson(carteleraHtml, 'f');
    const sesiones = extractJson(carteleraHtml, 's');

    const events = {};
    for (const [fid, fd] of Object.entries(fichas)) {
      const eid = fd.evento || '0';
      if (!eid || String(eid) === '0') continue;
      events[fid] = {
        ficha_id: fid, evento_id: String(eid),
        name: fd.nombre || '',
        poster_h: fd['img-h'] || '', poster_v: fd['img-v'] || '',
        synopsis_b64: fd.sinopsis || '',
        synopsis: decodeBase64Latin1(fd.sinopsis),
        trailer_url: fd.video || '',
        sessions: [],
      };
    }

    // Map sessions to events
    for (const [sk, sd] of Object.entries(sesiones)) {
      const info = {
        session_id: String(sd.Id || ''), session_key: sk,
        date: sd.FechaSesion || '', date_text: sd.FechaSesionTxt || '',
        time: (sd.Horatxt || '').trim(),
        sala: sd.Sala || '', sala_full: (sd.SalaCompleto || '').trim(),
        capacity: sd.Aforo || 0, available: sd.Disponibles || 0,
        purchase_open: sd.CompraAbierta === 1,
        closed_reason: sd.RazonCompraCerradaTexto || '',
        numbered_seats: sd.Numerada === 1,
        single_price: sd.PrecioUnico === 1,
        format: sd.Formato || '',
        event_name: sd.NombreEvento || '',
      };
      for (const ev of Object.values(events)) {
        if (ev.name === info.event_name) {
          ev.sessions.push(info);
          break;
        }
      }
    }

    // For existing events: reuse cached metadata. Only fetch fichas for NEW events.
    const prevEvMap = {};
    for (const pe of prevData.events || []) prevEvMap[pe.evento_id] = pe;

    const newEventIds = [];
    for (const ev of Object.values(events)) {
      const cached = prevEvMap[ev.evento_id];
      if (cached && cached.director) {
        // Reuse cached metadata
        ev.year = cached.year;
        ev.duration_min = cached.duration_min;
        ev.director = cached.director;
        ev.cast = cached.cast;
        ev.genre = cached.genre;
        ev.age_rating = cached.age_rating;
        ev.price_eur = cached.price_eur;
        ev.poster_local = cached.poster_local;
        ev.poster_proxy = cached.poster_proxy;
      } else {
        newEventIds.push(ev.evento_id);
      }
      // Set poster paths
      if (ev.poster_v && !ev.poster_local) {
        const fname = ev.poster_v.split('/').pop().replace('.jpg', '.webp').replace('.png', '.webp');
        ev.poster_local = `img/${fname}`;
        ev.poster_proxy = `/img/proxy?path=${encodeURIComponent(ev.poster_v)}`;
      }
    }

    // Only fetch fichas for genuinely new events
    if (newEventIds.length > 0) {
      log.changes.push(`ℹ️ Fetching metadata for ${newEventIds.length} new event(s)`);
    }
    for (const eid of newEventIds) {
      try {
        const { text: fhtml } = await siteRequest('GET', `/index?pag=ficha&evento=${eid}`);

        const year = fhtml.match(/<b>Año:\s*<\/b>(\d{4})/)?.[1] || '';
        const dur = fhtml.match(/<b>Duración:\s*<\/b>\s*(\d+)/)?.[1];
        const dir = fhtml.match(/<b>Director:\s*<\/b>\s*([^<]+)/)?.[1]?.trim() || '';
        const genre = fhtml.match(/<b>Género:\s*<\/b>\s*([^<]+)/)?.[1]?.trim() || '';
        const rating = fhtml.match(/class="(?:info-calif|no-borrar)"[^>]*>\s*([^<]+)/)?.[1]?.trim() || '';
        const prices = [...fhtml.matchAll(/class="precio"[^>]*>\s*(\d+)€/g)].map(m => parseInt(m[1]));

        for (const ev of Object.values(events)) {
          if (ev.evento_id === eid) {
            ev.year = year;
            ev.duration_min = dur ? parseInt(dur) : null;
            ev.director = dir;
            ev.genre = genre;
            ev.age_rating = rating;
            if (prices.length) ev.price_eur = prices[0];

            // Extra sessions from ficha page
            const fSessions = extractJson(fhtml, 's');
            for (const [fsk, fsd] of Object.entries(fSessions)) {
              const fsid = String(fsd.Id || '');
              if (!ev.sessions.some(s => s.session_id === fsid)) {
                ev.sessions.push({
                  session_id: fsid, session_key: fsk,
                  date: fsd.FechaSesion || '', date_text: fsd.FechaSesionTxt || '',
                  time: (fsd.Horatxt || '').trim(),
                  sala: fsd.Sala || '', sala_full: (fsd.SalaCompleto || '').trim(),
                  capacity: fsd.Aforo || 0, available: fsd.Disponibles || 0,
                  purchase_open: fsd.CompraAbierta === 1,
                  closed_reason: fsd.RazonCompraCerradaTexto || '',
                  format: fsd.Formato || '',
                  event_name: fsd.NombreEvento || '',
                });
              }
            }
            if (ev.poster_v) {
              const fname = ev.poster_v.split('/').pop().replace('.jpg', '.webp').replace('.png', '.webp');
              ev.poster_local = `img/${fname}`;
              ev.poster_proxy = `/img/proxy?path=${encodeURIComponent(ev.poster_v)}`;
            }
            break;
          }
        }
      } catch (e) {
        log.changes.push(`⚠️ ficha ${eid}: ${e.message}`);
      }
    }

    const evList = Object.values(events).sort((a, b) => a.name.localeCompare(b.name));
    const totalSessions = evList.reduce((sum, e) => sum + e.sessions.length, 0);
    const suspiciousDrop = detectSuspiciousEventDrop(prevData.events || [], evList);

    log.events = evList.length;
    log.sessions = totalSessions;

    if (suspiciousDrop) {
      log.status = 'guarded';
      log.guard = { type: 'partial_scrape', ...suspiciousDrop };
      log.changes.push(
        `🛡️ Suspected partial scrape: ${suspiciousDrop.nextCount} events vs ${suspiciousDrop.prevCount} previously (${suspiciousDrop.removedCount} removed, ${suspiciousDrop.addedCount} added). Keeping prior catalog and skipping notifications.`
      );
    } else {
      // Pre-warm poster cache so new films don't rely on frontend fallbacks
      let warmedPosters = 0;
      for (const ev of evList) {
        try {
          if (ev.poster_v) {
            const warmed = await warmImageCache(ev.poster_v, env);
            if (warmed) warmedPosters++;
          }
        } catch (e) {
          log.changes.push(`⚠️ poster ${ev.name}: ${e.message}`);
        }
      }
      if (warmedPosters > 0) {
        log.changes.push(`🖼️ Warmed ${warmedPosters} poster cache entr${warmedPosters === 1 ? 'y' : 'ies'}`);
      }

      // Detect changes
      const newEvents = new Set(evList.map(e => e.evento_id));
      for (const eid of newEvents) {
        if (!prevEvents.has(eid)) {
          const ev = evList.find(e => e.evento_id === eid);
          log.changes.push(`🎬 NEW: ${ev.name}`);
        }
      }
      for (const eid of prevEvents) {
        if (!newEvents.has(eid)) {
          const ev = prevData.events.find(e => e.evento_id === eid);
          log.changes.push(`🗑️ REMOVED: ${ev?.name || eid}`);
        }
      }

      // Check for sold-out changes
      for (const ev of evList) {
        const prevEv = prevData.events?.find(e => e.evento_id === ev.evento_id);
        if (!prevEv) continue;
        for (const s of ev.sessions) {
          const prevS = prevEv.sessions?.find(ps => ps.session_id === s.session_id);
          if (prevS?.purchase_open && !s.purchase_open) {
            log.changes.push(`🔴 SOLD OUT: ${ev.name} — ${s.date} ${s.time}`);
          }
        }
      }

      const output = {
        _meta: {
          scraped_at: new Date().toISOString(),
          source: `https://${SITE}`,
          total_events: evList.length,
          total_sessions: totalSessions,
        },
        events: evList,
      };

      // Write to KV
      await env.KV.put('data', JSON.stringify(output));
      await env.KV.put('refresh_meta', JSON.stringify(output._meta));
      await env.KV.put('allowed_poster_paths', JSON.stringify([...new Set(evList.map(ev => ev.poster_v).filter(Boolean))]));

      // Send Telegram notifications for important changes
      const importantChanges = (log.changes || []).filter(c => c.startsWith('🎬') || c.startsWith('🔴'));
      if (importantChanges.length > 0) {
        const hasToken = !!env.TELEGRAM_BOT_TOKEN;
        log.telegram = { hasToken, attempted: false };
        if (hasToken) {
          const msg = `📽️ *Phenomena Rápida*\n\n${importantChanges.join('\n')}`;
          try {
            log.telegram.attempted = true;
            const tgResp = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: env.TELEGRAM_CHAT_ID,
                message_thread_id: parseInt(env.TELEGRAM_TOPIC_ID),
                text: msg,
                parse_mode: 'Markdown',
              }),
            });
            const tgResult = await tgResp.json();
            log.telegram.ok = tgResult.ok;
            if (!tgResult.ok) log.telegram.error = tgResult.description;
          } catch (e) {
            log.telegram.error = e.message;
            log.changes.push(`⚠️ Telegram notify failed: ${e.message}`);
          }
        }
      }
    }
  } catch (e) {
    log.status = 'error';
    log.error = e.message;

    // Alert on repeated failures
    if (env.TELEGRAM_BOT_TOKEN) {
      const recentLogs = logs.slice(-3);
      const consecutiveErrors = recentLogs.filter(l => l.status === 'error').length;
      if (consecutiveErrors >= 2) {
        try {
          await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: env.TELEGRAM_CHAT_ID,
              message_thread_id: parseInt(env.TELEGRAM_TOPIC_ID),
              text: `⚠️ *Phenomena Refresh Failing*\n\n${e.message}\n\n3+ consecutive errors`,
              parse_mode: 'Markdown',
            }),
          });
        } catch (e2) {}
      }
    }
  }

  // Append log (keep last 100)
  logs.push(log);
  if (logs.length > 100) logs.splice(0, logs.length - 100);
  await env.KV.put('refresh_logs', JSON.stringify(logs));

  return log;
}

// ─── Router ───

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      const isAdminRoute = url.pathname === '/api/logs' || url.pathname === '/api/refresh';
      const corsOrigin = getCorsOrigin(request);
      return new Response(null, {
        headers: {
          ...(isAdminRoute || !corsOrigin ? {} : { 'Access-Control-Allow-Origin': corsOrigin, 'Vary': 'Origin' }),
          'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    // API routes
    if (url.pathname === '/api/checkout' && request.method === 'POST') {
      return handleCheckout(request);
    }
    if (url.pathname === '/api/availability-all') {
      return handleAvailabilityAll(request);
    }
    if (url.pathname.startsWith('/api/availability')) {
      return handleAvailability(request);
    }
    if (url.pathname === '/api/health') {
      return handleHealth(request, env);
    }
    if (url.pathname === '/api/logs') {
      if (request.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405, null);
      const authError = requireAdmin(request, env);
      if (authError) return authError;
      return handleLogs(env);
    }
    if (url.pathname === '/api/refresh') {
      if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, null);
      const authError = requireAdmin(request, env);
      if (authError) return authError;
      const log = await refreshData(env);
      return jsonResponse({ triggered: true, log }, 200, null);
    }
    if (url.pathname.startsWith('/img/proxy')) {
      return handleImageProxy(request, env);
    }

    // Everything else → static assets, EXCEPT data.json which comes from KV
    if (url.pathname === '/data.json') {
      const kvData = await env.KV.get('data');
      if (kvData) {
        const corsOrigin = getCorsOrigin(request);
        return new Response(kvData, {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=60',
            ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin, 'Vary': 'Origin' } : {}),
          },
        });
      }
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(refreshData(env));
  },
};
