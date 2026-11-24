/** Host half of @local/session-content-search.
 *
 * Serves the browser half's palette over one authenticated same-origin
 * `/api` route. Search itself is a *scan* over DSH's session-query service:
 * `listSessions()` plus per-session `filterEvents()` with a literal-text
 * clause. Those read-only paths work in every deployment — including the
 * default Desktop composition whose FTS index row stays at `openAt: never`
 * — and they never build or open a SQLite index, so a search can neither
 * block the Host event loop nor mutate any storage.
 *
 * The provider is resolved at call time so the plugin keeps working (with an
 * explicit error) when `sessionQuery` is missing entirely.
 */

import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** The connection service is required: it owns the `/api` route table. */
export const inject = ['connection']

/** Absolute route below `/api` that answers search POSTs. */
const SEARCH_ROUTE = '/api/session-content-search/search'

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100
const MAX_QUERY_CHARS = 512
/** Events kept per session for result ordering; one hit per session is returned. */
const MAX_DOCS_PER_SESSION = 20
/** Sessions visited in one request; live and newest sessions are scanned first. */
const SCAN_WINDOW = 40
/** Hard ceiling for one request regardless of the requested window. */
const MAX_SESSIONS_PER_SCAN = 200
/** Overlapping read/filter calls; keeps large logs from serializing the scan. */
const SCAN_CONCURRENCY = 8
const SNIPPET_CHARS = 220
/** Filter that returns every current-surface semantic document of a session. */
const ALL_CURRENT_FILTERS = [{ kind: 'surface', values: ['current'] }]
/**
 * Cold sessions never change while they stay cold, so their full semantic
 * documents are cached in memory (never on disk, never in SQLite) and every
 * later search matches locally. The budget bounds the cache; least recently
 * used sessions are evicted first.
 */
const COLD_DOC_CACHE_MAX_BYTES = 128 * 1024 * 1024
/** On-disk copy of the cold-document cache so first searches after a restart are warm. */
const PERSIST_FILE = join(tmpdir(), 'session-content-search-cache.v1.json')
const PERSIST_VERSION = 1
/** Bytes budget for the on-disk copy; it is a warm-start aid, not an index. */
const PERSIST_MAX_BYTES = 48 * 1024 * 1024
const PERSIST_DELAY_MS = 3000
/** Tests disable every disk touch; the cache itself is opt-in per request. */
const PERSIST_KILL = process.env.SESSION_CONTENT_SEARCH_NO_PERSIST === '1'
/** Diagnostics are off by default: a public plugin must not log user content. */
const DEBUG_LOG = process.env.SESSION_CONTENT_SEARCH_DEBUG === '1'

/** @type {Map<string, { docs: object[], bytes: number }>} */
const coldDocCache = new Map()
let coldDocCacheBytes = 0
let persistLoaded = false
let persistTimer = null

/**
 * Read one cold session's cached documents and refresh its LRU position.
 * @param {string} sessionId - session id.
 * @returns {object[] | undefined} cached documents.
 */
function cacheGet(sessionId) {
  const entry = coldDocCache.get(sessionId)
  if (entry === undefined) return undefined
  coldDocCache.delete(sessionId)
  coldDocCache.set(sessionId, entry)
  return entry.docs
}

/**
 * Cache one cold session's full semantic documents, evicting oldest entries.
 * @param {string} sessionId - session id.
 * @param {object[]} docs - every current-surface document of the session.
 * @param {boolean} allowPersist - whether this search may schedule a disk write.
 * @returns {void}
 */
function cacheSet(sessionId, docs, allowPersist) {
  let bytes = 0
  for (const doc of docs) {
    // Measure the on-disk JSON footprint in real UTF-8 bytes so the persist
    // budget stays a hard cap for CJK-heavy text as well.
    bytes += (typeof doc.text === 'string' ? Buffer.byteLength(doc.text, 'utf8') : 0) + 64
  }
  if (bytes > COLD_DOC_CACHE_MAX_BYTES) return
  const existing = coldDocCache.get(sessionId)
  if (existing !== undefined) {
    coldDocCacheBytes -= existing.bytes
    coldDocCache.delete(sessionId)
  }
  coldDocCache.set(sessionId, { docs, bytes })
  coldDocCacheBytes += bytes
  while (coldDocCacheBytes > COLD_DOC_CACHE_MAX_BYTES) {
    const oldest = coldDocCache.keys().next().value
    if (oldest === undefined) break
    const entry = coldDocCache.get(oldest)
    coldDocCache.delete(oldest)
    coldDocCacheBytes -= entry?.bytes ?? 0
  }
  schedulePersist(allowPersist)
}

/**
 * Remove one session's cached documents. A session that went live may have
 * grown new events since it was cached, so its entry must be rebuilt.
 * @param {string} sessionId - session id.
 * @returns {void}
 */
function cacheDelete(sessionId) {
  const entry = coldDocCache.get(sessionId)
  if (entry === undefined) return
  coldDocCache.delete(sessionId)
  coldDocCacheBytes -= entry.bytes
}

/**
 * Load the on-disk cold-document cache once, honouring the in-memory budget.
 * Disk caching is opt-in per search, so nothing is read unless asked.
 * @param {boolean} allowPersist - whether this search enabled disk caching.
 * @returns {void}
 */
function loadPersistentCache(allowPersist) {
  if (persistLoaded) return
  if (!allowPersist || PERSIST_KILL) return
  persistLoaded = true
  try {
    if (!existsSync(PERSIST_FILE)) return
    const data = JSON.parse(readFileSync(PERSIST_FILE, 'utf8'))
    if (data === null || typeof data !== 'object' || data.version !== PERSIST_VERSION) return
    if (!Array.isArray(data.entries)) return
    for (const entry of data.entries) {
      if (entry === null || typeof entry !== 'object') continue
      if (typeof entry.sessionId !== 'string' || !Array.isArray(entry.docs)) continue
      cacheSet(entry.sessionId, entry.docs, false)
    }
    logLine('cache', `loaded ${coldDocCache.size} warm session(s)`)
  } catch (error) {
    logLine('warn', `cache load failed: ${String(error?.message ?? error)}`)
  }
}

/**
 * Persist the cold-document cache after a quiet period. Writes are best
 * effort, bounded, never block a search answer, and only happen when the
 * person enabled disk caching.
 * @param {boolean} allowPersist - whether disk caching is enabled.
 * @returns {void}
 */
function schedulePersist(allowPersist) {
  if (!allowPersist || PERSIST_KILL || persistTimer !== null) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    try {
      let entries = []
      let bytes = 0
      for (const [sessionId, entry] of coldDocCache) {
        if (entries.length > 0 && bytes + entry.bytes > PERSIST_MAX_BYTES) break
        bytes += entry.bytes
        entries.push({ sessionId, docs: entry.docs })
      }
      let payload = JSON.stringify({ version: PERSIST_VERSION, savedAt: Date.now(), entries })
      // The serialized size carries JSON escaping the per-document estimate
      // cannot see; keep the written file inside the same hard budget.
      while (entries.length > 1 && Buffer.byteLength(payload, 'utf8') > PERSIST_MAX_BYTES) {
        entries = entries.slice(0, Math.max(1, Math.floor(entries.length / 2)))
        payload = JSON.stringify({ version: PERSIST_VERSION, savedAt: Date.now(), entries })
      }
      // Replace atomically: another Host process may write the same warm copy.
      const temporary = `${PERSIST_FILE}.${process.pid}.tmp`
      writeFileSync(temporary, payload, 'utf8')
      renameSync(temporary, PERSIST_FILE)
      logLine('cache', `persisted ${entries.length} session(s), ${Math.round(Buffer.byteLength(payload, 'utf8') / 1024)} KiB`)
    } catch (error) {
      logLine('warn', `cache persist failed: ${String(error?.message ?? error)}`)
    }
  }, PERSIST_DELAY_MS)
  // Never keep the Host alive only for a cache write.
  persistTimer.unref?.()
}

/**
 * Collapse whitespace and case for literal comparison, matching the
 * session-query text clause's whitespace-flexible literal scan.
 * @param {string} value - text to normalize.
 * @returns {string} normalized text.
 */
function normalizeText(value) {
  return String(value).replace(/\s+/gu, ' ').trim().toLowerCase()
}

/**
 * Match cached documents locally: current surface, message types when asked,
 * literal whitespace-flexible substring.
 * @param {object[]} docs - every current-surface document.
 * @param {string} needle - normalized query.
 * @param {boolean} messagesOnly - restrict to user/assistant messages.
 * @returns {object[]} matching documents.
 */
function matchDocuments(docs, needle, messagesOnly) {
  const matched = []
  for (const doc of docs) {
    if (messagesOnly && doc.type !== 'user/message' && doc.type !== 'assistant/message') continue
    if (normalizeText(doc.text ?? '').includes(needle)) matched.push(doc)
  }
  return matched
}

/**
 * Append one diagnostic line. The profile directory is preferred when the
 * Host process exposes it; the OS temp directory is the always-writable
 * fallback (the Host main process may not inherit profile variables).
 * Best effort by design: diagnostics never break the search answer.
 * @param {string} kind - event tag, e.g. `request`, `ok`, `error`.
 * @param {string} text - already-formatted detail.
 * @returns {void}
 */
function logLine(kind, text) {
  if (!DEBUG_LOG) return
  const line = `${new Date().toISOString()} [${kind}] ${text}\n`
  try {
    const dir = process.env.DSH_PROFILE_DIR
    if (typeof dir === 'string' && dir !== '') {
      appendFileSync(join(dir, 'session-content-search.log'), line, 'utf8')
      return
    }
  } catch {}
  try {
    appendFileSync(join(tmpdir(), 'session-content-search.log'), line, 'utf8')
  } catch {}
}

/**
 * Activate the Host half.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @returns {void}
 */
export function apply(ctx) {
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: SEARCH_ROUTE,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: (request) => handleSearch(request, ctx),
      }),
    'session-content-search: search route',
  )
}

/**
 * Serve one search request.
 * Body: `{ query, messagesOnly?, limit? }`.
 * @param {Request} request - incoming request; its signal aborts the scan.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @returns {Promise<Response>} JSON answer.
 */
async function handleSearch(request, ctx) {
  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid-json' }, 400)
  }
  // A request the browser superseded or cancelled never starts a scan.
  if (request.signal.aborted) return json({ error: 'cancelled' }, 499)
  const query = typeof body?.query === 'string' ? body.query.trim() : ''
  if (query.length === 0) return json({ error: 'empty-query' }, 400)
  if (query.length > MAX_QUERY_CHARS) {
    return json({ error: 'query-too-long', message: `query must contain at most ${MAX_QUERY_CHARS} characters` }, 400)
  }
  if (query.includes('\0')) return json({ error: 'empty-query' }, 400)

  const provider = ctx.get('sessionQuery')
  if (provider === undefined || typeof provider.listSessions !== 'function'
    || typeof provider.filterEvents !== 'function') {
    logLine('error', 'sessionQuery read/filter capability is unavailable')
    return json(
      { error: 'search-unavailable', message: 'session-query service is not mounted (enable the built-in Session search plugin)' },
      503,
    )
  }

  const limit = clampLimit(body?.limit)
  const messagesOnly = body?.messagesOnly === true
  const scanOffset = Number.isSafeInteger(body?.scanOffset) && body.scanOffset > 0 ? body.scanOffset : 0
  const startedAt = Date.now()
  logLine(
    'request',
    `query=${JSON.stringify(query)} sessionId=${typeof body?.sessionId === 'string' ? body.sessionId : '-'} ` +
      `messagesOnly=${String(messagesOnly)} limit=${limit} offset=${scanOffset} mode=${typeof body?.sessionId === 'string' && body.sessionId !== '' ? 'session' : 'scan'}`,
  )

  try {
    // One session's complete log (the Ctrl+F find bar): reads every current
    // document of that session, so matches include turns the page has not
    // rendered yet.
    if (typeof body?.sessionId === 'string' && body.sessionId !== '') {
      const filters = [
        { kind: 'text', text: query },
        { kind: 'surface', values: ['current'] },
      ]
      if (messagesOnly) filters.push({ kind: 'type', values: ['user/message', 'assistant/message'] })
      const documents = await provider.filterEvents(body.sessionId, filters)
      logLine('ok', `session ${body.sessionId}: ${documents.length} hit(s) in ${Date.now() - startedAt}ms`)
      return json({
        mode: 'session',
        items: documents.map((doc) => ({
          seq: doc.seq,
          type: doc.type,
          time: doc.time,
          surface: doc.surface,
          snippet: snippetAround(doc.text ?? '', query),
        })),
        total: documents.length,
        nextOffset: null,
      })
    }

    const result = await scanSessions(provider, query, {
      limit,
      messagesOnly,
      scanOffset,
      allowPersist: body?.cache === true,
      signal: request.signal,
    })
    logLine(
      'ok',
      `${result.items.length} hit(s) from ${result.scanned}/${result.total} session(s) in ${Date.now() - startedAt}ms` +
        (result.nextOffset === null ? '' : ` next=${result.nextOffset}`),
    )
    return json(result)
  } catch (error) {
    if (request.signal.aborted) return json({ error: 'cancelled' }, 499)
    const code = error !== null && typeof error === 'object' && 'code' in error ? String(error.code) : 'search-failed'
    const message = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error && typeof error.stack === 'string' ? error.stack : ''
    logLine('error', `${code}: ${message}${stack === '' ? '' : `\n${stack}`}`)
    ctx.logger?.warn?.(`session-content-search: search failed: ${message}`)
    return json({ error: 'search-failed', code, message }, 500)
  }
}

/**
 * Scan the newest sessions with provider-independent literal-text predicates.
 * One request covers a bounded window of sessions so the palette answers
 * quickly and pages on demand; each visited session is one `filterEvents`
 * read of its own log, isolated so one damaged log cannot fail the search.
 * @param {object} provider - `ctx.sessionQuery` face.
 * @param {string} query - non-blank literal text.
 * @param {{ limit: number, messagesOnly: boolean, scanOffset: number, allowPersist: boolean, signal: AbortSignal }} options - bounds.
 * @returns {Promise<object>} wire payload.
 */
async function scanSessions(provider, query, options) {
  const { limit, messagesOnly, scanOffset, allowPersist, signal } = options
  loadPersistentCache(allowPersist)
  const records = await provider.listSessions(signal)
  // Live sessions answer from memory without reading their logs, and the
  // sessions a person searches most are the ones they recently worked in.
  const candidates = [...records].sort(
    (left, right) => (Number(right.live === true) - Number(left.live === true))
      || ((right.header.createdAt ?? 0) - (left.header.createdAt ?? 0)),
  )
  const window = candidates.slice(scanOffset, scanOffset + Math.min(SCAN_WINDOW, MAX_SESSIONS_PER_SCAN))
  const needle = normalizeText(query)
  const liveFilters = [
    { kind: 'text', text: query },
    { kind: 'surface', values: ['current'] },
  ]
  if (messagesOnly) {
    liveFilters.push({ kind: 'type', values: ['user/message', 'assistant/message'] })
  }

  const items = []
  let scanned = 0
  for (let offset = 0; offset < window.length && items.length < limit; offset += SCAN_CONCURRENCY) {
    signal.throwIfAborted()
    const batch = window.slice(offset, offset + SCAN_CONCURRENCY)
    scanned += batch.length
    // One failing log must not fail its batch: each slot resolves to a hit,
    // null (no match), or undefined (failed).
    const settled = await Promise.all(batch.map(async (record) => {
      const sessionId = record.header.id
      try {
        let documents
        if (record.live === true) {
          // Live content changes between calls, so it is always read fresh;
          // a session that went live may also have outgrown its cached copy.
          cacheDelete(sessionId)
          documents = await provider.filterEvents(sessionId, liveFilters)
        } else {
          const cached = cacheGet(sessionId)
          if (cached !== undefined) {
            documents = matchDocuments(cached, needle, messagesOnly)
          } else {
            // One read of the frozen session: cache every document, then match.
            const all = await provider.filterEvents(sessionId, ALL_CURRENT_FILTERS)
            cacheSet(sessionId, all, allowPersist)
            documents = matchDocuments(all, needle, messagesOnly)
          }
        }
        if (documents.length === 0) return null
        // The scan returns every match in the session; the newest matching
        // document is the strongest signal for the session row.
        const selected = documents.slice(-MAX_DOCS_PER_SESSION)
        const best = selected[selected.length - 1]
        return {
          sessionId,
          cwd: record.header.cwd ?? null,
          live: record.live === true,
          seq: best.seq,
          type: best.type,
          time: best.time,
          surface: best.surface,
          snippet: snippetAround(best.text ?? '', query),
        }
      } catch (error) {
        if (signal.aborted) throw error
        logLine('warn', `session ${sessionId} skipped: ${String(error?.message ?? error)}`)
        return undefined
      }
    }))
    for (const hit of settled) {
      if (hit !== null && hit !== undefined) items.push(hit)
      if (items.length >= limit) break
    }
  }
  const nextOffset = scanOffset + window.length < candidates.length
    ? scanOffset + window.length
    : null
  return {
    mode: 'sessions',
    items,
    nextCursor: null,
    nextOffset,
    scanned: scanOffset + scanned,
    total: candidates.length,
    cached: coldDocCache.size,
  }
}

/**
 * Extract a plain-text excerpt around the first literal occurrence.
 * @param {string} text - semantic document text.
 * @param {string} query - literal query.
 * @returns {string} excerpt of at most SNIPPET_CHARS characters.
 */
function snippetAround(text, query) {
  const source = typeof text === 'string' ? text : ''
  if (source === '') return ''
  const at = source.toLowerCase().indexOf(query.toLowerCase())
  const start = at <= 0 ? 0 : Math.max(0, at - Math.floor(SNIPPET_CHARS / 3))
  const excerpt = source.slice(start, start + SNIPPET_CHARS).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${excerpt}${start + SNIPPET_CHARS < source.length ? '…' : ''}`
}

/**
 * Clamp a requested page size into the accepted range.
 * @param {unknown} value - raw request field.
 * @returns {number} limit between 1 and MAX_LIMIT.
 */
function clampLimit(value) {
  const parsed = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(1, parsed))
}

/**
 * Serialize one JSON answer.
 * @param {unknown} data - JSON-serializable payload.
 * @param {number} status - HTTP status code.
 * @returns {Response} the answer.
 */
function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}
