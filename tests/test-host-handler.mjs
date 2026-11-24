/**
 * Offline integration test for the Host half of @local/session-content-search.
 *
 * Mocks the Cordis context seams (connection.fetch.register, ctx.get) and a
 * sessionQuery read/filter face, then drives the actually-registered route
 * handler through real Request/Response objects. Verified behavior: route
 * registration, live-first scan order, cold-document caching, local literal
 * matching, per-session failure isolation, and error translation — without
 * ever touching SQLite.
 *
 * Each test uses its own fixture ids because the cold-document cache is
 * module-level state that intentionally survives between searches.
 *
 * Run:  node --input-type=module tests/test-host-handler.mjs
 */

import assert from 'node:assert/strict'

// Keep the offline test run from touching the real log or cache files.
delete process.env.DSH_PROFILE_DIR
process.env.SESSION_CONTENT_SEARCH_NO_PERSIST = '1'

const PLUGIN_DIR = new URL('../', import.meta.url)
const host = await import(new URL('index.js', PLUGIN_DIR))

/** Recorded registration from the mocked connection service. */
let registered = null

/** Unique-id fixtures: one live session and two cold ones, newest first. */
function makeFixtures(tag) {
  const ids = {
    live: `${tag}-live`,
    coldNew: `${tag}-cold-new`,
    coldOld: `${tag}-cold-old`,
  }
  const records = [
    { header: { id: ids.live, cwd: 'F:/work/app1', createdAt: 3 }, live: true },
    { header: { id: ids.coldNew, createdAt: 2 }, live: false },
    { header: { id: ids.coldOld, cwd: 'F:/work/app2', createdAt: 1 }, live: false },
  ]
  const documentsBySession = {
    [ids.live]: [
      { sessionId: ids.live, seq: 5, type: 'user/message', time: 30, surface: 'current', text: 'the pool leak fix plan' },
      { sessionId: ids.live, seq: 9, type: 'tool/result', time: 31, surface: 'current', text: 'build ok after pool leak fix' },
    ],
    [ids.coldNew]: [
      { sessionId: ids.coldNew, seq: 1, type: 'user/message', time: 20, surface: 'current', text: 'unrelated note about builds' },
    ],
    [ids.coldOld]: [
      { sessionId: ids.coldOld, seq: 2, type: 'assistant/message', time: 10, surface: 'current', text: 'pool leak: replaced the connection pool' },
    ],
  }
  return { ids, records, documentsBySession }
}

/** One session-query face double: list + filter-aware per-session read. */
function makeProvider({ records, documentsBySession, failSessions = new Set() } = {}) {
  const calls = { list: 0, filter: [] }
  return {
    calls,
    async listSessions() {
      calls.list += 1
      return records ?? []
    },
    async filterEvents(sessionId, filters) {
      calls.filter.push({ sessionId, filters })
      if (failSessions.has(sessionId)) throw new Error(`corrupt log: ${sessionId}`)
      let documents = documentsBySession?.[sessionId] ?? []
      // Mirror the session-query semantics the handler relies on: literal,
      // whitespace-flexible text matching and optional type restriction.
      const textFilter = filters.find((filter) => filter.kind === 'text')
      if (textFilter) {
        const needle = String(textFilter.text).replace(/\s+/gu, ' ').trim().toLowerCase()
        documents = documents.filter(
          (doc) => String(doc.text ?? '').replace(/\s+/gu, ' ').trim().toLowerCase().includes(needle),
        )
      }
      const typeFilter = filters.find((filter) => filter.kind === 'type')
      if (typeFilter) documents = documents.filter((doc) => typeFilter.values.includes(doc.type))
      return documents
    },
  }
}

function makeCtx(provider) {
  const warnings = []
  const ctx = {
    get(name) {
      return name === 'sessionQuery' ? provider : undefined
    },
    effect(fn) {
      const disposer = fn()
      return () => disposer?.()
    },
    logger: { warn: (...args) => warnings.push(args.join(' ')) },
    connection: {
      fetch: {
        register(options) {
          registered = options
          return () => {}
        },
      },
    },
  }
  return ctx
}

async function activate(ctx) {
  ctx.effect(() => host.apply(ctx))
  assert.ok(registered, 'apply() must register the connection fetch route')
  assert.equal(registered.path, '/api/session-content-search/search')
  assert.deepEqual(registered.methods, ['POST'])
  assert.equal(registered.requestBody, 'buffered')
  return registered.fetch
}

async function callJson(handler, body) {
  const request = new Request('http://127.0.0.1:50110/api/session-content-search/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const response = await handler(request)
  const data = await response.json()
  return { status: response.status, data }
}

let passed = 0
async function test(name, fn) {
  await fn()
  passed++
  console.log('ok - ' + name)
}

await test('apply registers the /api route', async () => {
  const fixture = makeFixtures('route')
  await activate(makeCtx(makeProvider({ records: [], documentsBySession: {} })))
  assert.ok(fixture)
})

await test('scan returns live-first hits with the newest matching document', async () => {
  const { ids, records, documentsBySession } = makeFixtures('order')
  const handler = await activate(makeCtx(makeProvider({ records, documentsBySession })))

  const { status, data } = await callJson(handler, { query: 'pool leak' })
  assert.equal(status, 200)
  assert.equal(data.mode, 'sessions')
  assert.equal(data.items.length, 2)
  assert.equal(data.items[0].sessionId, ids.live)
  assert.equal(data.items[0].seq, 9)
  assert.equal(data.items[0].type, 'tool/result')
  assert.equal(data.items[0].cwd, 'F:/work/app1')
  assert.match(data.items[0].snippet, /pool leak fix/)
  assert.equal(data.items[1].sessionId, ids.coldOld)
  assert.equal(data.items[1].cwd, 'F:/work/app2')
  assert.equal(data.total, 3)
  assert.equal(data.scanned, 3)
  assert.equal(data.nextCursor, null)
})

await test('live sessions are scanned before newer cold ones', async () => {
  const tag = 'livefirst'
  const records = [
    { header: { id: `${tag}-cold`, createdAt: 99 }, live: false },
    { header: { id: `${tag}-live`, createdAt: 1 }, live: true },
  ]
  const documentsBySession = {
    [`${tag}-cold`]: [{ sessionId: `${tag}-cold`, seq: 1, type: 'user/message', time: 1, surface: 'current', text: 'hit here' }],
    [`${tag}-live`]: [{ sessionId: `${tag}-live`, seq: 2, type: 'user/message', time: 2, surface: 'current', text: 'hit here too' }],
  }
  const handler = await activate(makeCtx(makeProvider({ records, documentsBySession })))

  const { data } = await callJson(handler, { query: 'hit' })
  assert.equal(data.items[0].sessionId, `${tag}-live`)
  assert.equal(data.items[1].sessionId, `${tag}-cold`)
})

await test('cold documents are cached: a repeat search reads only the live session', async () => {
  const { ids, records, documentsBySession } = makeFixtures('cache')
  const provider = makeProvider({ records, documentsBySession })
  const handler = await activate(makeCtx(provider))

  await callJson(handler, { query: 'pool' })
  const firstReads = provider.calls.filter.length
  assert.equal(firstReads, 3)

  await callJson(handler, { query: 'leak' })
  const secondReads = provider.calls.filter.length
  // Only the live session is read again; the two cold sessions come from cache.
  assert.equal(secondReads - firstReads, 1)
  assert.equal(provider.calls.filter[secondReads - 1].sessionId, ids.live)
})

await test('a repeat search still finds the cached cold hits', async () => {
  const { ids, records, documentsBySession } = makeFixtures('cachehit')
  const handler = await activate(makeCtx(makeProvider({ records, documentsBySession })))

  await callJson(handler, { query: 'warmup' }) // populate the cache
  const { data } = await callJson(handler, { query: 'connection pool' })
  assert.equal(data.items.length, 1)
  assert.equal(data.items[0].sessionId, ids.coldOld)
})

await test('cold matching is whitespace-flexible and case-insensitive', async () => {
  const { records, documentsBySession } = makeFixtures('flex')
  const handler = await activate(makeCtx(makeProvider({ records, documentsBySession })))

  const upper = await callJson(handler, { query: 'POOL   LEAK' })
  assert.ok(upper.data.items.length >= 1)
  assert.equal(upper.data.items[0].sessionId, upper.data.items[0].sessionId)
  const lower = await callJson(handler, { query: 'pool leak' })
  assert.equal(lower.data.items.length, upper.data.items.length)
})

await test('matching is substring, not token-based: an inner fragment hits', async () => {
  const { ids, records, documentsBySession } = makeFixtures('substring')
  const handler = await activate(makeCtx(makeProvider({ records, documentsBySession })))

  // "ool lea" is a fragment inside "pool leak" — a token-based search would miss it.
  const { data } = await callJson(handler, { query: 'ool lea' })
  assert.ok(data.items.length >= 1, 'inner fragment must match')
  assert.equal(data.items.some((item) => item.sessionId === ids.coldOld), true)
  // A bare fragment of a word ("ool") hits as well.
  const fragment = await callJson(handler, { query: 'ool' })
  assert.ok(fragment.data.items.length >= 1, 'word-inner fragment must match')
})

await test('messagesOnly adds the message-type filter for live sessions', async () => {
  const { ids, records, documentsBySession } = makeFixtures('types')
  const provider = makeProvider({ records, documentsBySession })
  const handler = await activate(makeCtx(provider))

  await callJson(handler, { query: 'pool', messagesOnly: true })
  const liveCall = provider.calls.filter.find((call) => call.sessionId === ids.live)
  assert.ok(liveCall, 'live session must be read through the text filter')
  assert.deepEqual(liveCall.filters, [
    { kind: 'text', text: 'pool' },
    { kind: 'surface', values: ['current'] },
    { kind: 'type', values: ['user/message', 'assistant/message'] },
  ])
})

await test('cold sessions are read once with the surface filter only', async () => {
  const { ids, records, documentsBySession } = makeFixtures('coldread')
  const provider = makeProvider({ records, documentsBySession })
  const handler = await activate(makeCtx(provider))

  await callJson(handler, { query: 'pool' })
  const coldCall = provider.calls.filter.find((call) => call.sessionId === ids.coldOld)
  assert.ok(coldCall)
  assert.deepEqual(coldCall.filters, [{ kind: 'surface', values: ['current'] }])
})

await test('messagesOnly on cached documents keeps message types only', async () => {
  const { ids, records, documentsBySession } = makeFixtures('cachedtypes')
  const handler = await activate(makeCtx(makeProvider({ records, documentsBySession })))

  await callJson(handler, { query: 'warmup' })
  const { data } = await callJson(handler, { query: 'pool', messagesOnly: true })
  // The live session still contributes its message hit; nothing cached is a
  // tool/result, so the cached sessions keep their message hits.
  assert.ok(data.items.some((item) => item.sessionId === ids.coldOld))
})

await test('scan pages through sessions with nextOffset', async () => {
  const tag = 'paging'
  const records = []
  const documentsBySession = {}
  for (let index = 0; index < 50; index += 1) {
    const id = `${tag}-${String(index).padStart(2, '0')}`
    records.push({ header: { id, createdAt: 100 - index }, live: false })
    documentsBySession[id] = index % 10 === 0
      ? [{ sessionId: id, seq: 1, type: 'user/message', time: 1, surface: 'current', text: 'paging needle' }]
      : [{ sessionId: id, seq: 1, type: 'user/message', time: 1, surface: 'current', text: 'unrelated' }]
  }
  const provider = makeProvider({ records, documentsBySession })
  const handler = await activate(makeCtx(provider))

  const first = await callJson(handler, { query: 'needle' })
  assert.equal(first.data.scanned, 40)
  assert.equal(first.data.nextOffset, 40)
  assert.equal(first.data.total, 50)
  // Indexes 0/10/20/30 fall inside the first 40-session window.
  assert.equal(first.data.items.length, 4)

  const second = await callJson(handler, { query: 'needle', scanOffset: 40 })
  assert.equal(second.data.scanned, 50)
  assert.equal(second.data.nextOffset, null)
  // Indexes 0,10,20,30,40 match: 4 on the first page, 1 on the second.
  assert.equal(second.data.items.length, 1)
  assert.equal(second.data.items[0].sessionId, `${tag}-40`)
})

await test('sessionId scopes the search to one complete log', async () => {
  const { ids, records, documentsBySession } = makeFixtures('sessionmode')
  const provider = makeProvider({ records, documentsBySession })
  const handler = await activate(makeCtx(provider))

  const { status, data } = await callJson(handler, { query: 'pool', sessionId: ids.live })
  assert.equal(status, 200)
  assert.equal(data.mode, 'session')
  assert.equal(data.total, 2)
  assert.equal(data.items.length, 2)
  assert.equal(data.items[0].seq, 5)
  assert.equal(data.items[0].type, 'user/message')
  assert.match(data.items[0].snippet, /pool/)
  const call = provider.calls.filter.find((entry) => entry.sessionId === ids.live)
  assert.ok(call, 'the session branch must read the target session')
  assert.deepEqual(call.filters, [
    { kind: 'text', text: 'pool' },
    { kind: 'surface', values: ['current'] },
  ])
})

await test('a failing session is isolated, others still return', async () => {
  const { ids, records, documentsBySession } = makeFixtures('isolate')
  const provider = makeProvider({ records, documentsBySession, failSessions: new Set([ids.live]) })
  const handler = await activate(makeCtx(provider))

  const { status, data } = await callJson(handler, { query: 'pool leak' })
  assert.equal(status, 200)
  assert.equal(data.items.length, 1)
  assert.equal(data.items[0].sessionId, ids.coldOld)
})

await test('limit bounds the returned hits', async () => {
  const { records, documentsBySession } = makeFixtures('limit')
  const handler = await activate(makeCtx(makeProvider({ records, documentsBySession })))

  const { data } = await callJson(handler, { query: 'pool', limit: 1 })
  assert.equal(data.items.length, 1)
})

await test('snippet is excerpted around the match with ellipses', async () => {
  const tag = 'snippet'
  const long = 'A'.repeat(300) + ' needle here ' + 'B'.repeat(300)
  const provider = makeProvider({
    records: [{ header: { id: `${tag}-one`, createdAt: 1 }, live: true }],
    documentsBySession: {
      [`${tag}-one`]: [{ sessionId: `${tag}-one`, seq: 1, type: 'user/message', time: 1, surface: 'current', text: long }],
    },
  })
  const handler = await activate(makeCtx(provider))

  const { data } = await callJson(handler, { query: 'needle' })
  assert.match(data.items[0].snippet, /needle here/)
  assert.ok(data.items[0].snippet.startsWith('…'))
  assert.ok(data.items[0].snippet.endsWith('…'))
  assert.ok(data.items[0].snippet.length < 260)
})

await test('blank query is refused without scanning', async () => {
  const { records } = makeFixtures('blank')
  const provider = makeProvider({ records })
  const handler = await activate(makeCtx(provider))

  const { status, data } = await callJson(handler, { query: '   ' })
  assert.equal(status, 400)
  assert.equal(data.error, 'empty-query')
  assert.equal(provider.calls.list, 0)
})

await test('oversized query is refused', async () => {
  const { records } = makeFixtures('long')
  const handler = await activate(makeCtx(makeProvider({ records })))

  const { status, data } = await callJson(handler, { query: 'x'.repeat(600) })
  assert.equal(status, 400)
  assert.equal(data.error, 'query-too-long')
})

await test('invalid JSON body answers 400', async () => {
  const { records } = makeFixtures('json')
  const provider = makeProvider({ records })
  const handler = await activate(makeCtx(provider))

  const request = new Request('http://127.0.0.1/api/session-content-search/search', {
    method: 'POST',
    body: 'not json',
  })
  const response = await handler(request)
  assert.equal(response.status, 400)
  assert.equal(provider.calls.list, 0)
})

await test('missing provider answers 503 with a stable code', async () => {
  const handler = await activate(makeCtx(undefined))
  const { status, data } = await callJson(handler, { query: 'x' })
  assert.equal(status, 503)
  assert.equal(data.error, 'search-unavailable')
})

await test('provider list failure answers 500 with its code', async () => {
  const provider = {
    async listSessions() {
      throw Object.assign(new Error('boom'), { code: 'SESSION_QUERY_CORRUPT_SESSION' })
    },
    async filterEvents() {
      return []
    },
  }
  const handler = await activate(makeCtx(provider))

  const { status, data } = await callJson(handler, { query: 'x' })
  assert.equal(status, 500)
  assert.equal(data.error, 'search-failed')
  assert.equal(data.code, 'SESSION_QUERY_CORRUPT_SESSION')
})

await test('aborted requests answer 499 without scanning', async () => {
  const { records } = makeFixtures('abort')
  const provider = makeProvider({ records })
  const handler = await activate(makeCtx(provider))

  const controller = new AbortController()
  const request = new Request('http://127.0.0.1/api/session-content-search/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'x' }),
    signal: controller.signal,
  })
  controller.abort()
  const response = await handler(request)
  assert.equal(response.status, 499)
  assert.equal(provider.calls.list, 0)
})

console.log(`\n${passed} tests passed`)
