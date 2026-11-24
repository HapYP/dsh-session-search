/**
 * Module-shape smoke test for the browser half of @local/session-content-search.
 *
 * Evaluates the real client.js factory against a stubbed module loader and
 * require table (React/ReactDOM stubs suffice: the factory only captures
 * references), then drives apply() against a mocked Client context that
 * records effects without executing them (no DOM in Node).
 *
 * Run:  node --input-type=module tests/smoke-client.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CLIENT_URL = new URL('../client.js', import.meta.url)
const source = readFileSync(fileURLToPath(CLIENT_URL), 'utf8')

/** Captured handoff from window.__ModuleLoader__.load. */
let handoff = null

globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      handoff = entry
    },
  },
}

const reactStub = { createElement: (type, props) => ({ type, props }) }
function requireStub(spec) {
  if (spec === 'react') return reactStub
  if (spec === 'react-dom') return { createPortal: () => ({}) }
  throw new Error('unexpected require: ' + spec)
}

// Evaluate the bundle exactly like the page does: as a factory script.
new Function('window', 'require', source)(globalThis.window, requireStub)

assert.ok(handoff, 'client.js must register through __ModuleLoader__.load')
assert.equal(handoff.id, '@hapyp/dsh-session-search')
assert.equal(typeof handoff.factory, 'function')

const plugin = handoff.factory(requireStub)
assert.ok(plugin && typeof plugin === 'object', 'factory must return the plugin object')
assert.equal(typeof plugin.apply, 'function')
assert.deepEqual([...plugin.inject].sort(), ['locale', 'sessions', 'slots', 'uiWorkspace'])

/** Mock Client context: record slot injections and effect labels, run nothing. */
const injectedSlots = []
const effectLabels = []
let localeBoundNs = null
const ctx = {
  locale: {
    register(ns, locale, dict) {
      assert.equal(typeof dict['palette.open'], 'string')
      return () => {}
    },
    getSnapshot: () => ({ active: 'zh' }),
    bind(ns) {
      localeBoundNs = ns
      return (key) => key
    },
  },
  slots: {
    inject(key, callback) {
      injectedSlots.push(key)
      callback()
    },
    register(options, component) {
      assert.equal(typeof component, 'function')
      return () => {}
    },
  },
  sessions: { list: { getSnapshot: () => ({ byId: {} }) } },
  uiWorkspace: { openSession: () => {} },
  effect(fn, label) {
    effectLabels.push(label)
    // The locale effect is DOM-free and wires `translate`; effects touching
    // the document stay unexecuted in this Node smoke run.
    if (label === 'session-content-search: locale') fn()
    return () => {}
  },
}

plugin.apply(ctx)

assert.equal(localeBoundNs, 'session-content-search')
assert.deepEqual(
  [...injectedSlots].sort(),
  ['conversation.session.header.utilities', 'shell.overlay', 'sidebar.footer.action'].sort(),
)
assert.ok(effectLabels.includes('session-content-search: locale'))
assert.ok(effectLabels.includes('session-content-search: shortcuts'))
assert.ok(effectLabels.includes('session-content-search: styles'))

console.log('ok - client factory, inject list, apply wiring, three slot registrations')
