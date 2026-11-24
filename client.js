/**
 * Browser half of @local/session-content-search.
 *
 * Registers three UI contributions:
 * - `shell.overlay`: the cross-workspace content search palette (Ctrl+Shift+F).
 * - `conversation.session.header.utilities`: the in-conversation find bar (Ctrl+F).
 * - `sidebar.footer.action`: the sidebar button that opens the palette.
 *
 * Search runs on the Host half through an authenticated same-origin `/api`
 * route; everything else is local. Plain React without JSX, own styles with
 * the `scs-` class prefix and `--dsw-alias-*` theme tokens only.
 */
window.__ModuleLoader__.load({
  id: '@hapyp/dsh-session-search',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement

    const PLUGIN_ID = 'session-content-search'
    const NS = 'session-content-search'
    const SEARCH_ROUTE = '/api/session-content-search/search'

    /* ------------------------------------------------------------------ *
     * Locale dictionaries (registered through the Client locale service).
     * ------------------------------------------------------------------ */

    const en = {
      'palette.open': 'Search session content',
      'entry.label': 'Search all sessions',
      'entry.keys': 'Ctrl Shift F',
      'palette.placeholder': 'Search all sessions…',
      'palette.includeTools': 'Include tool text',
      'palette.diskCache': 'Disk cache',
      'palette.diskCacheHint':
        'Off (default): nothing is written to disk; the first search after each DSH start takes a few seconds. On: session text is cached in the system temp folder so that first search is near-instant.',
      'palette.diskCacheHintShort': 'write scanned session text to the temp folder to speed up the first search after a restart',
      'palette.searching': 'Searching…',
      'palette.idle': 'Type a keyword to search every session in every workspace.',
      'palette.noMatches': 'No session matches this keyword.',
      'palette.noMatchesPartial': 'No match in the scanned sessions yet — scan older sessions to continue.',
      'palette.needBackend': 'Full-text search backend is unavailable on the Host mainline (session-content-search-query row).',
      'palette.error': 'Search failed. Try again in a moment.',
      'palette.more': 'Scan older sessions',
      'palette.hint': 'Enter open · ↑↓ select · Esc close',
      'row.untitled': 'Untitled session',
      'find.open': 'Find in conversation',
      'find.placeholder': 'Find in conversation…',
      'find.noMatches': 'No matches',
      'find.start': 'Start search',
      'find.atStart': 'Start of matches',
      'find.atEnd': 'End of matches',
      'find.historyOnly': '{count} match(es) in the full history — scroll up to load them',
      'find.historyMore': '{count} in full history',
    }

    const zh = {
      'palette.open': '搜索会话内容',
      'entry.label': '搜索全部会话',
      'entry.keys': 'Ctrl Shift F',
      'palette.placeholder': '搜索所有会话…',
      'palette.includeTools': '包含工具输出',
      'palette.diskCache': '磁盘缓存',
      'palette.diskCacheHint':
        '关闭（默认）：不向磁盘写入任何内容，每次 DSH 启动后的首次搜索需要数秒。开启：会话文本会缓存在系统临时目录，使首次搜索接近即时。',
      'palette.diskCacheHintShort': '把扫描过的会话文本写入系统临时目录，加快重启后的首次搜索',
      'palette.searching': '搜索中…',
      'palette.idle': '输入关键字，搜索所有工作区中的全部会话内容。',
      'palette.noMatches': '没有会话匹配该关键字。',
      'palette.noMatchesPartial': '已扫描的会话中暂无匹配——可继续扫描更早的会话。',
      'palette.needBackend': '全文搜索后端不可用：Host 主线未挂载搜索索引（session-content-search-query 行）。',
      'palette.error': '搜索失败，请稍后重试。',
      'palette.more': '继续扫描更早的会话',
      'palette.hint': 'Enter 打开 · ↑↓ 选择 · Esc 关闭',
      'row.untitled': '未命名会话',
      'find.open': '在会话中查找',
      'find.placeholder': '在会话中查找…',
      'find.noMatches': '无匹配',
      'find.start': '开始搜索',
      'find.atStart': '已到开头',
      'find.atEnd': '已到末尾',
      'find.historyOnly': '完整历史中共 {count} 条——向上滚动加载后可定位',
      'find.historyMore': '完整历史共 {count} 条',
    }

    /* ------------------------------------------------------------------ *
     * Minimal observable store (snapshot stable between mutations).
     * ------------------------------------------------------------------ */

    function createStore(initial) {
      let state = initial
      const subscribers = new Set()
      return {
        get: () => state,
        set: (next) => {
          if (Object.is(next, state)) return
          state = next
          for (const notify of [...subscribers]) notify()
        },
        subscribe: (fn) => {
          subscribers.add(fn)
          return () => subscribers.delete(fn)
        },
      }
    }

    const paletteStore = createStore({ open: false })
    const findStore = createStore({ open: false, focusRequest: 0, prefill: null })

    /** localStorage key for the opt-in disk cache preference. */
    const DISK_CACHE_KEY = 'dsh-session-search.diskCache'

    /**
     * Read the disk-cache preference. Disk caching is opt-in: an absent or
     * unreadable value means off, so nothing reaches the disk by default.
     * @returns {boolean} whether the person enabled disk caching.
     */
    function readDiskCachePreference() {
      try {
        return window.localStorage.getItem(DISK_CACHE_KEY) === '1'
      } catch {
        return false
      }
    }

    /**
     * Persist the disk-cache preference.
     * @param {boolean} enabled - the new value.
     * @returns {void}
     */
    function writeDiskCachePreference(enabled) {
      try {
        window.localStorage.setItem(DISK_CACHE_KEY, enabled ? '1' : '0')
      } catch {}
    }

    function useStoreValue(store) {
      return React.useSyncExternalStore(store.subscribe, store.get)
    }

    /* ------------------------------------------------------------------ *
     * Shared runtime seams (assigned in apply).
     * ------------------------------------------------------------------ */

    let sharedCtx = null
    let translate = (key) => key

    /** The session the main conversation view currently retains, if any. */
    function currentSessionId() {
      try {
        const list = sharedCtx?.sessions?.list?.getSnapshot?.()
        if (!list || !list.byId) return null
        for (const row of Object.values(list.byId)) {
          if ((row?.retainedBy?.mainView ?? 0) > 0) return row.id
        }
      } catch {}
      return null
    }

    /**
     * The page text the user currently has selected, collapsed to one line
     * and bounded so it can serve as a find query. Empty when nothing is
     * selected or the selection is too long to be a useful phrase.
     * @returns {string} the selection text, or ''.
     */
    function selectedText() {
      try {
        const selection = window.getSelection?.()
        if (!selection || selection.isCollapsed === true) return ''
        const raw = String(selection.toString()).replace(/\s+/gu, ' ').trim()
        if (raw === '' || raw.length > 200) return ''
        return raw
      } catch {
        return ''
      }
    }

    /** Authenticated same-origin POST used for every Host call. */
    function postJson(path, body, signal) {
      const carrier = globalThis.__DSH_TRANSPORT__?.fetch
      const send = typeof carrier === 'function' ? carrier : fetch
      // Resolve against the page base like the shipped uploaders do: the
      // Desktop window may serve the GUI over its own dsh-app scheme.
      const url = new URL(path, document.baseURI).href
      return send(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      }).then(async (response) => {
        let data = null
        try {
          data = await response.json()
        } catch {}
        if (!response.ok) {
          const error = new Error(data?.message || `HTTP ${response.status}`)
          error.code = data?.error || 'request-failed'
          error.detail = data?.code
          throw error
        }
        return data
      })
    }

    /* ------------------------------------------------------------------ *
     * Small formatting helpers.
     * ------------------------------------------------------------------ */

    function timeText(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms)) return ''
      const date = new Date(ms)
      const now = new Date()
      const sameDay = date.getFullYear() === now.getFullYear()
        && date.getMonth() === now.getMonth()
        && date.getDate() === now.getDate()
      const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
      if (sameDay) return clock
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    }

    function cwdTail(cwd) {
      if (typeof cwd !== 'string' || cwd === '') return ''
      const parts = cwd.replace(/[\\/]+$/, '').split(/[\\/]/)
      return parts[parts.length - 1] || cwd
    }

    function typeTagKey(type) {
      switch (type) {
        case 'user/message': return 'tag.user'
        case 'assistant/message': return 'tag.assistant'
        case 'tool/call': return 'tag.toolCall'
        case 'tool/result': return 'tag.toolResult'
        case 'todo/write': return 'tag.todo'
        case 'turn/end': return 'tag.turnEnd'
        default: return null
      }
    }

    const TAG_DICT = {
      en: {
        'tag.user': 'user', 'tag.assistant': 'assistant', 'tag.toolCall': 'tool call',
        'tag.toolResult': 'tool result', 'tag.todo': 'todo', 'tag.turnEnd': 'turn',
      },
      zh: {
        'tag.user': '用户', 'tag.assistant': '助手', 'tag.toolCall': '工具调用',
        'tag.toolResult': '工具结果', 'tag.todo': '任务', 'tag.turnEnd': '回合',
      },
    }
    let tagLocale = 'en'

    function tagLabel(type) {
      const key = typeTagKey(type)
      if (key === null) return type
      const dict = TAG_DICT[tagLocale] || TAG_DICT.en
      return dict[key] || type
    }

    /**
     * Split a snippet into text and <mark> parts around the query tokens.
     * @param {string} snippet - Host-returned plain text.
     * @param {string} query - the raw query.
     * @returns {Array} React nodes.
     */
    function snippetParts(snippet, query) {
      const text = typeof snippet === 'string' ? snippet : ''
      const tokens = [...new Set((query || '').trim().toLowerCase().split(/\s+/).filter(Boolean))]
      if (text === '' || tokens.length === 0) return [text]
      const lower = text.toLowerCase()
      const ranges = []
      for (const token of tokens) {
        let idx = lower.indexOf(token)
        while (idx !== -1) {
          ranges.push([idx, idx + token.length])
          idx = lower.indexOf(token, idx + token.length)
        }
      }
      if (ranges.length === 0) return [text]
      ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1])
      const merged = []
      for (const range of ranges) {
        const last = merged[merged.length - 1]
        if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
        else merged.push([range[0], range[1]])
      }
      const parts = []
      let position = 0
      for (const [start, end] of merged) {
        if (start > position) parts.push(text.slice(position, start))
        parts.push(h('mark', { key: `${start}:${end}`, className: 'scs-mark' }, text.slice(start, end)))
        position = end
      }
      if (position < text.length) parts.push(text.slice(position))
      return parts
    }

    /* ------------------------------------------------------------------ *
     * Global search palette (shell.overlay entry).
     * ------------------------------------------------------------------ */

    const SEARCH_DEBOUNCE_MS = 280

    function PaletteOverlay(props) {
      const { open } = useStoreValue(paletteStore)
      const [query, setQuery] = React.useState('')
      const [includeTools, setIncludeTools] = React.useState(true)
      const [diskCache, setDiskCache] = React.useState(() => readDiskCachePreference())
      const [status, setStatus] = React.useState('idle')
      const [items, setItems] = React.useState([])
      const [cursor, setCursor] = React.useState(null)
      const [errorCode, setErrorCode] = React.useState(null)
      const [selected, setSelected] = React.useState(0)
      const inputRef = React.useRef(null)
      const abortRef = React.useRef(null)
      const queryRef = React.useRef('')
      const lastErrorRef = React.useRef(null)

      const listState = typeof props?.useSessions === 'function' ? props.useSessions((state) => state) : null
      const workspaceState = typeof props?.useWorkspaces === 'function' ? props.useWorkspaces((state) => state) : null

      // Focus the input whenever the palette opens.
      React.useEffect(() => {
        if (!open) return
        const timer = window.setTimeout(() => {
          const input = inputRef.current
          if (input) {
            input.focus()
            input.select()
          }
        }, 0)
        return () => window.clearTimeout(timer)
      }, [open])

      const runSearch = React.useCallback((rawQuery, appendCursor, includeToolText, cacheToDisk) => {
        const trimmed = rawQuery.trim()
        if (abortRef.current) abortRef.current.abort()
        const controller = new AbortController()
        abortRef.current = controller
        if (trimmed === '') {
          setStatus('idle')
          setItems([])
          setCursor(null)
          setErrorCode(null)
          setSelected(0)
          lastErrorRef.current = null
          return
        }
        setStatus('loading')
        setErrorCode(null)
        lastErrorRef.current = null
        const recordFailure = (error) => {
          if (controller.signal.aborted || error?.name === 'AbortError') return
          lastErrorRef.current = [error?.code, error?.detail, error?.message]
            .filter((part) => typeof part === 'string' && part !== '')
            .join(' · ')
          setStatus('error')
          setErrorCode(error?.code || 'search-failed')
        }
        /**
         * Second path: the built-in authorized content search over the RPC
         * channel. It matches user/assistant messages only and carries no
         * type/time metadata, but it does not depend on the plugin's own
         * /api bridge, so it keeps the palette working when that bridge is
         * the broken link.
         */
        const fallbackToBuiltinSearch = async () => {
          try {
            const result = await sharedCtx?.sessions?.search?.(trimmed, controller.signal)
            if (controller.signal.aborted) return
            if (result && result.ok === true && Array.isArray(result.value?.items)) {
              setItems(result.value.items.map((item) => ({
                sessionId: item.sessionId,
                snippet: item.snippet,
                type: 'user/message',
                time: null,
                cwd: null,
                seq: null,
              })))
              setCursor(null)
              setStatus('ready')
              setSelected(0)
              return
            }
            const failure = result && result.ok === false ? result.error : null
            recordFailure(Object.assign(
              new Error((failure && (failure.message || failure.rpcError?.message)) || 'builtin search failed'),
              { code: 'search-failed', detail: failure && failure.rpcError?.code },
            ))
          } catch (error) {
            if (controller.signal.aborted || error?.name === 'AbortError') return
            recordFailure(error)
          }
        }
        postJson(SEARCH_ROUTE, {
          query: trimmed,
          messagesOnly: !includeToolText,
          limit: 30,
          cache: cacheToDisk === true,
          ...(appendCursor !== null && appendCursor !== undefined ? { scanOffset: appendCursor } : {}),
        }, controller.signal).then((page) => {
          if (controller.signal.aborted) return
          setItems((previous) => (appendCursor ? [...previous, ...(page.items || [])] : [...(page.items || [])]))
          setCursor(typeof page.nextOffset === 'number' ? page.nextOffset : null)
          setStatus('ready')
          setSelected((previous) => (appendCursor ? previous : 0))
        }).catch((error) => {
          if (controller.signal.aborted || error?.name === 'AbortError') return
          if (error?.code === 'search-unavailable') {
            recordFailure(error)
            return
          }
          void fallbackToBuiltinSearch()
        })
      }, [])

      // Debounced search whenever query/toggle/open change.
      React.useEffect(() => {
        if (!open) {
          if (abortRef.current) abortRef.current.abort()
          return undefined
        }
        const timer = window.setTimeout(() => {
          runSearch(query, null, includeTools, diskCache)
        }, queryRef.current === query ? 0 : SEARCH_DEBOUNCE_MS)
        queryRef.current = query
        return () => window.clearTimeout(timer)
      }, [open, query, includeTools, diskCache, runSearch])

      // Stop any in-flight request and drop highlights when closed.
      React.useEffect(() => {
        if (open) return undefined
        return () => {}
      }, [open])
      React.useEffect(() => () => {
        if (abortRef.current) abortRef.current.abort()
      }, [])

      if (!open) return null

      const byId = listState?.byId || {}
      const workspaceBySession = new Map()
      if (workspaceState && Array.isArray(workspaceState.items)) {
        for (const workspace of workspaceState.items) {
          const ids = Array.isArray(workspace?.sessionIds) ? workspace.sessionIds : []
          for (const sessionId of ids) {
            if (!workspaceBySession.has(sessionId)) workspaceBySession.set(sessionId, workspace.title || '')
          }
        }
      }

      const rows = items.map((item) => {
        const summary = byId[item.sessionId]
        const title = typeof summary?.title === 'string' && summary.title.trim() !== ''
          ? summary.title
          : translate('row.untitled')
        return {
          ...item,
          title,
          workspace: workspaceBySession.get(item.sessionId) || cwdTail(item.cwd),
        }
      })

      const openResult = (sessionId) => {
        if (typeof sessionId !== 'string' || sessionId === '') return
        paletteStore.set({ open: false })
        try {
          sharedCtx?.uiWorkspace?.openSession?.(sessionId)
        } catch (error) {
          console.error('[session-content-search] open session failed:', error)
        }
      }

      const moveSelection = (delta) => {
        if (rows.length === 0) return
        setSelected((previous) => (previous + delta + rows.length) % rows.length)
      }

      const onKeyDown = (event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          moveSelection(1)
        } else if (event.key === 'ArrowUp') {
          event.preventDefault()
          moveSelection(-1)
        } else if (event.key === 'Enter') {
          event.preventDefault()
          const row = rows[selected]
          if (row) openResult(row.sessionId)
        }
      }

      const bodyStatus = status === 'loading' && rows.length === 0
        ? hintOf(translate('palette.searching'))
        : status === 'error'
          ? hintOf(errorCode === 'search-unavailable' ? translate('palette.needBackend') : translate('palette.error'), true)
          : rows.length === 0
            ? hintOf(query.trim() === ''
              ? translate('palette.idle')
              : cursor !== null
                ? translate('palette.noMatchesPartial')
                : translate('palette.noMatches'))
            : null

      // Surface the Host-provided failure detail under the hint so a failing
      // search can be diagnosed from the palette itself.
      const errorDetail = status === 'error' && errorCode !== 'search-unavailable' ? lastErrorRef.current : null

      return h('div', {
        className: 'scs-backdrop',
        onMouseDown: (event) => {
          if (event.target === event.currentTarget) paletteStore.set({ open: false })
        },
      },
        h('div', { className: 'scs-palette', 'data-scs-exclude': '', role: 'dialog', 'aria-label': translate('palette.open') },
          h('div', { className: 'scs-palette-head' },
            h('input', {
              ref: inputRef,
              className: 'scs-input',
              type: 'text',
              value: query,
              placeholder: translate('palette.placeholder'),
              spellCheck: false,
              onChange: (event) => setQuery(event.target.value),
              onKeyDown,
            }),
            h('label', { className: 'scs-toggle' },
              h('input', {
                type: 'checkbox',
                checked: includeTools,
                onChange: (event) => setIncludeTools(event.target.checked),
              }),
              translate('palette.includeTools'),
            ),
          ),
          h('div', { className: 'scs-results' },
            bodyStatus,
            errorDetail !== null ? h('div', { className: 'scs-error-detail' }, errorDetail) : null,
            rows.map((row, index) => h(PaletteRow, {
              key: `${row.sessionId}:${index}`,
              row,
              query,
              selected: index === selected,
              onHover: () => setSelected(index),
              onOpen: () => openResult(row.sessionId),
            })),
            status === 'ready' && cursor !== null
              ? h('button', {
                className: 'scs-more',
                onClick: () => runSearch(query, cursor, includeTools, diskCache),
              }, translate('palette.more'))
              : null,          ),
          h('div', { className: 'scs-palette-foot' },
            h('label', { className: 'scs-foot-toggle' },
              h('input', {
                type: 'checkbox',
                checked: diskCache,
                onChange: (event) => {
                  setDiskCache(event.target.checked)
                  writeDiskCachePreference(event.target.checked)
                },
              }),
              h('span', { className: 'scs-foot-toggle-label' }, translate('palette.diskCache')),
            ),
            h('span', { className: 'scs-foot-hint' }, translate('palette.diskCacheHintShort')),
            h('span', { className: 'scs-foot-keys' }, translate('palette.hint')),
          ),
        ),
      )
    }

    function hintOf(text, isError) {
      return h('div', { className: 'scs-hint' + (isError ? ' scs-hint-error' : '') }, text)
    }

    function PaletteRow({ row, query, selected, onHover, onOpen }) {
      const ref = React.useRef(null)
      React.useEffect(() => {
        if (selected && ref.current) ref.current.scrollIntoView({ block: 'nearest' })
      }, [selected])
      return h('div', {
        ref,
        className: 'scs-row' + (selected ? ' scs-row-selected' : ''),
        role: 'option',
        'aria-selected': selected,
        onMouseEnter: onHover,
        onClick: onOpen,
      },
        h('div', { className: 'scs-row-snippet' }, snippetParts(row.snippet, query)),
        h('div', { className: 'scs-row-meta' },
          h('span', { className: 'scs-tag' }, tagLabel(row.type)),
          h('span', { className: 'scs-row-title' }, row.title),
          row.workspace ? h('span', { className: 'scs-row-ws' }, row.workspace) : null,
          h('span', { className: 'scs-row-time' }, timeText(row.time)),
        ),
      )
    }

    /* ------------------------------------------------------------------ *
     * In-conversation find bar (conversation.session.header.utilities).
     * ------------------------------------------------------------------ */

    const HIGHLIGHT_NAME = 'scs-find'
    const ACTIVE_HIGHLIGHT_NAME = 'scs-find-active'

    function highlightApiAvailable() {
      return typeof CSS !== 'undefined' && CSS.highlights != null && typeof Highlight !== 'undefined'
    }

    function clearHighlights() {
      if (!highlightApiAvailable()) return
      CSS.highlights.delete(HIGHLIGHT_NAME)
      CSS.highlights.delete(ACTIVE_HIGHLIGHT_NAME)
    }

    function applyHighlights(ranges, activeIndex) {
      if (!highlightApiAvailable()) return
      clearHighlights()
      if (ranges.length > 0) {
        // Very large match sets stay under the engine's argument limit.
        CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges.slice(0, 2000)))
      }
      if (activeIndex >= 0 && ranges[activeIndex]) {
        CSS.highlights.set(ACTIVE_HIGHLIGHT_NAME, new Highlight(ranges[activeIndex]))
      }
    }

    /**
     * Collect text-node ranges of every case-insensitive match inside the
     * conversation's rendered rows, in document order.
     * @param {string} query - raw query text.
     * @returns {Range[]} flattened match ranges.
     */
    function scanConversation(query) {
      const needle = query.trim().toLowerCase()
      if (needle === '') return []
      const ranges = []
      const rows = document.querySelectorAll('[data-chat-anchor-key]')
      for (const row of rows) {
        if (row.closest('[hidden]')) continue
        if (row.getClientRects().length === 0) continue
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            const value = node.nodeValue
            if (!value || value.trim() === '') return NodeFilter.FILTER_REJECT
            const parent = node.parentElement
            if (parent && parent.closest('[data-scs-exclude]')) return NodeFilter.FILTER_REJECT
            return NodeFilter.FILTER_ACCEPT
          },
        })
        let textNode = walker.nextNode()
        while (textNode !== null) {
          const value = textNode.nodeValue
          const lower = value.toLowerCase()
          let index = lower.indexOf(needle)
          while (index !== -1) {
            const range = document.createRange()
            range.setStart(textNode, index)
            range.setEnd(textNode, index + needle.length)
            ranges.push(range)
            index = lower.indexOf(needle, index + needle.length)
          }
          textNode = walker.nextNode()
        }
      }
      return ranges
    }

    /**
     * Index of the first match whose row is inside the current viewport, so a
     * search can report and start navigating from what the reader sees.
     * @param {Range[]} found - matches in document order.
     * @returns {number} visible match index, or -1 when none is on screen.
     */
    function firstVisibleMatch(found) {
      const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 0
      for (let index = 0; index < found.length; index += 1) {
        try {
          const element = found[index].startContainer.parentElement
          const rect = element?.getBoundingClientRect?.()
          if (!rect || rect.height === 0) continue
          if (rect.top >= 0 && rect.bottom <= viewportHeight) return index
        } catch {}
      }
      return -1
    }

    function FindBar(props) {
      const { open, focusRequest, prefill } = useStoreValue(findStore)
      const sessionId = typeof props?.sessionId === 'string' ? props.sessionId : null
      const [query, setQuery] = React.useState('')
      const [ranges, setRanges] = React.useState([])
      const [active, setActive] = React.useState(-1)
      // Total matches in the complete session log (rendered and not yet loaded).
      const [fullTotal, setFullTotal] = React.useState(null)
      // A prefilled selection waits for Enter: the first render must not scan
      // and jump the reader away from the text they just selected.
      const [awaitingEnter, setAwaitingEnter] = React.useState(false)
      // Edge feedback: pressing Next at the last match (or Previous at the
      // first) stops there and reports the edge before wrapping.
      const [boundaryHint, setBoundaryHint] = React.useState(null)
      // Incremented by the Search button to force a fresh scan.
      const [scanNonce, setScanNonce] = React.useState(0)
      const inputRef = React.useRef(null)
      const activeRef = React.useRef(-1)
      const prefillNonceRef = React.useRef(0)
      const boundaryTimerRef = React.useRef(0)
      const lastBoundaryRef = React.useRef({ edge: null, at: 0 })

      // Focus on open and again on every repeated Ctrl+F.
      React.useEffect(() => {
        if (!open) return undefined
        const timer = window.setTimeout(() => {
          const input = inputRef.current
          if (input) {
            input.focus()
            if (prefill === null || prefill === undefined) input.select()
            else input.setSelectionRange(prefill.text.length, prefill.text.length)
          }
        }, 0)
        return () => window.clearTimeout(timer)
      }, [open, focusRequest, prefill])

      // A fresh page selection fills the box and arms the Enter gate.
      React.useEffect(() => {
        if (!open || prefill === null || prefill === undefined) return
        if (prefillNonceRef.current === prefill.nonce) return
        prefillNonceRef.current = prefill.nonce
        setQuery(prefill.text)
        setAwaitingEnter(true)
        clearHighlights()
        activeRef.current = -1
        setRanges([])
        setActive(-1)
      }, [open, prefill])

      React.useEffect(() => () => {
        clearHighlights()
        window.clearTimeout(boundaryTimerRef.current)
      }, [])

      React.useEffect(() => {
        // A new scan invalidates any edge feedback from the previous query.
        lastBoundaryRef.current = { edge: null, at: 0 }
        setBoundaryHint(null)
        if (!open || query.trim() === '' || awaitingEnter) {
          clearHighlights()
          activeRef.current = -1
          setRanges([])
          setActive(-1)
          setFullTotal(null)
          return undefined
        }
        const signatureOf = () => {
          const rows = document.querySelectorAll('[data-chat-anchor-key]')
          if (rows.length === 0) return '0'
          return `${rows.length}|${String(rows[0].getAttribute('data-chat-anchor-key'))}|${String(rows[rows.length - 1].getAttribute('data-chat-anchor-key'))}`
        }
        let lastSignature = null
        let pendingTimer = 0
        const runScan = (isFresh) => {
          const found = scanConversation(query)
          setRanges(found)
          if (found.length === 0) {
            activeRef.current = -1
            setActive(-1)
            applyHighlights(found, -1)
            return
          }
          if (isFresh) {
            // A fresh scan keeps the current view: highlight everything, make
            // the first on-screen match active, and never scroll the reader
            // away from where they are looking. When nothing is on screen the
            // bar reports 0/n and the first Next press lands on match one.
            const visible = firstVisibleMatch(found)
            activeRef.current = visible
            setActive(visible)
            applyHighlights(found, visible)
            return
          }
          // A background rescan (rows scrolled in or out, or a session swap)
          // keeps the reader's place instead of jumping back to the first hit.
          const previous = activeRef.current
          const next = previous >= 0 && previous < found.length ? previous : found.length - 1
          activeRef.current = next
          setActive(next)
          applyHighlights(found, next)
        }
        const scheduleScan = (isFresh, delay) => {
          window.clearTimeout(pendingTimer)
          pendingTimer = window.setTimeout(() => {
            lastSignature = signatureOf()
            runScan(isFresh)
          }, delay)
        }
        // The complete session log, independent of which turns the page has
        // rendered: the counter tells the reader how many matches exist even
        // when some of them are in history that has not been loaded yet.
        const historyAbort = new AbortController()
        if (sessionId !== null) {
          setFullTotal(null)
          postJson(SEARCH_ROUTE, { query, messagesOnly: false, limit: 30, sessionId }, historyAbort.signal)
            .then((page) => {
              if (historyAbort.signal.aborted) return
              // Only the single-session answer carries a complete-log total; a
              // Host version without that branch must not be mistaken for one.
              if (page?.mode !== 'session') {
                setFullTotal(null)
                return
              }
              setFullTotal(typeof page.total === 'number' ? page.total : null)
            })
            .catch(() => {
              if (!historyAbort.signal.aborted) setFullTotal(null)
            })
        }
        scheduleScan(true, 200)
        // The conversation virtualizes its rows: keep the match set in step
        // with the rendered row window while the bar stays open.
        const interval = window.setInterval(() => {
          const current = signatureOf()
          if (current !== lastSignature) scheduleScan(false, 150)
        }, 500)
        return () => {
          historyAbort.abort()
          window.clearTimeout(pendingTimer)
          window.clearInterval(interval)
        }
      }, [open, query, awaitingEnter, sessionId, scanNonce])

      const scrollToRange = (range) => {
        try {
          const element = range.startContainer.parentElement?.closest('[data-chat-anchor-key]')
          const target = element || range.startContainer.parentElement
          target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        } catch {}
      }

      /** Apply one match index as the active, scrolled-to hit. */
      const jumpTo = (index) => {
        activeRef.current = index
        setActive(index)
        applyHighlights(ranges, index)
        scrollToRange(ranges[index])
      }

      /**
       * Move the active match. Reaching an edge stops there and reports it;
       * repeating the same direction within 1.5s wraps around. Buttons and
       * keyboard share this rule so both give the same edge feedback.
       * @param {number} nextIndex - candidate index, possibly out of range.
       */
      const goto = (nextIndex) => {
        if (ranges.length === 0) return
        const edge = nextIndex < 0 ? 'start' : nextIndex >= ranges.length ? 'end' : null
        if (edge !== null) {
          const now = Date.now()
          const last = lastBoundaryRef.current
          if (last.edge === edge && now - last.at < 1500) {
            lastBoundaryRef.current = { edge: null, at: 0 }
            setBoundaryHint(null)
            window.clearTimeout(boundaryTimerRef.current)
            jumpTo(edge === 'end' ? 0 : ranges.length - 1)
            return
          }
          lastBoundaryRef.current = { edge, at: now }
          setBoundaryHint(edge)
          window.clearTimeout(boundaryTimerRef.current)
          boundaryTimerRef.current = window.setTimeout(() => setBoundaryHint(null), 1500)
          return
        }
        lastBoundaryRef.current = { edge: null, at: 0 }
        setBoundaryHint(null)
        window.clearTimeout(boundaryTimerRef.current)
        jumpTo((nextIndex + ranges.length) % ranges.length)
      }

      const onInputKeyDown = (event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          // The prefilled selection has not scanned yet: Enter starts it.
          if (awaitingEnter) {
            setAwaitingEnter(false)
            return
          }
          goto(active + (event.shiftKey ? -1 : 1))
        } else if (event.key === 'ArrowDown') {
          event.preventDefault()
          if (awaitingEnter) {
            setAwaitingEnter(false)
            return
          }
          goto(active + 1)
        } else if (event.key === 'ArrowUp') {
          event.preventDefault()
          if (awaitingEnter) {
            setAwaitingEnter(false)
            return
          }
          goto(active - 1)
        }
      }

      const close = () => findStore.set({ open: false, focusRequest: 0, prefill: null })

      /**
       * Counter text: rendered position when there are highlights, plus the
       * complete-log total when history holds more matches than are loaded.
       * @returns {string} display text.
       */
      const countText = () => {
        if (boundaryHint === 'end') return translate('find.atEnd')
        if (boundaryHint === 'start') return translate('find.atStart')
        // A prefilled selection has not been searched yet: keep the counter
        // blank instead of reporting a false "no matches".
        if (awaitingEnter) return ''
        if (query.trim() === '') return ''
        const rendered = ranges.length
        if (rendered === 0) {
          if (fullTotal !== null && fullTotal > 0) return translate('find.historyOnly', { count: fullTotal })
          return translate('find.noMatches')
        }
        const base = active >= 0 ? `${active + 1}/${rendered}` : `0/${rendered}`
        if (fullTotal !== null && fullTotal > rendered) {
          return `${base} · ${translate('find.historyMore', { count: fullTotal })}`
        }
        return base
      }

      const iconProps = { viewBox: '0 0 24 24', width: 13, height: 13, 'aria-hidden': true }
      const magnifier = h('svg', { viewBox: '0 0 24 24', width: 14, height: 14, 'aria-hidden': true },
        h('circle', { cx: '11', cy: '11', r: '7', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }),
        h('path', { d: 'm20 20-3.8-3.8', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round' }),
      )

      // A visible entry point stays in the header utilities row; the bar
      // itself floats over the conversation through a body portal.
      const bar = !open ? null : ReactDOM.createPortal(
        h('div', { className: 'scs-find', 'data-scs-exclude': '', role: 'search' },
          h('input', {
            ref: inputRef,
            className: 'scs-find-input',
            type: 'text',
            value: query,
            placeholder: translate('find.placeholder'),
            spellCheck: false,
            onChange: (event) => {
              setAwaitingEnter(false)
              setQuery(event.target.value)
            },
            onKeyDown: onInputKeyDown,
          }),
          h('span', { className: 'scs-find-count' }, countText()),
          h('button', {
            type: 'button', className: 'scs-find-btn scs-find-start', title: translate('find.start'),
            onClick: () => {
              setAwaitingEnter(false)
              setScanNonce((nonce) => nonce + 1)
            },
            disabled: query.trim() === '',
          }, h('svg', { viewBox: '0 0 24 24', width: 13, height: 13, 'aria-hidden': true },
            h('circle', { cx: '11', cy: '11', r: '6', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }),
            h('path', { d: 'm20 20-3.5-3.5', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round' }),
          )),
          h('button', {
            type: 'button', className: 'scs-find-btn', title: translate('find.open'),
            onClick: () => goto(active - 1), disabled: ranges.length === 0,
          }, h('svg', iconProps, h('path', { d: 'm18 15-6-6-6 6', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }))),
          h('button', {
            type: 'button', className: 'scs-find-btn', title: translate('find.open'),
            onClick: () => goto(active + 1), disabled: ranges.length === 0,
          }, h('svg', iconProps, h('path', { d: 'm6 9 6 6 6-6', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }))),
          h('button', {
            type: 'button', className: 'scs-find-btn scs-find-close', title: 'Esc',
            onClick: close,
          }, h('svg', iconProps, h('path', { d: 'M18 6 6 18M6 6l12 12', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round' }))),
        ),
        document.body,
      )

      return [
        h('button', {
          type: 'button',
          className: 'scs-utilities-btn' + (open ? ' scs-utilities-btn-active' : ''),
          title: translate('find.open') + ' (Ctrl+F)',
          'aria-pressed': open,
          onClick: () => findStore.set({ open: !open, focusRequest: (findStore.get().focusRequest || 0) + 1, prefill: null }),
        }, magnifier),
        bar,
      ]
    }

    /* ------------------------------------------------------------------ *
     * Sidebar foot button (sidebar.footer.action entry).
     * ------------------------------------------------------------------ */

    function SidebarButton(props) {
      // The owner passes the sidebar width. Wide shows a full-width search
      // pill (discoverable, reads as an input); the collapsed rail keeps a
      // single icon button so the foot area never overflows.
      const wide = props?.wide === true
      const label = translate('entry.label')
      const openPalette = () => paletteStore.set({ open: true })
      const magnifier = h('svg', {
        viewBox: '0 0 24 24', width: 14, height: 14, 'aria-hidden': true, className: 'scs-entry-icon',
      },
        h('circle', { cx: '11', cy: '11', r: '7', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }),
        h('path', { d: 'm20 20-3.8-3.8', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round' }),
      )

      if (!wide) {
        return h('button', {
          type: 'button',
          className: 'scs-rail-btn',
          title: `${label} (Ctrl+Shift+F)`,
          'aria-label': label,
          onClick: openPalette,
        }, magnifier)
      }

      return h('div', { className: 'scs-entry-slot', 'data-scs-exclude': '' },
        h('button', {
          type: 'button',
          className: 'scs-entry',
          title: `${label} (Ctrl+Shift+F)`,
          'aria-label': label,
          onClick: openPalette,
        },
          magnifier,
          h('span', { className: 'scs-entry-label' }, label),
          h('kbd', { className: 'scs-entry-kbd' }, translate('entry.keys')),
        ),
      )
    }

    /* ------------------------------------------------------------------ *
     * Styles.
     * ------------------------------------------------------------------ */

    const CSS_TEXT = `
.scs-backdrop{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.35);display:flex;align-items:flex-start;justify-content:center;padding-top:11vh}
.scs-palette{width:min(680px,92vw);max-height:68vh;display:flex;flex-direction:column;overflow:hidden;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,.3);color:var(--dsw-alias-label-primary)}
.scs-palette-head{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.scs-input{flex:1;min-width:0;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;font-size:14px;color:var(--dsw-alias-label-primary);outline:none}
.scs-input:focus{border-color:var(--dsw-alias-brand-primary)}
.scs-toggle{display:flex;align-items:center;gap:6px;flex:none;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;user-select:none}
.scs-toggle input{accent-color:var(--dsw-alias-brand-primary);cursor:pointer}
.scs-results{flex:1;overflow:auto;padding:6px}
.scs-row{display:flex;flex-direction:column;gap:4px;padding:8px 10px;border-radius:8px;cursor:pointer}
.scs-row-selected{background:var(--dsw-alias-bg-layer-2)}
.scs-row-snippet{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary);word-break:break-word;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.scs-row-meta{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary);min-width:0}
.scs-tag{flex:none;font-size:11px;line-height:16px;padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.scs-row-title{color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.scs-row-ws{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.scs-row-ws::before{content:"·";margin-right:8px}
.scs-row-time{margin-left:auto;flex:none}
.scs-mark{background:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-bg-base);border-radius:2px;padding:0 1px}
.scs-hint{padding:26px 16px;text-align:center;font-size:13px;color:var(--dsw-alias-label-secondary)}
.scs-hint-error{color:var(--dsw-alias-state-error-primary)}
.scs-error-detail{margin:0 6px 8px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);font-size:11px;line-height:1.5;color:var(--dsw-alias-state-error-primary);word-break:break-all}
.scs-more{display:block;margin:6px auto 10px;padding:6px 16px;font-size:12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer}
.scs-more:hover{background:var(--dsw-alias-bg-layer-2)}
.scs-palette-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 12px;border-top:1px solid var(--dsw-alias-border-l1);font-size:11px;color:var(--dsw-alias-label-secondary)}
.scs-foot-toggle{display:flex;align-items:center;gap:6px;flex:none;cursor:pointer;user-select:none;color:var(--dsw-alias-label-primary)}
.scs-foot-toggle input{accent-color:var(--dsw-alias-brand-primary);cursor:pointer}
.scs-foot-toggle-label{font-size:11px}
.scs-foot-hint{flex:1;min-width:120px;font-size:10px;color:var(--dsw-alias-label-secondary);opacity:.85}
.scs-foot-keys{flex:none;font-size:10px;color:var(--dsw-alias-label-secondary);opacity:.7}
.scs-sidebar-btn{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 8px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer}
.scs-sidebar-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.scs-entry-slot{width:100%;display:block}
.scs-entry{display:flex;align-items:center;gap:8px;width:100%;height:32px;padding:0 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;cursor:pointer;text-align:left}
.scs-entry:hover{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}
.scs-entry:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.scs-entry-icon{flex:none;color:var(--dsw-alias-brand-primary)}
.scs-entry-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.scs-entry-kbd{flex:none;font-family:inherit;font-size:9px;line-height:14px;padding:0 5px;border-radius:4px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.scs-rail-btn{width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-brand-primary);cursor:pointer}
.scs-rail-btn:hover{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}
.scs-utilities-btn{width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.scs-utilities-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.scs-utilities-btn-active{color:var(--dsw-alias-brand-primary)}
.scs-find{position:fixed;top:60px;right:16px;z-index:10000;display:flex;align-items:center;gap:6px;padding:6px 8px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.25);color:var(--dsw-alias-label-primary)}
.scs-find-input{width:200px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 8px;font-size:13px;color:var(--dsw-alias-label-primary);outline:none}
.scs-find-input:focus{border-color:var(--dsw-alias-brand-primary)}
.scs-find-count{min-width:40px;max-width:220px;overflow:hidden;text-overflow:ellipsis;text-align:center;font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.scs-find-btn{width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);cursor:pointer}
.scs-find-btn:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
.scs-find-btn:disabled{opacity:.45;cursor:default}
.scs-find-close{border-color:transparent;background:transparent}
::highlight(scs-find){background:rgba(250, 204, 21, 0.55)}
::highlight(scs-find-active){background:rgba(37, 99, 235, 0.85);color:#ffffff}
`

    /* ------------------------------------------------------------------ *
     * Plugin entry.
     * ------------------------------------------------------------------ */

    return {
      inject: ['slots', 'locale', 'sessions', 'uiWorkspace'],
      apply(ctx) {
        sharedCtx = ctx

        // Locale dictionaries for this plugin's UI text.
        ctx.effect(() => {
          const disposers = []
          try {
            disposers.push(ctx.locale.register(NS, 'en', en))
            disposers.push(ctx.locale.register(NS, 'zh', zh))
          } catch (error) {
            console.error('[session-content-search] locale registration failed:', error)
          }
          try {
            const snapshot = ctx.locale.getSnapshot()
            tagLocale = String(snapshot?.active || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en'
          } catch {}
          translate = ctx.locale.bind(NS)
          return () => {
            for (const dispose of disposers) {
              try {
                dispose()
              } catch {}
            }
          }
        }, 'session-content-search: locale')

        // Shortcuts: Ctrl+Shift+F opens the palette, Ctrl+F the find bar,
        // Escape closes whichever is open. Capture phase, with editable
        // targets left to their own editors.
        ctx.effect(() => {
          const onKeyDown = (event) => {
            if (event.defaultPrevented) return
            const mod = event.ctrlKey || event.metaKey
            if (event.key === 'Escape') {
              if (paletteStore.get().open) {
                event.preventDefault()
                event.stopPropagation()
                paletteStore.set({ open: false })
              } else if (findStore.get().open) {
                const target = event.target
                const insideFind = target instanceof Element && target.closest('[data-scs-exclude]') !== null
                if (insideFind) {
                  event.preventDefault()
                  event.stopPropagation()
                }
                findStore.set({ open: false, focusRequest: 0, prefill: null })
              }
              return
            }
            if (!mod || event.altKey) return
            if (event.code !== 'KeyF') return
            const target = event.target
            const editable = target instanceof Element
              && target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]') !== null
            if (editable) return
            event.preventDefault()
            event.stopPropagation()
            if (event.shiftKey) {
              findStore.set({ open: false, focusRequest: 0, prefill: null })
              paletteStore.set({ open: true })
            } else {
              // The find bar needs a conversation: without an open session
              // there is nothing rendered to search.
              if (currentSessionId() === null) return
              const current = findStore.get()
              paletteStore.set({ open: false })
              // A page selection prefills the box and waits for Enter, so a
              // quick read of the selected phrase never triggers a scan.
              const picked = selectedText()
              findStore.set({
                open: true,
                focusRequest: (current.focusRequest || 0) + 1,
                prefill: picked === ''
                  ? null
                  : { text: picked, nonce: ((current.prefill?.nonce || 0) + 1) },
              })
            }
          }
          document.addEventListener('keydown', onKeyDown, true)
          return () => document.removeEventListener('keydown', onKeyDown, true)
        }, 'session-content-search: shortcuts')

        // Shared stylesheet; removed when the plugin unloads.
        ctx.effect(() => {
          const tag = document.createElement('style')
          tag.dataset.plugin = PLUGIN_ID
          tag.textContent = CSS_TEXT
          document.head.append(tag)
          return () => tag.remove()
        }, 'session-content-search: styles')

        // Cross-workspace search palette, floating above the whole frame.
        ctx.slots.inject('shell.overlay', () => ctx.slots.register(
          { name: 'shell.overlay', id: 'session-content-search.palette', order: 60, label: 'Session content search' },
          PaletteOverlay,
        ))

        // Sidebar foot entry point.
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
          { name: 'sidebar.footer.action', id: 'session-content-search.button', order: 50, label: () => translate('palette.open') },
          SidebarButton,
        ))

        // In-conversation find bar; the owner mounts it per open session.
        ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register(
          { name: 'conversation.session.header.utilities', id: 'session-content-search.find', order: 80, label: () => translate('find.open') },
          FindBar,
        ))
      },
    }
  },
})
