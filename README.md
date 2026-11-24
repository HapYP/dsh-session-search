# @hapyp/dsh-session-search

[中文](#中文) | English

Search **session content** across every DSH workspace, and find inside the
current conversation with `Ctrl+F`.

The built-in sidebar search matches session titles. This plugin adds content
search: user messages, assistant replies, tool calls (name + arguments), tool
results, and todo entries — from **all workspaces at once**.

## Features

- **Cross-workspace content palette** — `Ctrl+Shift+F`, or the enlarged
  *Search all sessions* entry at the sidebar foot. Results show a highlighted
  excerpt, the event type, the session title, its workspace, and the time.
  `Enter` opens the session, `↑`/`↓` select, `Esc` closes, and *Scan older
  sessions* pages back through history.
- **In-conversation find bar** — `Ctrl+F` opens a floating bar that highlights
  every match in the rendered conversation, with match counting, previous/next
  navigation, and scroll-to-match. Selecting text first prefills the query and
  waits for `Enter`. Every search also counts matches in the **complete session
  log**, including turns the page has not rendered yet.
- **Edge feedback** — stepping past the last or first match stops and reports
  the edge instead of silently wrapping.
- Dark and light themes are inherited from DSH; all copy is localised (en/zh).

## Install

In DSH: **Plugins → Add plugin**, then install:

```
@hapyp/dsh-session-search@1.0.0
```

Or from a terminal, into a profile:

```
dsh plugin add @hapyp/dsh-session-search
```

After installing, reload the DSH page (`Ctrl+R`).

## Requirements

- DSH `0.2.2-rc.5` or newer within the `0.2.x` line.
- The built-in `@deepseek-ai/dsh-session-query` service must be mounted. It ships
  with DSH's base composition; the plugin explains the situation in the palette
  when it is absent instead of failing silently.

## Privacy and disk usage

- By default **nothing is written to disk**. Search reads session logs and keeps
  an in-memory cache for the lifetime of the Host process.
- With *Disk cache* enabled in the palette (or `cache: true` in the request), the
  plugin writes a **plain-text copy of scanned session text** to
  `<system temp>/session-content-search-cache.v1.json`, capped at 48 MB. This
  makes the first search after each DSH start near-instant. Delete the file at
  any time to remove it; it is never authoritative — deleting it costs only
  speed.
- Diagnostics are off unless the Host process is started with
  `SESSION_CONTENT_SEARCH_DEBUG=1`.
- The plugin never modifies session storage. It calls the read-only
  `listSessions` / `filterEvents` faces of `ctx.sessionQuery`; it does not open
  or build a SQLite index.

## Known limitations

- Matching is a **literal, case-insensitive, whitespace-flexible substring
  scan** (`AI` finds `BRAID`), not token or phrase matching.
- Reasoning ("thinking") text is not indexed by DSH and cannot be searched.
- The find bar scrolls to matches that are already rendered; matches in
  unloaded history are counted but load when you scroll up.
- A search request visits at most ~40 sessions per page; use *Scan older
  sessions* for deeper history.
- The first search of a Host process reads session logs; expect a few seconds
  on large histories unless disk caching is enabled.

## License

MIT

---

## 中文

在**所有工作区**中搜索会话内容，并在当前会话内用 `Ctrl+F` 查找。

DSH 内置的侧栏搜索只匹配会话标题。本插件补上内容搜索：用户消息、助手回复、
工具调用（名称 + 参数）、工具结果、任务清单条目——**一次搜遍全部工作区**。

### 功能

- **跨工作区内容面板** — `Ctrl+Shift+F`，或侧栏底部的「搜索全部会话」入口。
  结果显示高亮摘录、事件类型、会话标题、所属工作区与时间。`Enter` 打开会话，
  `↑`/`↓` 选择，`Esc` 关闭；命中不足时点「继续扫描更早的会话」向后翻页。
- **会话内查找栏** — `Ctrl+F` 浮出查找栏，高亮当前已渲染对话中的全部匹配，
  带命中计数、上一个/下一个与滚动定位。先选中文字再按 `Ctrl+F` 会自动填入并
  等待回车。每次搜索还会统计**完整会话日志**中的命中数（含尚未渲染的回合）。
- **边界反馈** — 走到最后或第一个匹配时停住并提示，再次同向操作才回卷。
- 明暗主题自动继承 DSH；界面文案支持中英文。

### 安装

在 DSH 中：**插件 → 添加插件**，安装：

```
@hapyp/dsh-session-search@1.0.0
```

安装后按 `Ctrl+R` 刷新页面。

### 隐私与磁盘占用

- 默认**不向磁盘写入任何内容**，只在 Host 进程内存中缓存扫描结果。
- 在面板中勾选「磁盘缓存」后（或请求带 `cache: true`），插件会把**扫描过的
  会话文本明文副本**写入 `<系统临时目录>/session-content-search-cache.v1.json`，
  上限 48 MB，使每次 DSH 启动后的首次搜索接近即时。该文件可随时删除，删除只
  影响速度，不影响数据。
- 除非以 `SESSION_CONTENT_SEARCH_DEBUG=1` 启动 Host，否则不写诊断日志。
- 本插件**从不修改会话存储**，只调用 `ctx.sessionQuery` 的只读
  `listSessions` / `filterEvents`；不打开也不建 SQLite 索引。

### 已知限制

- 匹配为**字面、大小写不敏感、空白灵活的子串扫描**（`AI` 能命中 `BRAID`），
  不是词元/短语匹配。
- 思考过程（reasoning）文本 DSH 不索引，无法搜索。
- 查找栏只滚动到已渲染的匹配；未加载历史中的命中会被计数，向上滚动加载后即可定位。
- 单次搜索最多访问约 40 个会话，更早的历史用「继续扫描更早的会话」。

### 协议

MIT
