// src/safe.ts
function safe(read) {
  try {
    return read();
  } catch {
    return;
  }
}
function safeRead(read) {
  return safe(() => ({ value: read() }));
}
function isThenable(value) {
  return typeof safe(() => value?.then) === "function";
}

// src/sdk-name.ts
var SDK_NAME = "@nekuda/webmcp-sdk";
var CONSOLE_PREFIX = `[${SDK_NAME}]`;
function print(scope, level, ...args) {
  const target = safe(() => scope.console);
  const method = safe(() => target?.[level]);
  if (typeof method === "function")
    safe(() => method.apply(target, args));
}
function notice(level, code, text, scope = globalThis) {
  print(scope, level, `${CONSOLE_PREFIX} ${code}: ${text}`);
}

// src/debug.ts
var DEBUG_SWITCH_KEY = "webmcp.sdk.debug";
var SWITCH = Symbol.for(DEBUG_SWITCH_KEY);
var DEBUG_ON = "debug_on";
var DEBUG_NOT_SENT = "debug_not_sent";
var DEBUG_REFUSED = "debug_refused";
function debugOn(scope = globalThis) {
  return safe(() => scope[SWITCH]) === true;
}
function turnDebugOn(scope = globalThis) {
  if (debugOn(scope))
    return;
  safe(() => Object.defineProperty(scope, SWITCH, {
    value: true,
    writable: false,
    configurable: true,
    enumerable: false
  }));
  if (!debugOn(scope)) {
    notice("error", DEBUG_REFUSED, "the page refused trackTools debug mode, so events are still sent.", scope);
    return;
  }
  notice("warn", DEBUG_ON, "trackTools debug mode is on, so no SDK of this release or later on this page sends an event; each one is printed instead. An older SDK copy still sends. To go live, remove `debug` and reload the page.", scope);
}
function printUnsent(scope, channel, events) {
  for (const event of events) {
    const record = event;
    const name = safe(() => String(record.event ?? record.eventName));
    print(scope, "info", `${CONSOLE_PREFIX} ${DEBUG_NOT_SENT}: ${channel} ${name}`, event);
  }
}

// src/user-agent-field.ts
var USER_AGENT_BACKEND_ONLY = "<sent to the keyed backend only>";
function withoutUserAgent(event) {
  if (!("userAgent" in event))
    return event;
  const { userAgent: _, ...rest } = event;
  return rest;
}
function withUserAgentMarker(event) {
  if (!("userAgent" in event))
    return event;
  return { ...withoutUserAgent(event), userAgent: USER_AGENT_BACKEND_ONLY };
}

// src/transport.ts
var INGEST_BASE = "https://ingest.nekuda.ai";
var DEFAULT_COLLECT_ENDPOINT = `${INGEST_BASE}/v1/collect`;
var DEFAULT_TELEMETRY_ENDPOINT = `${INGEST_BASE}/v1/telemetry`;
function tryFetch(scope, url, headers, json, onResponse, keepalive = true) {
  const f = scope.fetch;
  if (typeof f !== "function")
    return Promise.resolve();
  try {
    const result = f(url, {
      method: "POST",
      ...keepalive ? { keepalive: true } : {},
      headers,
      body: json
    });
    if (result && typeof result.then === "function") {
      return Promise.resolve(result).then((response) => onResponse?.(response)).catch(() => {});
    }
  } catch {}
  return Promise.resolve();
}
var HTTP_UNAUTHORIZED = 401;
var KEY_REJECTED_MESSAGE = `${CONSOLE_PREFIX} The configured publishable key was not accepted. Usage is still being recorded, but anonymously. Re-run Connect to restore attributed reporting.`;
var warnedScopes = new WeakSet;
function warnKeyRejected(scope) {
  if (warnedScopes.has(scope))
    return;
  warnedScopes.add(scope);
  const write = scope.console?.error;
  if (typeof write === "function")
    write.call(scope.console, KEY_REJECTED_MESSAGE);
}
function isUnauthorized(response) {
  return typeof response === "object" && response !== null && response.status === HTTP_UNAUTHORIZED;
}
function sendToCollect(event, config, scope = globalThis) {
  try {
    if (debugOn(scope)) {
      printUnsent(scope, "keyed", [withUserAgentMarker(event)]);
      return;
    }
    const json = JSON.stringify(event);
    if (json === undefined)
      return;
    const url = config.endpoint || DEFAULT_COLLECT_ENDPOINT;
    const headers = { "content-type": "application/json", "x-api-key": config.apiKey };
    tryFetch(scope, url, headers, json);
  } catch {}
}
var PAGE_BATCH_EVENT = "batch";
var PAGE_BATCH_EVENTS_KEY = "events";
function eventsOf(body) {
  const record = body;
  const members = record.event === PAGE_BATCH_EVENT ? record[PAGE_BATCH_EVENTS_KEY] : undefined;
  return Array.isArray(members) ? members : [body];
}
var TELEMETRY_CONTENT_TYPE = "text/plain";
var TELEMETRY_KEY_PARAM = "key";
var TELEMETRY_SENT_AT_KEY = "sent_at";
var TELEMETRY_SENT_AT_MAX_BYTES = JSON.stringify({ [TELEMETRY_SENT_AT_KEY]: new Date(8640000000000000).toISOString() }).length - 1;
function withTelemetryKey(base, apiKey) {
  try {
    const url = new URL(base);
    url.searchParams.set(TELEMETRY_KEY_PARAM, apiKey);
    return url.toString();
  } catch {
    return `${base}${base.includes("?") ? "&" : "?"}${TELEMETRY_KEY_PARAM}=${encodeURIComponent(apiKey)}`;
  }
}
function sendTelemetry(event, scope = globalThis, endpoint, apiKey, keepalive = true) {
  try {
    if (debugOn(scope)) {
      printUnsent(scope, "anonymous", eventsOf(event));
      return Promise.resolve();
    }
    const json = JSON.stringify({ ...event, [TELEMETRY_SENT_AT_KEY]: new Date().toISOString() });
    if (json === undefined)
      return Promise.resolve();
    const base = endpoint || DEFAULT_TELEMETRY_ENDPOINT;
    const headers = { "content-type": TELEMETRY_CONTENT_TYPE };
    const authenticated = typeof apiKey === "string" && apiKey.trim().length > 0;
    const url = authenticated ? withTelemetryKey(base, apiKey) : base;
    return tryFetch(scope, url, headers, json, authenticated ? (response) => {
      if (isUnauthorized(response))
        warnKeyRejected(scope);
    } : undefined, keepalive);
  } catch {
    return Promise.resolve();
  }
}
function sendContracts(event, scope = globalThis, endpoint, apiKey) {
  return sendTelemetry(event, scope, endpoint, apiKey, false);
}
var OTEL_LOGGER_NAME = "@nekuda/webmcp-sdk";
var OTEL_SEVERITY_INFO = 9;
async function defaultLoader() {
  try {
    const mod = await import("@opentelemetry/api-logs");
    return mod.logs ?? null;
  } catch {
    return null;
  }
}
var loaderCache = new WeakMap;
function loadCached(loadLogs) {
  let cached = loaderCache.get(loadLogs);
  if (cached === undefined) {
    cached = Promise.resolve().then(() => loadLogs()).then((api) => api ?? null).catch(() => null);
    loaderCache.set(loadLogs, cached);
  }
  return cached;
}
function emitOtelLog(event, loadLogs = defaultLoader) {
  if (debugOn(globalThis)) {
    printUnsent(globalThis, "OpenTelemetry", [event]);
    return Promise.resolve();
  }
  return loadCached(loadLogs).then((api) => {
    if (!api)
      return;
    try {
      api.getLogger(OTEL_LOGGER_NAME).emit({
        severityNumber: OTEL_SEVERITY_INFO,
        body: event,
        attributes: {
          "event.name": event.eventName,
          "tool.stable_key": event.toolStableKey,
          "call.id": event.callId
        }
      });
    } catch {}
  }).catch(() => {});
}

// src/tracking.ts
var SESSION_TIMEOUT_MS = 30 * 60 * 1000;
var ANON_NAMESPACE = "anon";
function fnv1a(input) {
  let hash = 2166136261;
  for (let i = 0;i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
function storageNamespace(apiKey) {
  if (!apiKey)
    return ANON_NAMESPACE;
  return fnv1a(apiKey);
}
var visitorKey = (ns) => `webmcp:${ns}:visitor_id`;
var sessionKey = (ns) => `webmcp:${ns}:session_id`;
var lastSeenKey = (ns) => `webmcp:${ns}:last_seen`;
var memoryVisitor = new Map;
var memorySession = new Map;
var MAX_ID_LENGTH = 64;
function usableId(value) {
  return value !== null && value.length > 0 && value.length <= MAX_ID_LENGTH;
}
function storage(kind) {
  try {
    return globalThis[kind] ?? null;
  } catch {
    return null;
  }
}
function readItem(store, key) {
  if (!store)
    return null;
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}
function writeItem(store, key, value) {
  if (!store)
    return false;
  try {
    store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
function fallbackId(cache, namespace, candidate) {
  const cached = cache.get(namespace);
  if (cached)
    return cached;
  cache.set(namespace, candidate);
  return candidate;
}
var idSequence = 0;
function fillPseudoRandom(bytes) {
  if (fillFromMathRandom(bytes))
    return;
  const seq = ++idSequence;
  for (let i = 0;i < bytes.length; i++)
    bytes[i] = seq >>> i % 4 * 8;
}
function fillFromMathRandom(bytes) {
  try {
    for (let i = 0;i < bytes.length; i++) {
      const draw = Math.random();
      if (typeof draw !== "number" || !(draw >= 0 && draw < 1))
        return false;
      bytes[i] = Math.floor(draw * 256);
    }
    return true;
  } catch {
    return false;
  }
}
function randomId() {
  const bytes = new Uint8Array(16);
  let filled = false;
  try {
    const c = globalThis.crypto;
    if (typeof c?.randomUUID === "function") {
      const uuid = c.randomUUID();
      if (typeof uuid === "string" && usableId(uuid))
        return uuid;
    }
    if (typeof c?.getRandomValues === "function") {
      c.getRandomValues(bytes);
      filled = true;
    }
  } catch {}
  if (!filled)
    fillPseudoRandom(bytes);
  const hex = Array.from(bytes, (byte, i) => {
    const v = i === 6 ? byte & 15 | 64 : i === 8 ? byte & 63 | 128 : byte;
    return v.toString(16).padStart(2, "0");
  }).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function getOrCreateVisitorId(namespace) {
  const store = storage("localStorage");
  const key = visitorKey(namespace);
  const existing = readItem(store, key);
  if (usableId(existing))
    return existing;
  const id = randomId();
  if (writeItem(store, key, id))
    return id;
  return fallbackId(memoryVisitor, namespace, id);
}
function nowMs() {
  try {
    const now = Date.now();
    return typeof now === "number" && Number.isFinite(now) ? now : undefined;
  } catch {
    return;
  }
}
function getOrCreateSessionId(namespace) {
  const store = storage("sessionStorage");
  const now = nowMs();
  const existing = readItem(store, sessionKey(namespace));
  const lastSeen = Number(readItem(store, lastSeenKey(namespace)));
  const elapsed = now === undefined ? Number.NaN : now - lastSeen;
  const active = usableId(existing) && Number.isFinite(lastSeen) && elapsed >= 0 && elapsed < SESSION_TIMEOUT_MS;
  const id = active ? existing : randomId();
  const persisted = writeItem(store, sessionKey(namespace), id) && (now === undefined || writeItem(store, lastSeenKey(namespace), String(now)));
  if (persisted)
    return id;
  return fallbackId(memorySession, namespace, id);
}
function resolveSessionId(options, namespace) {
  try {
    const supplied = options.sessionId;
    if (typeof supplied === "string" && usableId(supplied))
      return supplied;
  } catch {}
  return getOrCreateSessionId(namespace);
}
function trackingOutputs(options) {
  try {
    if (!options || options.disabled)
      return { toBackend: false, toOtel: false };
    return {
      toBackend: typeof options.apiKey === "string" && options.apiKey.trim().length > 0,
      toOtel: options.otel === true
    };
  } catch {
    return { toBackend: false, toOtel: false };
  }
}
function pageFields() {
  const fields = {};
  try {
    const ua = globalThis.navigator?.userAgent;
    if (typeof ua === "string" && ua.length > 0) {
      fields.userAgent = sliceToBytes(ua, MAX_PAGE_FIELD_BYTES);
    }
    const loc = globalThis.location;
    if (loc) {
      if (loc.origin)
        fields.siteOrigin = loc.origin;
      if (loc.href)
        fields.url = loc.href;
      if (loc.pathname)
        fields.path = loc.pathname;
    }
    const doc = globalThis.document;
    if (doc) {
      if (doc.referrer !== undefined)
        fields.referrer = doc.referrer;
      if (doc.title !== undefined)
        fields.title = doc.title;
    }
  } catch {}
  return fields;
}
function errorMessage(error) {
  try {
    const read = error instanceof Error ? error.message : String(error);
    return typeof read === "string" ? read : "";
  } catch {
    return "";
  }
}
function buildEventPayload(params) {
  return {
    eventId: randomId(),
    visitorId: params.visitorId,
    sessionId: params.sessionId,
    eventName: params.eventName,
    ts: new Date().toISOString(),
    ...pageFields(),
    ...params.data,
    ...isSyntheticTester() ? { syntheticTester: true } : {}
  };
}
function isSyntheticTester() {
  try {
    return /^nekuda-synthetic-tester\/[0-9]/i.test(globalThis.navigator?.userAgent ?? "");
  } catch {
    return false;
  }
}
var MAX_EVENT_BYTES = 64 * 1024;
var MAX_ERROR_BYTES = 16 * 1024;
var TRUNCATABLE = ["response", "input", "error"];
var PAGE_STRINGS = ["url", "referrer", "title", "path", "siteOrigin", "userAgent"];
var MAX_PAGE_FIELD_BYTES = 4 * 1024;
var TOOL_ENTRY_KEPT = [
  "stableKey",
  "name",
  "outcome",
  "schemaHash",
  "source",
  "intent",
  "registeredBy"
];
function isMarker(value) {
  return typeof value === "object" && value !== null && value.__truncated === true;
}
function byteLength(json) {
  try {
    const TE = globalThis.TextEncoder;
    if (typeof TE === "function")
      return new TE().encode(json).length;
  } catch {}
  return json.length;
}
function escapedByteLength(value) {
  return byteLength(JSON.stringify(value)) - 2;
}
function sliceToBytes(value, maxBytes) {
  if (escapedByteLength(value) <= maxBytes)
    return value;
  const g = globalThis;
  try {
    if (typeof g.TextEncoder === "function" && typeof g.TextDecoder === "function") {
      const bytes = new g.TextEncoder().encode(value);
      const decoder = new g.TextDecoder("utf-8");
      const decode = (end) => {
        const s = decoder.decode(bytes.subarray(0, end));
        return s.endsWith("�") ? s.slice(0, -1) : s;
      };
      let lo = 0;
      let hi = Math.min(bytes.length, maxBytes);
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (escapedByteLength(decode(mid)) <= maxBytes)
          lo = mid;
        else
          hi = mid - 1;
      }
      return decode(lo);
    }
  } catch {}
  return value.slice(0, Math.floor(maxBytes / 6));
}
function serializedBytes(value) {
  return fieldBytes(value) ?? undefined;
}
function fieldBytes(value) {
  let json;
  try {
    json = JSON.stringify(value);
  } catch {
    return null;
  }
  return json === undefined ? 0 : byteLength(json);
}
function underLimit(event, reserve) {
  const size = fieldBytes(event);
  return size !== null && size + reserve < MAX_EVENT_BYTES;
}
function stripToolEntry(entry) {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry))
    return entry;
  const kept = {};
  for (const key of TOOL_ENTRY_KEPT) {
    const value = entry[key];
    if (value !== undefined)
      kept[key] = value;
  }
  return kept;
}
function boundTools(bounded, reserve) {
  const tools = bounded.tools;
  if (!Array.isArray(tools))
    return;
  bounded.tools = tools.map(stripToolEntry);
  if (underLimit(bounded, reserve))
    return;
  bounded.tools = {
    __truncated: true,
    originalBytes: fieldBytes(tools) ?? 0,
    toolCount: tools.length
  };
  const registeredBy = sharedRegisteredBy(tools);
  if (registeredBy !== undefined && bounded.registeredBy === undefined) {
    bounded.registeredBy = registeredBy;
  }
}
function sharedRegisteredBy(tools) {
  let shared;
  for (const entry of tools) {
    const value = typeof entry === "object" && entry !== null ? entry.registeredBy : undefined;
    if (value === undefined || shared !== undefined && value !== shared)
      return;
    shared = value;
  }
  return shared;
}
function boundEventPayload(event, reserveBytes = 0) {
  try {
    if (underLimit(event, reserveBytes))
      return event;
    return bound(event, reserveBytes);
  } catch {
    return event;
  }
}
function bound(event, reserve) {
  const bounded = { ...event };
  for (const field of TRUNCATABLE) {
    if (field in bounded && fieldBytes(bounded[field]) === null) {
      bounded[field] = { __truncated: true, originalBytes: 0 };
    }
  }
  for (const field of ["response", "input"]) {
    if (underLimit(bounded, reserve))
      return bounded;
    if (field in bounded && !isMarker(bounded[field])) {
      bounded[field] = { __truncated: true, originalBytes: fieldBytes(bounded[field]) ?? 0 };
    }
  }
  if (underLimit(bounded, reserve))
    return bounded;
  if ("error" in bounded && !isMarker(bounded.error)) {
    const err = bounded.error;
    bounded.error = typeof err === "string" ? sliceToBytes(err, MAX_ERROR_BYTES) : { __truncated: true, originalBytes: fieldBytes(err) ?? 0 };
  }
  if (!underLimit(bounded, reserve))
    boundTools(bounded, reserve);
  for (const field of PAGE_STRINGS) {
    if (underLimit(bounded, reserve))
      return bounded;
    const value = bounded[field];
    if (typeof value === "string")
      bounded[field] = sliceToBytes(value, MAX_PAGE_FIELD_BYTES);
  }
  return bounded;
}
var defaultSinks = { sendToCollect, emitOtelLog };
function track(options, eventName, data, sinks = defaultSinks) {
  try {
    const { toBackend, toOtel } = trackingOutputs(options);
    if (!toBackend && !toOtel)
      return;
    const namespace = storageNamespace(options.apiKey);
    const event = boundEventPayload(buildEventPayload({
      visitorId: getOrCreateVisitorId(namespace),
      sessionId: resolveSessionId(options, namespace),
      eventName,
      data
    }));
    if (toBackend) {
      sinks.sendToCollect(event, {
        apiKey: options.apiKey,
        ...options.endpoint !== undefined ? { endpoint: options.endpoint } : {}
      });
    }
    if (toOtel)
      sinks.emitOtelLog(withoutUserAgent(event));
  } catch {}
}

// src/tracked-key.ts
var TRACKED_KEY_NAMESPACE = "tracked";
var NON_SLUG_CHARACTER = /[^a-z0-9_]/gu;
function slugOf(name) {
  return name.replace(/[A-Z]/g, (letter) => letter.toLowerCase()).replace(NON_SLUG_CHARACTER, "_");
}
function deriveTrackedKey(name) {
  return `${TRACKED_KEY_NAMESPACE}.${slugOf(name)}_${fnv1a(name)}`;
}
function trackedKeyIndex() {
  const keyOf = new Map;
  const namesByKey = new Map;
  return {
    add(name) {
      if (keyOf.has(name))
        return;
      const key = deriveTrackedKey(name);
      keyOf.set(name, key);
      const holders = namesByKey.get(key);
      if (holders)
        holders.push(name);
      else
        namesByKey.set(key, [name]);
    },
    has: (name) => keyOf.has(name),
    get(name) {
      const key = keyOf.get(name);
      if (key === undefined)
        return;
      const holders = namesByKey.get(key) ?? [name];
      return holders.length === 1 ? { kind: "keyed", key } : { kind: "collision", key, names: [...holders] };
    }
  };
}

// src/define.ts
var NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;
var STABLE_KEY_PATTERN = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/;
var MAX_KEY_LENGTH = 1024;
var TOOL_SOURCES = ["scanner_generated", "merchant_authored"];
var TOOL_INTENTS = ["answer", "act", "transact"];
function fail(field, problem) {
  throw new TypeError(`defineTool: ${field} ${problem}`);
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function defineTool(definition) {
  const { stableKey, description, inputSchema, execute } = definition;
  if (typeof stableKey !== "string" || stableKey.trim() === "") {
    fail("stableKey", "must be a non-empty string (the durable identity the platform keys on)");
  }
  if (stableKey.length > MAX_KEY_LENGTH) {
    fail("stableKey", `must be at most ${MAX_KEY_LENGTH} characters`);
  }
  if (!STABLE_KEY_PATTERN.test(stableKey)) {
    fail("stableKey", `must be dot-namespaced "domain.action" — [a-z0-9_]+ segments (2 or more) joined by "." (got ${JSON.stringify(stableKey)})`);
  }
  if (stableKey.startsWith(`${TRACKED_KEY_NAMESPACE}.`)) {
    fail("stableKey", `must not start with "${TRACKED_KEY_NAMESPACE}." — that namespace is reserved for tools the SDK did not build (got ${JSON.stringify(stableKey)})`);
  }
  const nameOmitted = definition.name === undefined;
  const name = definition.name ?? stableKey;
  if (typeof name !== "string" || !NAME_PATTERN.test(name)) {
    const field = nameOmitted ? "stableKey" : "name";
    const suffix = nameOmitted ? " when used as the wire name, or set an explicit `name`" : "";
    fail(field, `must be 1-128 chars of [A-Za-z0-9_\\-.]${suffix} (got ${JSON.stringify(name)})`);
  }
  if (typeof description !== "string" || description.trim() === "") {
    fail("description", "must be a non-empty string");
  }
  if (inputSchema !== undefined && !isPlainObject(inputSchema)) {
    fail("inputSchema", "must be a plain JSON Schema object when present");
  }
  if (definition.version !== undefined && (typeof definition.version !== "string" || definition.version.trim() === "")) {
    fail("version", "must be a non-empty string when present");
  }
  if (typeof definition.version === "string" && definition.version.length > MAX_KEY_LENGTH) {
    fail("version", `must be at most ${MAX_KEY_LENGTH} characters`);
  }
  for (const [field, allowed] of [
    ["source", TOOL_SOURCES],
    ["intent", TOOL_INTENTS]
  ]) {
    const value = definition[field];
    if (value !== undefined && !allowed.includes(value)) {
      fail(field, `must be one of ${allowed.join(" | ")} when present (got ${JSON.stringify(value)})`);
    }
  }
  if (definition.pages !== undefined && (!Array.isArray(definition.pages) || definition.pages.some((page) => typeof page !== "string"))) {
    fail("pages", "must be an array of strings when present");
  }
  if (definition.exposedTo !== undefined && (!Array.isArray(definition.exposedTo) || definition.exposedTo.some((origin) => typeof origin !== "string"))) {
    fail("exposedTo", "must be an array of origin strings when present");
  }
  if (typeof execute !== "function") {
    fail("execute", "must be a function");
  }
  const tool = { name, execute: execute.bind(definition) };
  for (const field of COPIED_FIELDS) {
    const value = definition[field];
    if (value !== undefined)
      tool[field] = value;
  }
  return Object.freeze(tool);
}
var COPIED_FIELDS = [
  "stableKey",
  "title",
  "description",
  "inputSchema",
  "annotations",
  "pages",
  "exposedTo",
  "version",
  "source",
  "intent",
  "inventoryToolId",
  "contractRevision"
];
// src/pages.ts
function pageKey(value) {
  const [path = "", hash = ""] = value.split("#", 2);
  const key = path.split("?", 1)[0] + (hash.startsWith("/") ? `#${hash.split("?", 1)[0]}` : "");
  return `/${key}`.replace(/\/+/g, "/").replace(/\/$/, "");
}
function matchPage(patterns, location) {
  if (!patterns?.length)
    return true;
  const key = pageKey(location);
  return patterns.some((pattern) => {
    if (!pattern)
      return true;
    const expression = pageKey(pattern).split("/").slice(1).map((segment) => segment === "**" ? "(?:/[^/]+)*" : `/${segment.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")}`).join("");
    return new RegExp(`^${expression}$`).test(key);
  });
}
function currentPageKey() {
  try {
    const location = globalThis.location;
    return location ? `${location.pathname}${location.search ?? ""}${location.hash ?? ""}` : undefined;
  } catch {
    return;
  }
}
var ROUTES = Symbol.for("webmcp.sdk.page-routes");
function onPageChange(listener) {
  if (typeof globalThis.addEventListener !== "function" || !globalThis.history)
    return () => {};
  const history = globalThis.history;
  let routes = history[ROUTES];
  if (!routes) {
    const listeners = new Set;
    routes = {
      listeners,
      notify: () => {
        for (const run of listeners) {
          try {
            run();
          } catch {}
        }
      }
    };
    const { notify } = routes;
    let patched = false;
    try {
      history[ROUTES] = routes;
      for (const method of ["pushState", "replaceState"]) {
        const original = history[method];
        history[method] = function(...args) {
          const result = original.apply(this, args);
          if (patched)
            notify();
          return result;
        };
      }
      patched = true;
    } catch {}
  }
  const { listeners, notify } = routes;
  if (listeners.size === 0) {
    globalThis.addEventListener("popstate", notify);
    globalThis.addEventListener("hashchange", notify);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      globalThis.removeEventListener("popstate", notify);
      globalThis.removeEventListener("hashchange", notify);
    }
  };
}
// src/error-kind.ts
var NOT_A_LIST = "not_a_list";
var UNKNOWN_ERROR_KIND = "unknown";
function errorKind(cause) {
  let name;
  try {
    name = cause?.name;
  } catch {
    return UNKNOWN_ERROR_KIND;
  }
  return typeof name === "string" && /^[A-Za-z]{1,64}$/.test(name) ? name : UNKNOWN_ERROR_KIND;
}
function readToolList(surface) {
  return Promise.resolve().then(() => surface.getTools()).then((list) => Array.isArray(list) ? { list } : { failed: NOT_A_LIST }, (error) => ({ failed: errorKind(error) }));
}

// src/listed-contract.ts
var CONTRACT_ANNOTATION_KEYS = ["readOnlyHint", "untrustedContentHint"];
function listedContract(entry) {
  const contract = { name: entry.name };
  if (typeof entry.description === "string")
    contract.description = entry.description;
  const schema = contractSchema(entry.inputSchema);
  if (schema !== undefined)
    contract.inputSchema = schema;
  const annotations = contractAnnotations(entry.annotations);
  if (annotations !== undefined)
    contract.annotations = annotations;
  return contract;
}
function contractSchema(value) {
  if (value === null)
    return;
  if (typeof value !== "string")
    return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
function contractAnnotations(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return;
  const listed = value;
  const kept = {};
  for (const key of CONTRACT_ANNOTATION_KEYS) {
    const hint = listed[key];
    if (hint !== undefined && hint !== false)
      kept[key] = hint;
  }
  return Object.keys(kept).length > 0 ? kept : undefined;
}

// src/live-contract-hash.ts
class Unserializable extends Error {
}
function isUnrepresentable(value) {
  return value === undefined || typeof value === "function" || typeof value === "symbol";
}
function serialize(value, ancestors) {
  if (value === null)
    return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number":
      return Number.isFinite(value) ? JSON.stringify(value) : "null";
    case "boolean":
      return value ? "true" : "false";
    case "bigint":
      throw new Unserializable("bigint");
    case "object":
      break;
    default:
      return "null";
  }
  const node = value;
  if (ancestors.has(node))
    throw new Unserializable("cycle");
  ancestors.add(node);
  try {
    if (Array.isArray(node)) {
      const items = Array.from(node, (item) => isUnrepresentable(item) ? "null" : serialize(item, ancestors));
      return `[${items.join(",")}]`;
    }
    const members = Object.keys(node).filter((key) => !isUnrepresentable(node[key])).sort((a, b) => a < b ? -1 : a > b ? 1 : 0).map((key) => `${JSON.stringify(key)}:${serialize(node[key], ancestors)}`);
    return `{${members.join(",")}}`;
  } finally {
    ancestors.delete(node);
  }
}
function canonicalLiveContractJson(input) {
  const fields = {
    annotations: input.annotations,
    description: input.description,
    inputSchema: input.inputSchema,
    name: input.name
  };
  try {
    return serialize(fields, new Set);
  } catch (err) {
    if (err instanceof Unserializable)
      return null;
    throw err;
  }
}

// src/spec.ts
function resolveModelContext(scope = globalThis) {
  return scope.document?.modelContext;
}
function surfaceIn(scope) {
  return resolveModelContext(scope);
}

// src/telemetry-context.ts
function guarded(read) {
  try {
    return read();
  } catch {
    return;
  }
}
var MAX_ROUTE_SEGMENTS = 8;
var MAX_ROUTE_BYTES = 256;
var MAX_INPUT_CHARS = 4096;
var OVERFLOW_SEGMENT = "*";
var DIGITS_SEGMENT = /^\d+$/;
var UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var HEX_SEGMENT = /^[0-9a-f]{12,}$/i;
var SLUG_SEGMENT = /^[A-Za-z0-9]+(?:[-_.][A-Za-z0-9]+)*$/;
var MAX_SLUG_CHARS = 32;
var OPAQUE_SEGMENT = ":token";
var MAX_UPPERCASE_SHARE = 0.3;
function uppercaseHeavy(run) {
  let uppercase = 0;
  for (let i = 0;i < run.length; i += 1) {
    const code = run.charCodeAt(i);
    if (code >= 65 && code <= 90)
      uppercase += 1;
  }
  return uppercase > run.length * MAX_UPPERCASE_SHARE;
}
var MIN_OPAQUE_SLUG_CHARS = 12;
function pathSegments(pathname) {
  const capped = pathname.length > MAX_INPUT_CHARS ? pathname.slice(0, MAX_INPUT_CHARS) : pathname;
  const cut = capped.search(/[?#]/);
  return (cut === -1 ? capped : capped.slice(0, cut)).split("/").filter((s) => s.length > 0);
}
function templateSegment(segment) {
  if (DIGITS_SEGMENT.test(segment))
    return ":id";
  if (UUID_SEGMENT.test(segment))
    return ":uuid";
  if (HEX_SEGMENT.test(segment))
    return ":hash";
  if (segment.length > MAX_SLUG_CHARS || !SLUG_SEGMENT.test(segment))
    return OPAQUE_SEGMENT;
  if (segment.length >= MIN_OPAQUE_SLUG_CHARS && uppercaseHeavy(segment))
    return OPAQUE_SEGMENT;
  return segment;
}
function routeTemplate(pathname) {
  if (typeof pathname !== "string")
    return;
  const segments = pathSegments(pathname);
  const kept = segments.slice(0, MAX_ROUTE_SEGMENTS).map(templateSegment);
  if (segments.length > MAX_ROUTE_SEGMENTS)
    kept.push(OVERFLOW_SEGMENT);
  return sliceToBytes(`/${kept.join("/")}`, MAX_ROUTE_BYTES);
}
function segmentCount(pathname) {
  if (typeof pathname !== "string")
    return;
  return pathSegments(pathname).length;
}
var AI_ASSISTANT_HOSTS = [
  "chatgpt.com",
  "chat.openai.com",
  "openai.com",
  "claude.ai",
  "anthropic.com",
  "perplexity.ai",
  "gemini.google.com",
  "bard.google.com",
  "aistudio.google.com",
  "copilot.microsoft.com",
  "grok.com",
  "x.ai",
  "deepseek.com",
  "meta.ai",
  "poe.com",
  "you.com"
];
var SEARCH_HOSTS = [
  "bing.com",
  "duckduckgo.com",
  "baidu.com",
  "ecosia.org",
  "search.brave.com",
  "startpage.com",
  "qwant.com",
  "naver.com"
];
var SEARCH_PATTERNS = [
  /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2,3})?$/,
  /(^|\.)yahoo\.[a-z]{2,3}(\.[a-z]{2,3})?$/,
  /(^|\.)yandex\.[a-z]{2,3}(\.[a-z]{2,3})?$/
];
var SOCIAL_HOSTS = [
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "t.co",
  "linkedin.com",
  "reddit.com",
  "pinterest.com",
  "tiktok.com",
  "youtube.com",
  "threads.net",
  "snapchat.com",
  "tumblr.com",
  "discord.com",
  "t.me",
  "whatsapp.com"
];
function hostMatches(hostname, domains) {
  return domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}
function parsedUrl(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_INPUT_CHARS) {
    return;
  }
  return guarded(() => new URL(value));
}
function originOf(value) {
  return parsedUrl(value)?.origin.toLowerCase();
}
function referrerClass(referrer, origin) {
  if (typeof referrer !== "string" || referrer.trim().length === 0)
    return "direct";
  const url = parsedUrl(referrer);
  if (url === undefined)
    return "other";
  const referrerOrigin = url.origin.toLowerCase();
  const own = originOf(origin) ?? (typeof origin === "string" ? origin.trim().toLowerCase() : "");
  if (own.length > 0 && referrerOrigin === own)
    return "internal";
  const hostname = guarded(() => url.hostname.toLowerCase()) ?? "";
  if (hostMatches(hostname, AI_ASSISTANT_HOSTS))
    return "ai_assistant";
  if (hostMatches(hostname, SEARCH_HOSTS))
    return "search";
  if (SEARCH_PATTERNS.some((pattern) => pattern.test(hostname)))
    return "search";
  if (hostMatches(hostname, SOCIAL_HOSTS))
    return "social";
  return "other";
}
var MOBILE_MAX_WIDTH = 767;
function formFactor(scope = globalThis) {
  const g = scope;
  const hint = guarded(() => g.navigator?.userAgentData?.mobile);
  if (typeof hint === "boolean")
    return hint ? "mobile" : "desktop";
  const query = guarded(() => g.matchMedia);
  if (typeof query === "function") {
    const media = guarded(() => query.call(g, "(pointer: coarse) and (hover: none)"));
    const coarse = guarded(() => media?.matches);
    if (typeof coarse === "boolean")
      return coarse ? "mobile" : "desktop";
  }
  const width = guarded(() => g.screen?.width);
  if (typeof width === "number" && Number.isFinite(width)) {
    return width <= MOBILE_MAX_WIDTH ? "mobile" : "desktop";
  }
  return;
}
var PRIMARY_SUBTAG = /^[a-z]{2,3}$/;
function languageSubtag(scope = globalThis) {
  const g = scope;
  const primary = guarded(() => g.navigator?.language);
  const list = guarded(() => g.navigator?.languages);
  const raw = typeof primary === "string" ? primary : Array.isArray(list) ? list[0] : undefined;
  if (typeof raw !== "string")
    return;
  const subtag = raw.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return PRIMARY_SUBTAG.test(subtag) ? subtag : undefined;
}
var RUNTIME_TOKENS = [
  [/chatgpt|gptbot|oai-searchbot|openai/, "chatgpt"],
  [/claude|anthropic/, "claude"],
  [/perplexity/, "perplexity"],
  [/headless|puppeteer|playwright|selenium|phantomjs/, "headless"]
];
var MAX_UA_SCAN = 1024;
function agentRuntime(scope = globalThis) {
  const g = scope;
  const ua = guarded(() => g.navigator?.userAgent);
  const tokens = typeof ua === "string" ? ua.slice(0, MAX_UA_SCAN).toLowerCase() : undefined;
  if (tokens !== undefined) {
    for (const [pattern, runtime] of RUNTIME_TOKENS) {
      if (pattern.test(tokens))
        return runtime;
    }
  }
  if (guarded(() => g.navigator?.webdriver) === true)
    return "headless";
  return tokens === undefined ? "unknown" : "browser";
}
function frameContext(scope = globalThis) {
  const g = scope;
  const self = guarded(() => g.self);
  if (self === undefined)
    return;
  let top;
  try {
    top = g.top;
  } catch {
    return "iframe";
  }
  if (top === undefined)
    return;
  return top === self ? "top" : "iframe";
}
var PAGE_VISIBILITIES = ["visible", "hidden", "prerender"];
function visibility(scope = globalThis) {
  const g = scope;
  const state = guarded(() => g.document?.visibilityState);
  return PAGE_VISIBILITIES.find((known) => known === state);
}
var PROVENANCE_MARKER = "__webmcpProvenance";
var CLAIMABLE_PROVENANCES = ["polyfill", "extension"];
var MAX_SPEC_VERSION_BYTES = 64;
function surfaceInfo(scope = globalThis) {
  const surface = guarded(() => resolveModelContext(scope));
  if (!surface)
    return { available: false, provenance: "none" };
  const declared = surface;
  const claimed = guarded(() => declared[PROVENANCE_MARKER]);
  const version = guarded(() => declared.specVersion);
  return {
    available: true,
    provenance: CLAIMABLE_PROVENANCES.find((known) => known === claimed) ?? "native",
    global: "document.modelContext",
    ...typeof version === "string" && version.length > 0 ? { specVersion: sliceToBytes(version, MAX_SPEC_VERSION_BYTES) } : {}
  };
}
function timeSinceNavigation(scope = globalThis) {
  const perf = guarded(() => scope.performance);
  const now = guarded(() => {
    const clock = perf?.now;
    return typeof clock === "function" ? clock.call(perf) : undefined;
  });
  if (isElapsed(now))
    return Math.round(now);
  const origin = guarded(() => perf?.timeOrigin);
  if (typeof origin !== "number" || !Number.isFinite(origin) || origin <= 0)
    return;
  const elapsed = guarded(() => Date.now() - origin);
  return isElapsed(elapsed) ? Math.round(elapsed) : undefined;
}
function isElapsed(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
var INIT_AT = timeSinceNavigation();
function initAt() {
  return INIT_AT;
}
function timeSinceInit(scope = globalThis) {
  if (INIT_AT === undefined)
    return;
  const now = timeSinceNavigation(scope);
  return now === undefined ? undefined : Math.max(0, Math.round(now - INIT_AT));
}
var SESSION_ID = randomId();
function sessionId() {
  return SESSION_ID;
}

// src/telemetry-events.ts
var ANNOTATION_HINTS = ["readOnlyHint", "untrustedContentHint"];
var TELEMETRY_SCHEMA_VERSION = 2;
var INSTALL_MODES = ["npm", "cdn_snippet"];

// src/telemetry-fields.ts
var TELEMETRY_FIELDS = {
  schema: true,
  event: true,
  ts: true,
  sessionId: true,
  sampleRate: true,
  "sdk.name": true,
  "sdk.version": true,
  "sdk.installMode": true,
  "surface.available": true,
  "surface.provenance": true,
  "surface.global": true,
  "surface.specVersion": true,
  "page.routeTemplate": true,
  "page.segmentCount": true,
  "page.referrerClass": true,
  "page.frameContext": true,
  "page.visibility": true,
  "client.agentRuntime": true,
  "client.browser": true,
  "client.browserMajor": true,
  "client.formFactor": true,
  "client.language": true,
  timeToInitMs: true,
  registrationIndex: true,
  trigger: true,
  settleMs: true,
  "config.trackingEnabled": true,
  "config.otelEnabled": true,
  "config.customEndpoint": true,
  "config.builtWith": true,
  registeredBy: true,
  trialScript: true,
  trialSurface: true,
  tools: true,
  callId: true,
  callIndex: true,
  toolCallIndex: true,
  precededBy: true,
  tool: true,
  outcome: true,
  durationMs: true,
  "response.bytes": true,
  "response.contentBlocks": true,
  "response.isError": true,
  errorClass: true,
  errorSignature: true,
  contract: true,
  routeTemplate: true,
  timeSinceInitMs: true,
  agentRuntime: true
};
var TELEMETRY_TOOL_FIELDS = {
  name: true,
  stableKey: true,
  inventoryToolId: true,
  contractRevision: true,
  version: true,
  schemaHash: true,
  source: true,
  intent: true,
  outcome: true,
  failureSignature: true,
  registeredBy: true,
  descriptionLength: true,
  annotations: true,
  paramCount: true,
  requiredCount: true,
  freeTextParamCount: true,
  enumParamCount: true,
  maxDepth: true,
  describedParamCount: true
};

// src/tool-metrics.ts
var MAX_CANONICAL_DEPTH = 12;
var MAX_CANONICAL_NODES = 4096;
var MAX_CANONICAL_STRING = 1024;
var MAX_PARAMS = 512;
var MAX_SCHEMA_DEPTH = 12;
var MAX_SCHEMA_NODES = 4096;
var DEPTH_TOKEN = '"~depth"';
var CYCLE_TOKEN = '"~cycle"';
var BUDGET_TOKEN = '"~budget"';
function guarded2(read) {
  try {
    return read();
  } catch {
    return;
  }
}
function isSchemaObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function encodeString(value) {
  return JSON.stringify(value.length > MAX_CANONICAL_STRING ? value.slice(0, MAX_CANONICAL_STRING) : value);
}
function encode(value, depth, path, budget) {
  if (budget.nodes <= 0)
    return BUDGET_TOKEN;
  budget.nodes--;
  if (depth > MAX_CANONICAL_DEPTH)
    return DEPTH_TOKEN;
  switch (typeof value) {
    case "string":
      return encodeString(value);
    case "number":
      return Number.isFinite(value) ? String(value) : "null";
    case "boolean":
      return value ? "true" : "false";
    case "bigint":
      return encodeString(value.toString());
    case "object":
      break;
    default:
      return "null";
  }
  if (value === null)
    return "null";
  const container = value;
  if (path.has(container))
    return CYCLE_TOKEN;
  path.add(container);
  try {
    if (Array.isArray(value)) {
      const items = [];
      for (const item of value) {
        items.push(encode(item, depth + 1, path, budget));
        if (budget.nodes <= 0)
          break;
      }
      return `[${items.join(",")}]`;
    }
    const keys = guarded2(() => Object.keys(container)) ?? [];
    keys.sort();
    const entries = [];
    for (const key of keys) {
      const child = guarded2(() => container[key]);
      if (child === undefined || typeof child === "function" || typeof child === "symbol")
        continue;
      entries.push(`${encodeString(key)}:${encode(child, depth + 1, path, budget)}`);
      if (budget.nodes <= 0)
        break;
    }
    return `{${entries.join(",")}}`;
  } finally {
    path.delete(container);
  }
}
function canonicalize(value, depth = 0) {
  return encode(value, depth, new Set, { nodes: MAX_CANONICAL_NODES });
}
function schemaHash(inputSchema) {
  if (!isSchemaObject(inputSchema))
    return;
  const canonical = guarded2(() => canonicalize(inputSchema));
  return canonical === undefined ? undefined : fnv1a(canonical);
}
var ZERO_METRICS = {
  paramCount: 0,
  requiredCount: 0,
  freeTextParamCount: 0,
  enumParamCount: 0,
  maxDepth: 0,
  describedParamCount: 0
};
function clamp(count) {
  if (!Number.isFinite(count))
    return 0;
  return Math.max(0, Math.min(Math.trunc(count), MAX_PARAMS));
}
function childSchemas(schema) {
  const children = [];
  const props = guarded2(() => schema.properties);
  if (isSchemaObject(props)) {
    for (const key of (guarded2(() => Object.keys(props)) ?? []).slice(0, MAX_PARAMS)) {
      const child = guarded2(() => props[key]);
      if (isSchemaObject(child))
        children.push(child);
    }
  }
  const items = guarded2(() => schema.items);
  if (isSchemaObject(items))
    children.push(items);
  else if (Array.isArray(items)) {
    for (const item of items.slice(0, MAX_PARAMS)) {
      if (isSchemaObject(item))
        children.push(item);
    }
  }
  return children.slice(0, MAX_PARAMS);
}
function depthOf(schema, depth, path, budget) {
  if (depth >= MAX_SCHEMA_DEPTH || budget.nodes <= 0 || path.has(schema))
    return 0;
  budget.nodes--;
  path.add(schema);
  try {
    const children = childSchemas(schema);
    if (children.length === 0)
      return 0;
    let deepest = 0;
    for (const child of children) {
      deepest = Math.max(deepest, depthOf(child, depth + 1, path, budget));
      if (budget.nodes <= 0)
        break;
    }
    return 1 + deepest;
  } finally {
    path.delete(schema);
  }
}
function collect(schema) {
  const props = guarded2(() => schema.properties);
  const allKeys = isSchemaObject(props) ? guarded2(() => Object.keys(props)) ?? [] : [];
  let freeTextParamCount = 0;
  let enumParamCount = 0;
  let describedParamCount = 0;
  for (const key of allKeys.slice(0, MAX_PARAMS)) {
    const param = guarded2(() => props[key]);
    if (!isSchemaObject(param))
      continue;
    const hasEnum = Array.isArray(guarded2(() => param.enum));
    if (hasEnum)
      enumParamCount++;
    const type = guarded2(() => param.type);
    const format = guarded2(() => param.format);
    if (type === "string" && !hasEnum && typeof format !== "string")
      freeTextParamCount++;
    const description = guarded2(() => param.description);
    if (typeof description === "string" && description.trim() !== "")
      describedParamCount++;
  }
  const required = guarded2(() => schema.required);
  const requiredCount = Array.isArray(required) ? required.slice(0, MAX_PARAMS).filter((entry) => typeof entry === "string").length : 0;
  return {
    paramCount: clamp(allKeys.length),
    requiredCount: clamp(requiredCount),
    freeTextParamCount: clamp(freeTextParamCount),
    enumParamCount: clamp(enumParamCount),
    maxDepth: depthOf(schema, 0, new Set, { nodes: MAX_SCHEMA_NODES }),
    describedParamCount: clamp(describedParamCount)
  };
}
function shapeMetrics(inputSchema) {
  if (!isSchemaObject(inputSchema))
    return;
  return guarded2(() => collect(inputSchema)) ?? { ...ZERO_METRICS };
}

// src/telemetry.ts
var SDK_VERSION = "0.9.0";
var SDK_INSTALL_MODE = INSTALL_MODES.find((mode) => mode === (typeof __WEBMCP_INSTALL_MODE__ === "string" ? __WEBMCP_INSTALL_MODE__ : "")) ?? "npm";
function parseSampleRate(raw) {
  const rate = typeof raw === "string" ? Number(raw) : Number.NaN;
  return Number.isFinite(rate) && rate > 0 && rate < 1 ? rate : 1;
}
var SDK_TELEMETRY_SAMPLE_RATE = parseSampleRate(typeof __WEBMCP_TELEMETRY_SAMPLE_RATE__ === "string" ? __WEBMCP_TELEMETRY_SAMPLE_RATE__ : undefined);
var PAGE_LEVEL_EVENTS = new Set(["sdk_init", "tool_registration"]);
function pageSampled(sessionId, rate = SDK_TELEMETRY_SAMPLE_RATE) {
  if (rate >= 1)
    return true;
  return Number.parseInt(fnv1a(`sample:${sessionId}`), 16) / 4294967296 < rate;
}
function isFieldParent(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function gpcOptedOut(scope = globalThis) {
  return safe(() => scope.navigator?.globalPrivacyControl) === true;
}
function globalOptOut(scope) {
  return safe(() => scope.__WEBMCP_TELEMETRY__) === false;
}
function telemetryEnabled(option, scope = globalThis) {
  if (option === false)
    return false;
  if (globalOptOut(scope))
    return false;
  if (!isBrowserPage(scope))
    return false;
  return !gpcOptedOut(scope);
}
function isBrowserPage(scope = globalThis) {
  return safe(() => scope.document) !== undefined;
}
var GREASE_BRAND = /not[\W_]*a[\W_]*brand/i;
var MAX_BRAND_BYTES = 1024;
function brandInfo(brands) {
  if (!Array.isArray(brands))
    return {};
  const named = brands.filter((entry) => isFieldParent(entry) && typeof entry.brand === "string" && entry.brand.length > 0 && !GREASE_BRAND.test(entry.brand));
  const chosen = named.find((entry) => !/chromium/i.test(entry.brand)) ?? named[0];
  if (!chosen)
    return {};
  const major = Number.parseInt(String(chosen.version), 10);
  return {
    browser: sliceToBytes(chosen.brand, MAX_BRAND_BYTES),
    ...Number.isFinite(major) ? { browserMajor: major } : {}
  };
}
var MAX_ERROR_CLASS_BYTES = 256;
function errorClassOf(error) {
  const name = safe(() => error?.constructor?.name);
  if (typeof name !== "string" || name.length === 0)
    return null;
  return sliceToBytes(name, MAX_ERROR_CLASS_BYTES);
}
var MAX_ERROR_SIGNATURE_BYTES = 512;
var DIGIT_RUN = /\d+/g;
var QUOTED_LITERAL = /"[^\n]*"|`[^\n]*`|(^|[^A-Za-z])'[^\n]*'/g;
var LONG_RUN = /[A-Za-z0-9_+/-]{16,}={0,2}/g;
function isOpaque(run) {
  return /\d/.test(run) || uppercaseHeavy(run);
}
var EMAIL = /(^|\s)[^\s@]*@[^\s]*\.[A-Za-z]{2,24}[^\s]*/g;
var CUT_CANDIDATE = /("[^"\n]*"|`[^`\n]*`|(?:^|[^A-Za-z])'[^'\n]*')|"[^"\n]*$|`[^`\n]*$|(^|[^A-Za-z])'[^'\n]*$|(^|\s)[^\s@]*@[^\s]*$/g;
var URL_RUN = /[A-Za-z][A-Za-z0-9+.-]{0,15}:\/\/\S*/g;
var PATH_RUN = /(?:\/[A-Za-z0-9._~%+-]+){2,}(?:[?#]\S*)?/g;
function errorSignature(error) {
  if (error === undefined || error === null)
    return;
  const full = errorMessage(error);
  if (full.length === 0)
    return;
  const truncated = full.length > MAX_INPUT_CHARS;
  const sliced = truncated ? full.slice(0, MAX_INPUT_CHARS) : full;
  const closed = truncated ? sliced.replace(CUT_CANDIDATE, (match, closedLiteral, quote, email) => closedLiteral !== undefined ? match : `${quote ?? email ?? ""}*`) : sliced;
  const templated = closed.replace(QUOTED_LITERAL, (_match, before) => `${before ?? ""}*`).replace(URL_RUN, "*").replace(LONG_RUN, (run) => isOpaque(run) ? "*" : run).replace(EMAIL, "$1*").replace(PATH_RUN, "*").replace(DIGIT_RUN, "*");
  const capped = sliceToBytes(templated, MAX_ERROR_SIGNATURE_BYTES);
  return capped.length === 0 ? undefined : capped;
}
function browserBrand(scope) {
  const uaData = safe(() => scope.navigator?.userAgentData);
  return safe(() => brandInfo(uaData?.brands)) ?? {};
}
function pathname(scope) {
  return safe(() => scope.location?.pathname);
}
function pageContext(scope) {
  const g = scope;
  const path = pathname(scope);
  const template = routeTemplate(path);
  const segments = segmentCount(path);
  const frame = frameContext(scope);
  const state = visibility(scope);
  return {
    ...template !== undefined ? { routeTemplate: template } : {},
    ...segments !== undefined ? { segmentCount: segments } : {},
    referrerClass: referrerClass(safe(() => g.document?.referrer), safe(() => g.location?.origin)),
    ...frame !== undefined ? { frameContext: frame } : {},
    ...state !== undefined ? { visibility: state } : {}
  };
}
function clientContext(scope) {
  const factor = formFactor(scope);
  const language = languageSubtag(scope);
  return {
    agentRuntime: agentRuntime(scope),
    ...browserBrand(scope),
    ...factor !== undefined ? { formFactor: factor } : {},
    ...language !== undefined ? { language } : {}
  };
}
function buildInitEvent(params = {}) {
  const scope = params.scope ?? globalThis;
  const timeToInitMs = initAt();
  return {
    schema: TELEMETRY_SCHEMA_VERSION,
    event: "sdk_init",
    ts: new Date().toISOString(),
    sessionId: sessionId(),
    sdk: { name: SDK_NAME, version: SDK_VERSION, installMode: SDK_INSTALL_MODE },
    surface: surfaceInfo(scope),
    page: pageContext(scope),
    client: clientContext(scope),
    ...timeToInitMs !== undefined ? { timeToInitMs } : {}
  };
}
function configFields(tracking) {
  const { toBackend, toOtel } = trackingOutputs(tracking);
  const builtWith = safe(() => tracking?.builtWith);
  return {
    trackingEnabled: toBackend,
    otelEnabled: toOtel,
    customEndpoint: Boolean(safe(() => tracking?.endpoint)),
    ...typeof builtWith === "string" && builtWith.length > 0 && builtWith.length <= MAX_BUILT_WITH_LENGTH ? { builtWith } : {}
  };
}
var MAX_BUILT_WITH_LENGTH = 64;
var MAX_TOOL_FIELD_BYTES = 4 * 1024;
function toolString(value) {
  return sliceToBytes(value, MAX_TOOL_FIELD_BYTES);
}
function toolEnum(allowed, value) {
  return allowed.find((candidate) => candidate === value);
}
function toolRevision(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}
function annotationHints(annotations) {
  const hints = {};
  for (const hint of ANNOTATION_HINTS) {
    const value = safe(() => annotations?.[hint]);
    if (typeof value === "boolean")
      hints[hint] = value;
  }
  return Object.keys(hints).length > 0 ? hints : undefined;
}
function toolEntry(entry, registeredBy) {
  const { tool } = entry;
  const inputSchema = safe(() => tool.inputSchema);
  const hash = schemaHash(inputSchema);
  const hints = annotationHints(safe(() => tool.annotations));
  const source = toolEnum(TOOL_SOURCES, tool.source);
  const intent = toolEnum(TOOL_INTENTS, tool.intent);
  const signature = signsFailure(entry.outcome) ? errorSignature(entry.error) : undefined;
  return {
    name: toolString(tool.name),
    stableKey: toolString(tool.stableKey),
    ...typeof tool.inventoryToolId === "string" ? { inventoryToolId: toolString(tool.inventoryToolId) } : {},
    ...toolRevision(tool.contractRevision) !== undefined ? { contractRevision: toolRevision(tool.contractRevision) } : {},
    ...tool.version !== undefined ? { version: toolString(tool.version) } : {},
    ...hash !== undefined ? { schemaHash: hash } : {},
    ...source !== undefined ? { source } : {},
    ...intent !== undefined ? { intent } : {},
    outcome: entry.outcome,
    ...signature !== undefined ? { failureSignature: signature } : {},
    registeredBy,
    ...shapeMetrics(inputSchema) ?? {},
    descriptionLength: typeof tool.description === "string" ? tool.description.length : 0,
    ...hints !== undefined ? { annotations: hints } : {}
  };
}
function signsFailure(outcome) {
  switch (outcome) {
    case "failed":
      return true;
    case "registered":
    case "unsupported":
    case "aborted":
    case "blocked":
    case "pending":
      return false;
  }
}
var registrationCount = 0;
var lastRegistrationRoute;
function registrationTrigger(route) {
  if (registrationCount === 0)
    return "initial";
  return route === lastRegistrationRoute ? "re_register" : "spa_navigation";
}
function nextRegistration(scope = globalThis) {
  const route = routeTemplate(pathname(scope));
  const trigger = registrationTrigger(route);
  registrationCount += 1;
  lastRegistrationRoute = route;
  return { registrationIndex: registrationCount, trigger };
}
function buildToolRegistrationEvent(params) {
  const scope = params.scope ?? globalThis;
  const template = routeTemplate(pathname(scope));
  const sinceInit = timeSinceInit(scope);
  return {
    schema: TELEMETRY_SCHEMA_VERSION,
    event: "tool_registration",
    ts: new Date().toISOString(),
    sessionId: sessionId(),
    registrationIndex: params.registrationIndex,
    trigger: params.trigger,
    ...template !== undefined ? { routeTemplate: template } : {},
    ...sinceInit !== undefined ? { timeSinceInitMs: sinceInit } : {},
    settleMs: params.settleMs,
    config: configFields(params.tracking),
    ...params.trial?.script ? { trialScript: params.trial.script } : {},
    ...params.trial ? { trialSurface: params.trial.surface } : {},
    ...params.tools.length === 0 ? { registeredBy: params.registeredBy } : {},
    tools: params.tools.map((entry) => toolEntry(entry, params.registeredBy))
  };
}
var callCount = 0;
var toolCallCounts = new Map;
var lastCalledTool;
var lastCalledScope;
var MAX_TRACKED_TOOLS = 512;
function nextCall(stableKey, tenantScope) {
  callCount += 1;
  if (toolCallCounts.size >= MAX_TRACKED_TOOLS && !toolCallCounts.has(stableKey)) {
    toolCallCounts.clear();
  }
  const toolCallIndex = (toolCallCounts.get(stableKey) ?? 0) + 1;
  toolCallCounts.set(stableKey, toolCallIndex);
  const precededBy = tenantScope === lastCalledScope ? lastCalledTool : undefined;
  lastCalledTool = stableKey;
  lastCalledScope = tenantScope;
  return {
    callId: randomId(),
    callIndex: callCount,
    toolCallIndex,
    ...precededBy !== undefined ? { precededBy } : {}
  };
}
var MAX_CONTENT_BLOCKS = 4096;
function responseMetrics(response) {
  const content = safe(() => response?.content);
  const blocks = Array.isArray(content) ? content.length : 0;
  return {
    bytes: safe(() => serializedBytes(response)) ?? 0,
    contentBlocks: Math.max(0, Math.min(blocks, MAX_CONTENT_BLOCKS)),
    isError: safe(() => response?.isError) === true
  };
}
function buildToolCallEvent(params) {
  const scope = params.scope ?? globalThis;
  const failed = params.outcome === "error";
  const hash = schemaHash(safe(() => params.tool.inputSchema));
  const sinceInit = timeSinceInit(scope);
  const template = routeTemplate(pathname(scope));
  const signature = failed ? errorSignature(params.error) : undefined;
  const intent = toolEnum(TOOL_INTENTS, params.tool.intent);
  return {
    schema: TELEMETRY_SCHEMA_VERSION,
    event: "tool_call",
    ts: new Date().toISOString(),
    sessionId: sessionId(),
    callId: params.callId,
    callIndex: params.callIndex,
    toolCallIndex: params.toolCallIndex,
    ...params.precededBy !== undefined ? { precededBy: toolString(params.precededBy) } : {},
    ...template !== undefined ? { routeTemplate: template } : {},
    agentRuntime: agentRuntime(scope),
    ...sinceInit !== undefined ? { timeSinceInitMs: sinceInit } : {},
    tool: {
      stableKey: toolString(params.tool.stableKey),
      ...typeof params.tool.inventoryToolId === "string" ? { inventoryToolId: toolString(params.tool.inventoryToolId) } : {},
      ...toolRevision(params.tool.contractRevision) !== undefined ? { contractRevision: toolRevision(params.tool.contractRevision) } : {},
      ...hash !== undefined ? { schemaHash: hash } : {},
      ...intent !== undefined ? { intent } : {},
      registeredBy: params.registeredBy
    },
    outcome: params.outcome,
    durationMs: params.durationMs,
    ...params.outcome === "success" && params.response !== undefined ? { response: responseMetrics(params.response) } : {},
    ...params.outcome === "cancelled" ? {} : { errorClass: failed ? errorClassOf(params.error) : null },
    ...signature !== undefined ? { errorSignature: signature } : {}
  };
}
function pruneToolEntry(entry, disabled) {
  if (!isFieldParent(entry))
    return entry;
  let remaining;
  for (const key of disabled) {
    if (!(key in entry))
      continue;
    remaining ??= { ...entry };
    delete remaining[key];
  }
  return remaining ?? entry;
}
function applyPruned(event, key, value) {
  if (value === undefined)
    delete event[key];
  else
    event[key] = value;
}
function isEmptied(value) {
  return isFieldParent(value) && Object.keys(value).length === 0;
}
function pruneToolFields(event, toolFields) {
  const disabled = Object.entries(toolFields).filter(([, collected]) => !collected).map(([field]) => field);
  if (disabled.length === 0)
    return;
  const tools = event.tools;
  if (Array.isArray(tools)) {
    const entries = [];
    let changed = false;
    for (const entry of tools) {
      const next = pruneToolEntry(entry, disabled);
      if (next !== entry)
        changed = true;
      if (isEmptied(next))
        continue;
      entries.push(next);
    }
    if (changed) {
      applyPruned(event, "tools", tools.length > 0 && entries.length === 0 ? undefined : entries);
    }
  }
  const tool = event.tool;
  if (isFieldParent(tool)) {
    const next = pruneToolEntry(tool, disabled);
    if (next !== tool)
      applyPruned(event, "tool", isEmptied(next) ? undefined : next);
  }
}
function pruneByAllowlist(event, fields = TELEMETRY_FIELDS, toolFields = TELEMETRY_TOOL_FIELDS) {
  const pruned = { ...event };
  for (const [field, collected] of Object.entries(fields)) {
    if (collected)
      continue;
    const dot = field.indexOf(".");
    if (dot === -1) {
      delete pruned[field];
      continue;
    }
    const parentKey = field.slice(0, dot);
    const childKey = field.slice(dot + 1);
    const parent = pruned[parentKey];
    if (!isFieldParent(parent) || !(childKey in parent))
      continue;
    const remaining = { ...parent };
    delete remaining[childKey];
    applyPruned(pruned, parentKey, isEmptied(remaining) ? undefined : remaining);
  }
  pruneToolFields(pruned, toolFields);
  return pruned;
}
var defaultSinks2 = {
  sendTelemetry: (event) => queueOrSend(event, telemetryEndpoint(), telemetryApiKey())
};
var PAGE_BATCH_WINDOW_MS = 50;
var PAGE_BATCH_MAX_BYTES = 60000;
var PAGE_BATCH_MAX_EVENTS = 16;
var pendingPageEvents = new Map;
function queueOrSend(event, endpoint, apiKey) {
  const name = String(event.event);
  if (CONTRACT_EVENTS.has(name)) {
    pageContracts.enqueue(event, endpoint, apiKey);
    return;
  }
  if (!PAGE_LEVEL_EVENTS.has(name)) {
    flushPageEventQueue();
    sendTelemetry(event, globalThis, endpoint, apiKey);
    return;
  }
  const key = `${endpoint ?? ""}
${typeof apiKey === "string" ? apiKey : ""}`;
  const pending = pendingPageEvents.get(key);
  if (pending) {
    pending.events.push(event);
    if (pending.events.length >= PAGE_BATCH_MAX_EVENTS)
      flushPendingBatch(key);
    return;
  }
  const entry = { events: [event], endpoint, apiKey, cancel: () => {} };
  pendingPageEvents.set(key, entry);
  const cancel = tryAfterDelay(() => flushPendingBatch(key), PAGE_BATCH_WINDOW_MS);
  if (!cancel) {
    flushPendingBatch(key);
    return;
  }
  entry.cancel = cancel;
}
function flushPendingBatch(key) {
  const entry = pendingPageEvents.get(key);
  if (!entry)
    return;
  pendingPageEvents.delete(key);
  entry.cancel();
  const { events, endpoint, apiKey } = entry;
  const one = events[0];
  if (events.length === 1 && one) {
    sendTelemetry(one, globalThis, endpoint, apiKey);
    return;
  }
  const batch = {
    schema: TELEMETRY_SCHEMA_VERSION,
    event: PAGE_BATCH_EVENT,
    ts: new Date().toISOString(),
    sessionId: sessionId(),
    [PAGE_BATCH_EVENTS_KEY]: events
  };
  const json = safe(() => JSON.stringify(batch));
  const bytes = json === undefined ? Number.POSITIVE_INFINITY : utf8Length(json);
  if (bytes <= PAGE_BATCH_MAX_BYTES) {
    sendTelemetry(batch, globalThis, endpoint, apiKey);
    return;
  }
  for (const event of events)
    sendTelemetry(event, globalThis, endpoint, apiKey);
}
function utf8Length(text) {
  const encoded = safe(() => new TextEncoder().encode(text).length);
  return typeof encoded === "number" ? encoded : text.length * 3;
}
function flushPageEventQueue() {
  for (const key of Array.from(pendingPageEvents.keys()))
    flushPendingBatch(key);
}
safe(() => {
  const g = globalThis;
  if (typeof g.addEventListener !== "function")
    return;
  g.addEventListener("pagehide", flushPageEventQueue);
  g.addEventListener("visibilitychange", () => {
    if (g.document?.visibilityState === "hidden")
      flushPageEventQueue();
  });
});
function batchTelemetrySinks(apiKey, endpoint) {
  const own = batchApiKey(apiKey);
  const ownEndpoint = telemetryEndpointFrom(endpoint);
  return {
    sendTelemetry: (event) => queueOrSend(event, ownEndpoint ?? telemetryEndpoint(), own ?? telemetryApiKey())
  };
}
function batchApiKey(apiKey) {
  return typeof apiKey === "string" && apiKey.trim().length > 0 ? apiKey : undefined;
}
function resolveTelemetryKey(apiKey) {
  return batchApiKey(apiKey) ?? telemetryApiKey();
}
function telemetryTenantScope(apiKey) {
  const resolved = resolveTelemetryKey(apiKey);
  return resolved === undefined ? "" : fnv1a(resolved);
}
function emitTelemetry(build, sinks = defaultSinks2, fields = TELEMETRY_FIELDS, toolFields = TELEMETRY_TOOL_FIELDS, sampleRate = SDK_TELEMETRY_SAMPLE_RATE) {
  try {
    if (!telemetryEnabled())
      return;
    const event = { ...build() };
    if (PAGE_LEVEL_EVENTS.has(String(event.event)) && sampleRate < 1) {
      if (!pageSampled(String(event.sessionId), sampleRate))
        return;
      event.sampleRate = sampleRate;
    }
    sinks.sendTelemetry(boundEventPayload(pruneByAllowlist(event, fields, toolFields), TELEMETRY_SENT_AT_MAX_BYTES));
  } catch {}
}
var initCancelled = false;
var initFlushed = false;
var cancelInitFallback = () => {};
var capturedApiKey;
var capturedEndpoint;
function captureTelemetryApiKey(apiKey) {
  if (typeof apiKey === "string" && apiKey.trim().length > 0)
    capturedApiKey = apiKey;
}
function telemetryApiKey() {
  return capturedApiKey;
}
function telemetryEndpointFrom(endpoint) {
  if (typeof endpoint !== "string")
    return;
  return safe(() => {
    const url = new URL(endpoint);
    if (!["http:", "https:"].includes(url.protocol) || !url.pathname.endsWith("/v1/collect") || url.search !== "" || url.hash !== "") {
      return;
    }
    url.pathname = `${url.pathname.slice(0, -"/v1/collect".length)}/v1/telemetry`;
    return url.toString();
  });
}
function captureTelemetryEndpoint(endpoint) {
  const derived = telemetryEndpointFrom(endpoint);
  if (derived !== undefined)
    capturedEndpoint = derived;
}
function telemetryEndpoint() {
  return capturedEndpoint;
}
function cancelInitEvent() {
  initCancelled = true;
  cancelInitFallback();
}
function flushInitEvent(sinks) {
  if (initFlushed)
    return;
  initFlushed = true;
  cancelInitFallback();
  if (initCancelled)
    return;
  emitTelemetry(() => buildInitEvent(), sinks);
}
function deferInitEventForBatch(sinks) {
  if (initFlushed || initCancelled)
    return;
  afterDelay(() => flushInitEvent(sinks), 0);
}
function tryAfterDelay(run, ms) {
  const schedule = safe(() => globalThis.setTimeout);
  if (typeof schedule !== "function")
    return;
  let armed = false;
  const handle = safe(() => {
    const id = schedule.call(globalThis, () => run(), ms);
    armed = true;
    return id;
  });
  if (!armed)
    return;
  return () => {
    const clear = safe(() => globalThis.clearTimeout);
    if (typeof clear !== "function")
      return;
    safe(() => clear.call(globalThis, handle));
  };
}
function afterDelay(run, ms) {
  return tryAfterDelay(run, ms) ?? (() => {});
}
var INIT_FALLBACK_MS = 1000;
cancelInitFallback = afterDelay(() => flushInitEvent(), INIT_FALLBACK_MS);
var CONTRACT_EVENTS = new Set(["tool_contract"]);
var CONTRACT_SAMPLE_RATE = 1;
var MAX_CONTRACT_BYTES = 24 * 1024;
var MAX_CONTRACT_DESCRIPTION_CHARS = 4000;
var MAX_CONTRACTS_PER_PAGE = 64;
function buildToolContractEvent(tool) {
  const description = safe(() => tool.description);
  const inputSchema = exposed(safe(() => tool.inputSchema));
  const annotations = exposed(safe(() => tool.annotations));
  const contract = {
    ...typeof description === "string" ? { description } : {},
    ...inputSchema !== undefined ? { inputSchema } : {},
    ...annotations !== undefined ? { annotations } : {}
  };
  const bytes = serializedBytes(contract);
  if (bytes === undefined)
    return;
  const hash = schemaHash(inputSchema);
  const marker = (reason) => ({
    truncated: true,
    reason,
    bytes
  });
  return {
    schema: TELEMETRY_SCHEMA_VERSION,
    event: "tool_contract",
    ts: new Date().toISOString(),
    sessionId: sessionId(),
    tool: {
      stableKey: toolString(tool.stableKey),
      name: toolString(tool.name),
      ...hash !== undefined ? { schemaHash: hash } : {},
      registeredBy: tool.registeredBy
    },
    contract: typeof description === "string" && description.length > MAX_CONTRACT_DESCRIPTION_CHARS ? marker("description_too_long") : bytes > MAX_CONTRACT_BYTES ? marker("too_large") : contract
  };
}
function exposed(value) {
  return value === null ? undefined : value;
}
function createContractChannel(options = {}) {
  const send = options.send ?? ((event, endpoint, apiKey) => sendContracts(event, globalThis, endpoint, apiKey));
  const sampleRate = options.sampleRate ?? CONTRACT_SAMPLE_RATE;
  const fields = options.fields ?? TELEMETRY_FIELDS;
  const toolFields = options.toolFields ?? TELEMETRY_TOOL_FIELDS;
  const sent = new Map;
  let count = 0;
  const queue = [];
  let inFlight = false;
  let cancelWindow;
  const pump = () => {
    if (inFlight)
      return;
    if (!telemetryEnabled()) {
      queue.length = 0;
      return;
    }
    const head = queue[0];
    if (!head)
      return;
    const members = [];
    let bytes = batchOverhead() + TELEMETRY_SENT_AT_MAX_BYTES;
    for (let i = 0;i < queue.length && members.length < PAGE_BATCH_MAX_EVENTS; ) {
      const item = queue[i];
      if (item.destination !== head.destination) {
        i++;
        continue;
      }
      const next = bytes + item.bytes + (members.length > 0 ? 1 : 0);
      if (members.length > 0 && next > PAGE_BATCH_MAX_BYTES)
        break;
      members.push(item);
      bytes = next;
      queue.splice(i, 1);
    }
    const body = members.length === 1 ? head.event : {
      schema: TELEMETRY_SCHEMA_VERSION,
      event: PAGE_BATCH_EVENT,
      ts: new Date().toISOString(),
      sessionId: sessionId(),
      [PAGE_BATCH_EVENTS_KEY]: members.map((member) => member.event)
    };
    inFlight = true;
    const settled = () => {
      inFlight = false;
      pump();
    };
    const request = safe(() => send(body, head.endpoint, head.apiKey));
    if (request && typeof request.then === "function")
      request.then(settled, settled);
    else
      settled();
  };
  const schedule = () => {
    if (inFlight || cancelWindow)
      return;
    const cancel = tryAfterDelay(() => {
      cancelWindow = undefined;
      pump();
    }, PAGE_BATCH_WINDOW_MS);
    if (cancel)
      cancelWindow = cancel;
    else
      pump();
  };
  const enqueue = (event, endpoint, apiKey) => {
    const key = batchApiKey(apiKey);
    if (key === undefined)
      return;
    const json = safe(() => JSON.stringify(event));
    if (typeof json !== "string")
      return;
    const bytes = utf8Length(json);
    if (bytes + TELEMETRY_SENT_AT_MAX_BYTES > PAGE_BATCH_MAX_BYTES)
      return;
    queue.push({
      event: JSON.parse(json),
      bytes,
      destination: `${endpoint ?? ""}
${key}`,
      endpoint,
      apiKey: key
    });
    schedule();
  };
  return {
    report(tool, apiKey, endpoint) {
      try {
        const own = batchApiKey(apiKey);
        if (own === undefined)
          return;
        if (!telemetryEnabled())
          return;
        if (sampleRate < 1 && !pageSampled(sessionId(), sampleRate))
          return;
        if (count >= MAX_CONTRACTS_PER_PAGE)
          return;
        const canonical = canonicalLiveContractJson({
          name: tool.name,
          description: safe(() => tool.description),
          inputSchema: exposed(safe(() => tool.inputSchema)),
          annotations: exposed(safe(() => tool.annotations))
        });
        if (canonical === null)
          return;
        const identity = `${own}
${tool.stableKey}`;
        if (sent.get(identity) === canonical)
          return;
        const event = buildToolContractEvent(tool);
        if (event === undefined)
          return;
        sent.set(identity, canonical);
        count += 1;
        const destination = telemetryEndpointFrom(endpoint) ?? telemetryEndpoint();
        emitTelemetry(() => event, { sendTelemetry: (pruned) => enqueue(pruned, destination, own) }, fields, toolFields);
      } catch {}
    },
    enqueue,
    abandon() {
      queue.length = 0;
      cancelWindow?.();
      cancelWindow = undefined;
    }
  };
}
function batchOverhead() {
  return utf8Length(JSON.stringify({
    schema: TELEMETRY_SCHEMA_VERSION,
    event: PAGE_BATCH_EVENT,
    ts: new Date().toISOString(),
    sessionId: sessionId(),
    [PAGE_BATCH_EVENTS_KEY]: []
  }));
}
var pageContracts = createContractChannel();
var CONTRACT_LISTING_FAILED = "contract_listing_failed";
var warnedListingFailed = false;
function warnContractListingFailed(kind) {
  if (warnedListingFailed)
    return;
  warnedListingFailed = true;
  notice("warn", `${CONTRACT_LISTING_FAILED} (${kind})`, "the browser's tool list could not be read, so this page load sends no tool contracts. The next page load tries again.");
}
safe(() => {
  const g = globalThis;
  if (typeof g.addEventListener !== "function")
    return;
  g.addEventListener("pagehide", () => pageContracts.abandon());
});

// src/channels.ts
function elapsedMs(end, start) {
  if (typeof end !== "number" || typeof start !== "number")
    return 0;
  const elapsed = end - start;
  return Number.isFinite(elapsed) && elapsed > 0 ? Math.round(elapsed) : 0;
}
function clock() {
  const perf = safe(() => globalThis.performance);
  const now = safe(() => perf?.now);
  if (typeof now === "function") {
    const read = () => safe(() => now.call(perf));
    const start = read();
    if (start !== undefined)
      return () => elapsedMs(read(), start);
  }
  const read = () => safe(() => Date.now());
  const start = read();
  return () => elapsedMs(read(), start);
}
function isConnected(tracking) {
  return hasOwnKey(safe(() => tracking?.apiKey));
}
function hasOwnKey(apiKey) {
  return batchApiKey(apiKey) !== undefined;
}
function openChannels(options) {
  const telemetryOption = safeRead(() => options.telemetry);
  const tracking = safe(() => options.tracking);
  const telemetryLive = telemetryOption !== undefined && telemetryEnabled(telemetryOption.value);
  const apiKey = safe(() => tracking?.apiKey);
  const keyed = hasOwnKey(apiKey);
  const endpoint = telemetryLive ? safe(() => tracking?.endpoint) : undefined;
  const telemetrySinks = telemetryLive ? batchTelemetrySinks(apiKey, endpoint) : undefined;
  const contractsOption = telemetryLive ? safeRead(() => tracking?.contracts) : undefined;
  const contracts = keyed && contractsOption !== undefined && contractsOption.value !== false;
  const channels = {
    tracking,
    telemetry: telemetryLive,
    keyed,
    ...telemetryLive ? {
      telemetrySinks,
      telemetryKey: apiKey,
      telemetryEndpoint: endpoint,
      contracts
    } : {}
  };
  if (telemetryOption?.value === false)
    cancelInitEvent();
  if (telemetrySinks) {
    captureTelemetryApiKey(apiKey);
    captureTelemetryEndpoint(endpoint);
    deferInitEventForBatch(telemetrySinks);
  }
  return channels;
}
function trackerFor(tool, tracking, registeredBy) {
  if (!tracking)
    return;
  const { toBackend, toOtel } = trackingOutputs(tracking);
  if (!toBackend && !toOtel)
    return;
  const shared = {
    toolStableKey: tool.stableKey,
    toolName: tool.name,
    callId: randomId(),
    ...tool.version !== undefined ? { toolVersion: tool.version } : {},
    ...registeredBy !== undefined ? { registeredBy } : {}
  };
  return (eventName, data) => track(tracking, eventName, { ...shared, ...data });
}
function terminalOutcome(context, onEnd) {
  let ended = false;
  let unwatch = () => {};
  const end = (outcome) => {
    if (ended)
      return;
    ended = true;
    unwatch();
    onEnd(outcome);
  };
  unwatch = watchCancel(context, () => end({ outcome: "cancelled" }));
  return end;
}
function watchCancel(context, cancelled) {
  const signal = safe(() => context?.signal);
  if (!signal || typeof signal !== "object")
    return () => {};
  if (safe(() => signal.aborted) === true) {
    cancelled();
    return () => {};
  }
  const onAbort = () => cancelled();
  safe(() => signal.addEventListener("abort", onAbort, { once: true }));
  return () => {
    safe(() => signal.removeEventListener("abort", onAbort));
  };
}
function startCallReport(tool, channels, registeredBy, input, context) {
  const { tracking, telemetry, telemetrySinks, telemetryKey, telemetryEndpoint } = channels;
  const trackCall = trackerFor(tool, tracking, registeredBy);
  if (!trackCall && !telemetry)
    return;
  const callKey = telemetry ? resolveTelemetryKey(telemetryKey) : undefined;
  const sequence = telemetry ? nextCall(tool.stableKey, telemetryTenantScope(callKey)) : undefined;
  const callSinks = sequence ? batchTelemetrySinks(callKey, telemetryEndpoint) : telemetrySinks;
  const elapsed = clock();
  trackCall?.("tool_call_request", { input });
  return terminalOutcome(context, (end) => {
    const durationMs = elapsed();
    const fields = endFields(end);
    trackCall?.("tool_call_response", { ...fields.keyed(), duration_ms: durationMs });
    if (sequence) {
      emitTelemetry(() => buildToolCallEvent({ ...sequence, tool, registeredBy, durationMs, ...fields.anonymous }), callSinks);
    }
  });
}
function endFields(end) {
  switch (end.outcome) {
    case "success":
      return {
        keyed: () => ({ response: end.response }),
        anonymous: { outcome: "success", response: end.response }
      };
    case "error":
      return {
        keyed: () => ({ error: errorMessage(end.error) }),
        anonymous: { outcome: "error", error: end.error }
      };
    case "cancelled":
      return { keyed: () => ({ cancelled: true }), anonymous: { outcome: "cancelled" } };
  }
}
var REGISTRATION_TIMEOUT_MS = 2000;
var PAGEHIDE = "pagehide";
function onPagehide(run) {
  const g = globalThis;
  const add = safe(() => g.addEventListener);
  const remove = safe(() => g.removeEventListener);
  if (typeof add !== "function" || typeof remove !== "function")
    return () => {};
  const listener = () => run();
  safe(() => add.call(g, PAGEHIDE, listener, { once: true }));
  return () => {
    safe(() => remove.call(g, PAGEHIDE, listener));
  };
}
function watchRegistration(tools, registeredBy, channels, options = {}) {
  return watchWaitingRegistration(registeredBy, channels, options).start(tools);
}
function watchWaitingRegistration(registeredBy, channels, options = {}) {
  const { tracking, telemetrySinks: sinks } = channels;
  const {
    navigation = false,
    include = () => true,
    trial = () => {
      return;
    },
    during = () => []
  } = options;
  const { registrationIndex, trigger } = nextRegistration();
  let entries;
  let elapsed;
  let emitted = false;
  const release = [];
  const emit = () => {
    if (emitted)
      return;
    emitted = true;
    for (const stop of release)
      stop();
    const settleMs = elapsed ? elapsed() : 0;
    const sent = entries ?? during();
    const kept = sent.filter((entry) => include(entry.tool));
    if (sent.length > 0 && kept.length === 0)
      return;
    const outcome = safe(trial);
    emitTelemetry(() => buildToolRegistrationEvent({
      registrationIndex,
      trigger: navigation ? "spa_navigation" : trigger,
      settleMs,
      tools: kept,
      registeredBy,
      tracking,
      ...outcome ? { trial: outcome } : {}
    }), sinks);
  };
  let stopHide = onPagehide(emit);
  release.push(() => stopHide());
  const watch = {
    record(index, result) {
      const entry = entries?.[index];
      if (!entry)
        return;
      entry.outcome = result.state;
      if (result.error !== undefined)
        entry.error = result.error;
    },
    emit
  };
  return {
    start(tools) {
      if (emitted || entries)
        return watch;
      entries = tools.map((tool) => ({ tool, outcome: "pending" }));
      elapsed = clock();
      stopHide();
      stopHide = onPagehide(emit);
      release.push(afterDelay(emit, REGISTRATION_TIMEOUT_MS));
      return watch;
    }
  };
}
function listedHere(entry, here = globalThis) {
  return safe(() => entry.window === undefined || entry.window === here) === true;
}
async function reportListedContracts(modelContext, tools, channels, registeredBy) {
  const read = await readToolList(modelContext);
  if ("failed" in read) {
    warnContractListingFailed(read.failed);
    return;
  }
  const listed = new Map;
  safe(() => {
    for (const candidate of read.list) {
      const name = candidate?.name;
      if (typeof name === "string" && !listed.has(name) && listedHere(candidate))
        listed.set(name, candidate);
    }
  });
  for (const tool of tools) {
    const entry = listed.get(tool.name);
    const contract = entry ? safe(() => listedContract(entry)) : undefined;
    if (!contract)
      continue;
    pageContracts.report({
      name: tool.name,
      stableKey: tool.stableKey,
      registeredBy,
      description: contract.description,
      inputSchema: contract.inputSchema,
      annotations: contract.annotations
    }, channels.telemetryKey, channels.telemetryEndpoint);
  }
}

// src/tool-copy.ts
var TRACKED_TOOL_FLAG = Symbol.for("webmcp.sdk.tracked");
var SNIPPET_OWNED_FLAG = Symbol.for("webmcp.snippet.owned");
var TRACKING_COPY_FLAG = Symbol.for("webmcp.sdk.trackingCopy");
var TOOL_MEMBERS = Object.freeze([
  "annotations",
  "description",
  "execute",
  "inputSchema",
  "name",
  "title"
]);
function copyTool(tool, reporter) {
  if (typeof tool !== "object" || tool === null) {
    throw new TypeError("trackTools: a tool must be an object");
  }
  const copy = {};
  Object.defineProperty(copy, TRACKING_COPY_FLAG, { value: true, enumerable: false });
  let site;
  for (const member of TOOL_MEMBERS) {
    const value = tool[member];
    if (member === "execute") {
      if (typeof value !== "function") {
        throw new TypeError("trackTools: a tool must have an execute function");
      }
      copy.execute = forwardExecute(value, tool, copy, (input, context) => site ? reporter.call(site, input, context) : undefined);
    } else if (value !== undefined) {
      copy[member] = value;
    }
  }
  if (typeof copy.name === "string") {
    site = {
      name: copy.name,
      description: copy.description,
      inputSchema: copy.inputSchema,
      annotations: copy.annotations
    };
  }
  return { copy, ...site ? { site } : {} };
}
function forwardExecute(own, tool, copy, report) {
  return function execute(...args) {
    const self = this === copy ? tool : this;
    const latched = safe(() => report(args[0], args[1]));
    if (!latched)
      return Reflect.apply(own, self, args);
    const end = (outcome) => {
      safe(() => latched(outcome));
    };
    let result;
    try {
      result = Reflect.apply(own, self, args);
    } catch (error) {
      end({ outcome: "error", error });
      throw error;
    }
    if (!isThenable(result)) {
      end({ outcome: "success", response: result });
    } else {
      safe(() => Promise.resolve(result).then((response) => end({ outcome: "success", response }), (error) => end({ outcome: "error", error })));
    }
    return result;
  };
}

// src/tool-owners.ts
var TOOL_OWNERS_REGISTRY_KEY = "webmcp.sdk.toolOwners";
var REGISTRY = Symbol.for(TOOL_OWNERS_REGISTRY_KEY);
function registry(scope, create) {
  try {
    const held = scope[REGISTRY];
    if (held instanceof Map)
      return held;
    if (held !== undefined)
      return "unknown";
    if (!create)
      return;
    const map = new Map;
    Object.defineProperty(scope, REGISTRY, {
      value: map,
      writable: true,
      configurable: true,
      enumerable: false
    });
    return map;
  } catch {
    return "unknown";
  }
}
function claimTool(name, owner, scope = globalThis) {
  const map = registry(scope, true);
  if (map === undefined || map === "unknown" || map.has(name))
    return () => {};
  map.set(name, owner);
  return () => {
    if (map.get(name) === owner)
      map.delete(name);
  };
}
function snippetOwner() {
  return { host: "snippet" };
}
function claimSnippetTool(name, scope = globalThis) {
  return claimTool(name, snippetOwner(), scope);
}
function ownerOf(name, scope = globalThis) {
  const map = registry(scope, false);
  if (map === "unknown")
    return { kind: "unknown" };
  const owner = map?.get(name);
  if (owner === undefined)
    return { kind: "free" };
  const keyed = typeof owner === "object" && owner !== null ? owner.keyed : null;
  return typeof keyed === "boolean" ? { kind: "owned", owner } : { kind: "owned" };
}

// src/trial-script.ts
var TRIAL_TOKEN_SCRIPT_URL = "https://cdn.nekuda.ai/v1/trial-token.js";
var TRIAL_TOKEN_SCRIPT_ALIAS_URL = "https://cdn.agentlane.com/v1/trial-token.js";
var TRIAL_SCRIPT_TIMEOUT_MS = 1e4;
var TRIAL_SCRIPT_STATUSES = Object.freeze([
  "not_needed",
  "loaded",
  "blocked",
  "timed_out",
  "disabled"
]);
var TRIAL_SURFACES = Object.freeze(["available", "unavailable"]);
function isOutcome(value) {
  const v = value;
  return typeof v === "object" && v !== null && TRIAL_SCRIPT_STATUSES.includes(v.script) && TRIAL_SURFACES.includes(v.surface);
}
function guardedSurfaceIn(scope) {
  return safe(() => surfaceIn(scope));
}
function surfaceOf(scope) {
  return guardedSurfaceIn(scope) !== undefined ? "available" : "unavailable";
}
function trialSurfaceNow(scope = globalThis) {
  return { surface: surfaceOf(scope) };
}
function surfaceAfterTrial(trial, scope = globalThis) {
  return trial.then(() => guardedSurfaceIn(scope));
}
var TRIAL_SCRIPT_REGISTRY_KEY = "webmcp.sdk.trialScript";
var REGISTRY2 = Symbol.for(TRIAL_SCRIPT_REGISTRY_KEY);
function joinStep(step) {
  return new Promise((resolve) => {
    const stop = tryAfterDelay(() => resolve(undefined), TRIAL_SCRIPT_TIMEOUT_MS);
    const done = (outcome) => {
      stop?.();
      resolve(outcome);
    };
    Promise.resolve(step).then((value) => done(isOutcome(value) ? value : undefined), () => done(undefined));
  });
}
function isSlot(value) {
  return typeof value === "object" && value !== null && isThenable(value.outcome);
}
var TRIAL_SCRIPT_BLOCKED = "trial_script_blocked";
var TRIAL_SCRIPT_TIMED_OUT = "trial_script_timed_out";
var OWN_TOKEN_FIX = 'or add your own WebMCP trial token and pass trialToken: "own".';
function trialScriptNotice(status) {
  switch (status) {
    case "not_needed":
    case "loaded":
    case "disabled":
      return;
    case "blocked": {
      const origin = safe(() => new URL(TRIAL_TOKEN_SCRIPT_URL).origin) ?? TRIAL_TOKEN_SCRIPT_URL;
      return {
        code: TRIAL_SCRIPT_BLOCKED,
        text: `${CONSOLE_PREFIX} ${TRIAL_SCRIPT_BLOCKED}: the page did not load ${TRIAL_TOKEN_SCRIPT_URL}, so Chrome's WebMCP trial is not on and agents may not see your tools. If your content security policy sets script-src, add ${origin}; if a network filter blocks that host, allow it; ${OWN_TOKEN_FIX}`
      };
    }
    case "timed_out":
      return {
        code: TRIAL_SCRIPT_TIMED_OUT,
        text: `${CONSOLE_PREFIX} ${TRIAL_SCRIPT_TIMED_OUT}: ${TRIAL_TOKEN_SCRIPT_URL} did not load within ${TRIAL_SCRIPT_TIMEOUT_MS} ms, so Chrome's WebMCP trial may not be on and agents may not see your tools. Check that the page can reach that host, ${OWN_TOKEN_FIX}`
      };
    default: {
      const unhandled = status;
      return unhandled;
    }
  }
}
function scriptOnPage(doc) {
  return safe(() => {
    const scripts = doc.getElementsByTagName?.("script");
    if (!scripts)
      return false;
    for (let i = 0;i < scripts.length; i += 1) {
      const src = scripts[i]?.src;
      if (src === TRIAL_TOKEN_SCRIPT_URL || src === TRIAL_TOKEN_SCRIPT_ALIAS_URL)
        return true;
    }
    return false;
  }) === true;
}
function loadScript(doc, settle) {
  let done = false;
  let stopTimer = () => {};
  const finish = (status) => {
    if (done)
      return;
    done = true;
    stopTimer();
    settle(status);
  };
  try {
    const script = doc.createElement("script");
    script.src = TRIAL_TOKEN_SCRIPT_URL;
    script.addEventListener("load", () => finish("loaded"));
    script.addEventListener("error", () => finish("blocked"));
    const host = doc.head ?? doc.documentElement;
    if (!host)
      throw new TypeError("no head and no documentElement");
    host.appendChild(script);
  } catch {
    finish("blocked");
    return;
  }
  const stop = tryAfterDelay(() => finish("timed_out"), TRIAL_SCRIPT_TIMEOUT_MS);
  if (!stop) {
    finish("timed_out");
    return;
  }
  stopTimer = stop;
}
function decideAndLoad(doc, option, scope) {
  if (scriptOnPage(doc))
    return Promise.resolve({ script: "not_needed", surface: surfaceOf(scope) });
  if (option === "off")
    return Promise.resolve({ script: "disabled", surface: surfaceOf(scope) });
  const surface = surfaceOf(scope);
  if (surface === "available")
    return Promise.resolve({ script: "not_needed", surface });
  return new Promise((resolve) => {
    loadScript(doc, (script) => {
      const notice = trialScriptNotice(script);
      if (notice)
        safe(() => console.warn(notice.text));
      resolve({ script, surface: surfaceOf(scope) });
    });
  });
}
var LOAD_STEP = typeof __WEBMCP_TRIAL_LOADER__ !== "undefined" && __WEBMCP_TRIAL_LOADER__ === false ? undefined : decideAndLoad;
function createTrialLoader(scope, load = LOAD_STEP ?? null) {
  const page = scope;
  let mine;
  const fromSlot = () => {
    const slot = safe(() => page[REGISTRY2]);
    return isSlot(slot) ? slot.outcome : undefined;
  };
  const run = (doc, option) => {
    if (option !== "own" && load)
      return load(doc, option, scope);
    return Promise.resolve({ script: "not_needed", surface: surfaceOf(scope) });
  };
  return {
    start(option) {
      const joined = fromSlot();
      if (joined !== undefined && joined !== mine)
        return joinStep(joined);
      if (mine)
        return mine;
      const doc = safe(() => scope.document);
      const create = safe(() => doc?.createElement);
      if (typeof doc !== "object" || doc === null || typeof create !== "function")
        return;
      if (option !== "own" && !load)
        return;
      const outcome = run(doc, option);
      safe(() => {
        if (page[REGISTRY2] !== undefined)
          return;
        Object.defineProperty(page, REGISTRY2, {
          value: { outcome },
          writable: true,
          configurable: true,
          enumerable: false
        });
      });
      mine = outcome;
      return outcome;
    }
  };
}
var pageTrial = createTrialLoader(globalThis);
function startTrialScript(option) {
  return pageTrial.start(option);
}

// src/register.ts
var TOOL_REGISTRATION_STATES = [
  "registered",
  "unsupported",
  "aborted",
  "blocked",
  "failed"
];
var NOT_ALLOWED_ERROR = "NotAllowedError";
function rejectedState(error) {
  return errorKind(error) === NOT_ALLOWED_ERROR ? "blocked" : "failed";
}
function isLive(state) {
  switch (state) {
    case "registered":
      return true;
    case "unsupported":
    case "aborted":
    case "blocked":
    case "failed":
      return false;
  }
}
var TOOL_REGISTRATION_OUTCOMES = [...TOOL_REGISTRATION_STATES, "pending"];
function isContentResult(value) {
  return typeof value === "object" && value !== null && Array.isArray(value.content);
}
function normalizeResult(value) {
  if (isContentResult(value))
    return value;
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return { content: [{ type: "text", text }] };
}
function failureResult(error) {
  return { content: [{ type: "text", text: errorMessage(error) || "Tool failed" }], isError: true };
}
function createCallTracker(tool, tracking) {
  return trackerFor({ ...tool, stableKey: hostStableKey(tool.name) }, tracking);
}
function hostStableKey(name) {
  return name;
}
var REGISTERED_BY_SDK = "sdk";
function markTracked(spec, tracking) {
  const { toBackend } = trackingOutputs(tracking);
  if (!toBackend)
    return spec;
  try {
    Object.defineProperty(spec, TRACKED_TOOL_FLAG, {
      value: true,
      writable: false,
      configurable: true,
      enumerable: false
    });
  } catch {}
  return spec;
}
async function runToolCall(tool, input, context, end) {
  let response;
  try {
    response = normalizeResult(await tool.execute(input, context));
  } catch (error) {
    end?.({ outcome: "error", error });
    return failureResult(error);
  }
  end?.({ outcome: "success", response });
  return response;
}
function toSpecTool(tool, channels) {
  const { tracking } = channels;
  const spec = {
    name: tool.name,
    ...tool.title !== undefined ? { title: tool.title } : {},
    description: tool.description,
    ...tool.inputSchema !== undefined ? { inputSchema: tool.inputSchema } : {},
    ...tool.annotations !== undefined ? { annotations: tool.annotations } : {},
    async execute(input, context) {
      const end = startCallReport(tool, channels, REGISTERED_BY_SDK, input, context);
      return runToolCall(tool, input, context, end);
    }
  };
  return markTracked(spec, tracking);
}
function assertUniqueIdentities(tools) {
  const names = new Set;
  const keys = new Set;
  for (const tool of tools) {
    if (names.has(tool.name)) {
      throw new TypeError(`registerTools: duplicate tool name "${tool.name}"`);
    }
    if (keys.has(tool.stableKey)) {
      throw new TypeError(`registerTools: duplicate stableKey "${tool.stableKey}"`);
    }
    names.add(tool.name);
    keys.add(tool.stableKey);
  }
}
function registerTools(tools, options = {}) {
  const channels = openChannels(options);
  const snippetBatch = safe(() => options.host) === "snippet";
  assertUniqueIdentities(tools);
  const trial = channels.keyed ? startTrialScript(safe(() => options.trialToken)) : undefined;
  let trialOutcome;
  trial?.then((outcome) => {
    trialOutcome = outcome;
  });
  const controller = new AbortController;
  const external = options.signal;
  if (external) {
    if (external.aborted)
      controller.abort(external.reason);
    else
      external.addEventListener("abort", () => controller.abort(external.reason), { once: true });
  }
  let modelContext = options.modelContext ?? resolveModelContext();
  const waits = trial !== undefined && modelContext === undefined;
  let waiting = waits;
  const trialReport = () => waiting ? trialSurfaceNow() : trialOutcome;
  const result = (tool, state, error) => ({
    stableKey: tool.stableKey,
    name: tool.name,
    state,
    ...error !== undefined ? { error } : {}
  });
  const active = new Map;
  const current = () => tools.filter((tool) => active.get(tool)?.registered).map((tool) => tool.name);
  const changed = () => {
    safe(() => options.onChange?.(current()));
  };
  const eligible = (tool) => {
    const page = currentPageKey();
    return page === undefined || matchPage(tool.pages, page);
  };
  const remove = (tool) => {
    const entry = active.get(tool);
    if (!entry)
      return;
    entry.lifetime.abort();
    active.delete(tool);
  };
  const settle = async (tool) => {
    if (controller.signal.aborted)
      return result(tool, "aborted");
    if (!modelContext)
      return result(tool, "unsupported");
    const entry = { lifetime: new AbortController, registered: false };
    active.set(tool, entry);
    const release = claimTool(tool.name, snippetBatch ? snippetOwner() : { keyed: channels.keyed });
    entry.lifetime.signal.addEventListener("abort", release, { once: true });
    try {
      const registration = modelContext.registerTool(toSpecTool(tool, channels), {
        signal: entry.lifetime.signal,
        ...tool.exposedTo !== undefined ? { exposedTo: tool.exposedTo } : {}
      });
      await registration.then(() => {
        return;
      });
      if (entry.lifetime.signal.aborted)
        return result(tool, "aborted");
      entry.registered = true;
      if (!eligible(tool))
        remove(tool);
      changed();
      return result(tool, entry.lifetime.signal.aborted ? "aborted" : "registered");
    } catch (error) {
      if (active.get(tool) === entry)
        active.delete(tool);
      if (entry.lifetime.signal.aborted)
        return result(tool, "aborted");
      entry.lifetime.abort();
      return result(tool, rejectedState(error), error);
    }
  };
  const watchBatch = (batch, { navigation = false } = {}) => channels.telemetry ? watchRegistration(batch, REGISTERED_BY_SDK, channels, { navigation, trial: trialReport }) : undefined;
  const register = (batch, watchOf) => {
    const watch = watchOf(batch);
    const ready = Promise.all(batch.map(async (tool, index) => {
      const settled = await settle(tool);
      watch?.record(index, settled);
      return settled;
    }));
    if (watch)
      ready.then(() => watch.emit());
    const surface = modelContext;
    if (channels.contracts && surface) {
      ready.then((results) => {
        const registered = batch.filter((_, index) => {
          const state = results[index]?.state;
          return state !== undefined && isLive(state);
        });
        if (registered.length)
          reportListedContracts(surface, registered, channels, REGISTERED_BY_SDK);
      });
    }
    return ready;
  };
  const reconcile = () => {
    if (controller.signal.aborted || waiting)
      return;
    for (const tool of active.keys())
      if (!eligible(tool))
        remove(tool);
    changed();
    const added = tools.filter((tool) => eligible(tool) && !active.has(tool));
    if (added.length)
      register(added, (batch) => watchBatch(batch, { navigation: true }));
  };
  const stop = !controller.signal.aborted && tools.some((tool) => tool.pages?.length) ? onPageChange(reconcile) : () => {};
  controller.signal.addEventListener("abort", () => {
    stop();
    for (const tool of active.keys())
      remove(tool);
    changed();
  }, { once: true });
  const waitingEvent = waits && channels.telemetry ? watchWaitingRegistration(REGISTERED_BY_SDK, channels, {
    trial: trialReport,
    during: () => tools.filter(eligible).map((tool) => ({
      tool,
      outcome: controller.signal.aborted ? "aborted" : "pending"
    }))
  }) : undefined;
  const ready = waits && trial ? surfaceAfterTrial(trial).then((surface) => {
    waiting = false;
    modelContext = surface;
    return register(tools.filter(eligible), (batch) => waitingEvent?.start(batch));
  }) : register(tools.filter(eligible), watchBatch);
  return {
    ready,
    current,
    signal: controller.signal,
    unregister() {
      controller.abort();
    }
  };
}
// src/site-report.ts
var REGISTERED_BY_SITE = "site";
var TRACKED_KEY_COLLISION = "tracked_key_collision";
var REGISTERED_BEFORE_TRACKING = "registered_before_tracking";
var SDK_BATCH_WITHOUT_KEY = "sdk_batch_without_key";
var TOOL_OWNERS_UNREADABLE = "tool_owners_unreadable";
function namesOf(names) {
  const quoted = names.map((n) => JSON.stringify(n));
  return quoted.length < 2 ? quoted[0] ?? "" : `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;
}
function aborted(signal) {
  return safe(() => signal?.aborted) === true;
}
function settled(returned, signal) {
  if (!isThenable(returned)) {
    return Promise.resolve({
      state: "failed",
      error: new TypeError("registerTool returned no promise")
    });
  }
  return Promise.resolve(returned).then(() => aborted(signal) ? { state: "aborted" } : { state: "registered" }, (error) => aborted(signal) ? { state: "aborted" } : { state: rejectedState(error), error });
}
function siteReporter(channels, selects = () => true) {
  const keys = trackedKeyIndex();
  const announced = new Set;
  const unkeyedWarned = new Set;
  let ownersUnreadableSaid = false;
  let unkeyedPending = [];
  const anonymousOnly = withoutKeyedChannel(channels);
  const contractsDue = new Map;
  const keyOf = (name) => keys.get(name);
  const reportable = (name) => keyOf(name)?.kind === "keyed";
  const see = (name) => {
    keys.add(name);
    const result = keyOf(name);
    if (result?.kind !== "collision" || announced.has(result.key))
      return;
    announced.add(result.key);
    const named = namesOf(result.names);
    notice("error", TRACKED_KEY_COLLISION, `the tools ${named} derive the same tracked key (${result.key}), so tool tracking reports neither of them. Rename one of them.`);
  };
  const entryOf = (name, fields) => ({
    name,
    stableKey: keyOf(name)?.key,
    ...typeof fields.description === "string" ? { description: fields.description } : {},
    ...fields.inputSchema !== undefined ? { inputSchema: fields.inputSchema } : {},
    ...fields.annotations !== undefined ? { annotations: fields.annotations } : {}
  });
  const watch = (entries) => channels.telemetry && entries.length > 0 ? watchRegistration(entries, REGISTERED_BY_SITE, channels, {
    include: (watched) => reportable(watched.name)
  }) : undefined;
  const settle = (watching, entries, outcomes, surface) => {
    outcomes.forEach((outcome, index) => watching?.record(index, outcome));
    watching?.emit();
    if (!channels.contracts)
      return;
    const live = entries.filter((entry, index) => outcomes[index]?.state === "registered" && reportable(entry.name));
    if (live.length === 0)
      return;
    const due = contractsDue.get(surface);
    const tools = live.map(({ name, stableKey }) => ({ name, stableKey }));
    if (due) {
      due.push(...tools);
      return;
    }
    contractsDue.set(surface, tools);
    if (contractsDue.size > 1)
      return;
    queueMicrotask(() => {
      const reads = [...contractsDue];
      contractsDue.clear();
      for (const [listedOn, named] of reads) {
        reportListedContracts(listedOn, named, channels, REGISTERED_BY_SITE);
      }
    });
  };
  return {
    selects,
    registered(tool, signal, returned, surface) {
      see(tool.name);
      if (tool.snippetOwned)
        return;
      const entry = entryOf(tool.name, tool);
      const watching = watch([entry]);
      settled(returned, signal).then((outcome) => safe(() => settle(watching, [entry], [outcome], surface)));
    },
    call(tool, input, context) {
      const result = keyOf(tool.name);
      if (result?.kind !== "keyed")
        return;
      return startCallReport({
        name: tool.name,
        stableKey: result.key,
        ...tool.inputSchema !== undefined ? { inputSchema: tool.inputSchema } : {}
      }, tool.snippetOwned ? anonymousOnly : channels, REGISTERED_BY_SITE, input, context);
    },
    discovered(found, surface) {
      const before = found.filter((tool) => !keys.has(tool.name));
      if (before.length === 0)
        return;
      for (const tool of before)
        see(tool.name);
      const tools = [];
      for (const { name, entry } of before) {
        const contract = safe(() => listedContract(entry));
        if (contract)
          tools.push(entryOf(name, contract));
      }
      if (tools.length === 0)
        return;
      settle(watch(tools), tools, tools.map(() => ({ state: "registered" })), surface);
      const missed = namesOf(tools.map((tool) => tool.name));
      notice("warn", REGISTERED_BEFORE_TRACKING, `the tools ${missed} registered before trackTools() ran, so tool tracking reports them but not their calls. Call trackTools() earlier, before any code that registers tools.`);
    },
    ownedBySdk(name, owner) {
      if (owner.keyed || !channels.keyed || unkeyedWarned.has(name))
        return;
      unkeyedWarned.add(name);
      unkeyedPending.push(name);
      if (unkeyedPending.length > 1)
        return;
      queueMicrotask(() => {
        const named = namesOf(unkeyedPending);
        unkeyedPending = [];
        notice("warn", SDK_BATCH_WITHOUT_KEY, `the tools ${named} are registered by registerTools() without a publishable key, so their calls stay off the keyed channel. Pass the key to registerTools() as tracking.apiKey.`);
      });
    },
    ownersUnreadable() {
      if (ownersUnreadableSaid)
        return;
      ownersUnreadableSaid = true;
      notice("error", TOOL_OWNERS_UNREADABLE, "the page's tool ownership registry could not be read, so tool tracking reports every tool, and may report an SDK tool a second time.");
    },
    attemptEnded(trial) {
      if (!channels.telemetry)
        return;
      watchRegistration([], REGISTERED_BY_SITE, channels, { trial: () => trial }).emit();
    }
  };
}
function withoutKeyedChannel(channels) {
  const { tracking: _keyed, ...anonymous } = channels;
  return anonymous;
}
function trackHostCall(tool, tracking, input, context) {
  return startCallReport({
    name: tool.name,
    stableKey: hostStableKey(tool.name),
    ...tool.version !== undefined ? { version: tool.version } : {}
  }, {
    ...tracking ? { tracking } : {},
    telemetry: false,
    keyed: isConnected(tracking)
  }, REGISTERED_BY_SITE, input, context);
}
// src/tool-selection.ts
var INVALID_TOOL_SELECTION = "invalid_tool_selection";
function readList(options, field) {
  const read = safeRead(() => options[field]);
  if (read === undefined)
    return { kind: "invalid" };
  if (read.value === undefined)
    return { kind: "absent" };
  if (!Array.isArray(read.value))
    return { kind: "invalid" };
  const items = safe(() => [...read.value]);
  if (items === undefined)
    return { kind: "invalid" };
  return { kind: "names", names: new Set(items.filter((i) => typeof i === "string")) };
}
function toolSelection(options) {
  const include = readList(options, "include");
  const exclude = readList(options, "exclude");
  const invalid = include.kind === "invalid" ? "include" : exclude.kind === "invalid" ? "exclude" : undefined;
  if (invalid !== undefined) {
    notice("error", INVALID_TOOL_SELECTION, `trackTools \`${invalid}\` must be an array of tool names, so tool tracking reports no tool. Fix the option.`);
    return () => false;
  }
  return (name) => !(exclude.kind === "names" && exclude.names.has(name)) && (include.kind !== "names" || include.names.has(name));
}

// src/track-tools.ts
var TRACK_TOOLS_REGISTRY_KEY = "webmcp.sdk.trackTools";
var REGISTRY3 = Symbol.for(TRACK_TOOLS_REGISTRY_KEY);
var NO_WAIT = () => Promise.resolve();
function trackTools(options = {}) {
  const trial = isConnected(safe(() => options.tracking)) ? safe(() => startTrialScript(safe(() => options.trialToken))) : undefined;
  return startTracking(globalThis, trial ? trialWait(globalThis, trial) : NO_WAIT, options, trial);
}
function trialWait(scope, trial) {
  return (onSurface) => surfaceAfterTrial(trial, scope).then((surface) => {
    if (surface !== undefined)
      onSurface(surface);
  });
}
function startTracking(scope, wait, options = {}, trial) {
  try {
    if (!isBrowserPage(scope))
      return { ready: Promise.resolve({ state: "unsupported" }) };
    if (safe(() => options.debug) === true)
      turnDebugOn(scope);
    const channels = openChannels(options);
    return {
      ready: joinOrStart(scope, wait, () => siteReporter(channels, toolSelection(options)), trial)
    };
  } catch (error) {
    return { ready: Promise.resolve({ state: "failed", error }) };
  }
}
function isSlot2(value) {
  if (typeof value !== "object" || value === null)
    return false;
  const slot = value;
  return isThenable(slot.ready) && (slot.phase === "pending" || slot.phase === "installed");
}
function shared(ready) {
  return Promise.resolve(ready).then((result) => result, (error) => ({ state: "failed", error }));
}
function joinOrStart(scope, wait, reporting, trial) {
  const existing = scope[REGISTRY3];
  if (existing !== undefined) {
    if (!isSlot2(existing)) {
      return Promise.resolve({
        state: "failed",
        error: new TypeError(`trackTools: the page registry ${TRACK_TOOLS_REGISTRY_KEY} holds an unknown value`)
      });
    }
    return existing.phase === "installed" ? Promise.resolve({ state: "already_installed" }) : shared(existing.ready);
  }
  let settle = () => {};
  const slot = {
    ready: new Promise((resolve) => {
      settle = resolve;
    }),
    phase: "pending"
  };
  try {
    Object.defineProperty(scope, REGISTRY3, {
      value: slot,
      writable: true,
      configurable: true,
      enumerable: false
    });
  } catch (error) {
    return Promise.resolve({ state: "failed", error });
  }
  const owns = () => scope[REGISTRY3] === slot;
  const reporter = reporting();
  let ended = false;
  let outcome;
  const install = (surface) => {
    if (ended || outcome !== undefined || !owns())
      return;
    outcome = patchRegisterTool(surface, reporter, scope);
    if (outcome?.state === "installed")
      discover(surface, reporter, scope);
  };
  let endSent = false;
  let stopEarlySend = () => {};
  const sendEnd = (trialReport) => {
    if (endSent)
      return;
    endSent = true;
    stopEarlySend();
    safe(() => reporter.attemptEnded(trialReport));
  };
  if (trial)
    stopEarlySend = onPagehide(() => sendEnd(trialSurfaceNow(scope)));
  const run = async () => {
    install(surfaceIn(scope));
    if (outcome === undefined)
      await wait(install);
    ended = true;
    return outcome ?? { state: "unsupported" };
  };
  const end = (result) => {
    ended = true;
    safe(() => {
      if (result.state === "installed")
        slot.phase = "installed";
      else if (owns())
        delete scope[REGISTRY3];
    });
    if (trial)
      trial.then(sendEnd, () => sendEnd());
    else
      sendEnd();
    settle(result);
  };
  run().then(end, (error) => end({ state: "failed", error }));
  return slot.ready;
}
function patchRegisterTool(surface, reporter, scope) {
  if (surface === undefined || surface === null)
    return;
  try {
    let registerTool = function(...args) {
      const given = args[0];
      const tracked = args.length > 0 ? copyOrTool(given, reporter, scope) : undefined;
      if (tracked)
        args[0] = tracked.copy;
      const returned = Reflect.apply(original, this, args);
      const site = tracked?.site;
      if (site) {
        site.snippetOwned = snippetOwned(given) || snippetOwned(tracked.copy);
        const signal = safe(() => args[1]?.signal);
        safe(() => reporter.registered(site, signal, returned, surface));
      }
      return returned;
    };
    const original = surface.registerTool;
    if (typeof original !== "function") {
      return {
        state: "failed",
        error: new TypeError("trackTools: the WebMCP surface has no registerTool function")
      };
    }
    Object.defineProperty(surface, "registerTool", {
      value: registerTool,
      writable: true,
      configurable: true,
      enumerable: false
    });
    return { state: "installed" };
  } catch (error) {
    return { state: "failed", error };
  }
}
function snippetOwned(tool) {
  return safe(() => typeof tool === "object" && tool !== null && tool[SNIPPET_OWNED_FLAG] === true) === true;
}
function sdkReported(tool) {
  return typeof tool === "object" && tool !== null && tool[TRACKED_TOOL_FLAG] === true;
}
function sdkOwned(name, reporter, scope) {
  if (typeof name !== "string")
    return false;
  const ownership = ownerOf(name, scope);
  if (ownership.kind === "unknown")
    safe(() => reporter.ownersUnreadable());
  const owner = ownership.kind === "owned" ? ownership.owner : undefined;
  if (owner)
    safe(() => reporter.ownedBySdk(name, owner));
  return ownership.kind === "owned";
}
function copyOrTool(tool, reporter, scope) {
  try {
    const name = safe(() => tool?.name);
    if (sdkReported(tool) || sdkOwned(name, reporter, scope))
      return { copy: tool };
    const built = copyTool(tool, reporter);
    return built.site && !reporter.selects(built.site.name) ? { copy: tool } : built;
  } catch {
    return { copy: tool };
  }
}
var TOOL_DISCOVERY_FAILED = "tool_discovery_failed";
function discover(surface, reporter, scope) {
  readToolList(surface).then((read) => {
    if ("failed" in read)
      return discoveryFailed(read.failed);
    const free = [];
    for (const entry of read.list) {
      const name = safe(() => entry?.name);
      if (typeof name !== "string" || !listedHere(entry, scope))
        continue;
      if (sdkOwned(name, reporter, scope) || !reporter.selects(name))
        continue;
      free.push({ name, entry });
    }
    safe(() => reporter.discovered(free, surface));
  });
}
function discoveryFailed(kind) {
  notice("error", `${TOOL_DISCOVERY_FAILED} (${kind})`, "the browser's tool list could not be read, so tools registered before trackTools() ran are not reported. Tools registered from now on are.");
}
export {
  SNIPPET_OWNED_FLAG,
  TOOL_MEMBERS,
  TRACKED_TOOL_FLAG,
  TRACKING_COPY_FLAG,
  TRIAL_SCRIPT_STATUSES,
  TRIAL_SURFACES,
  claimSnippetTool,
  createCallTracker,
  currentPageKey,
  defineTool,
  matchPage,
  registerTools,
  resolveModelContext,
  trackHostCall,
  trackTools
};
