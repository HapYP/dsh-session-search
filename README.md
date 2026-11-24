# @hapyp/dsh-session-search

[![npm version](https://img.shields.io/npm/v/@hapyp/dsh-session-search.svg)](https://www.npmjs.com/package/@hapyp/dsh-session-search)
[![license](https://img.shields.io/npm/l/@hapyp/dsh-session-search.svg)](LICENSE)
[![test](https://github.com/HapYP/dsh-session-search/actions/workflows/test.yml/badge.svg)](https://github.com/HapYP/dsh-session-search/actions/workflows/test.yml)

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

### Or install from the plugin market index

This repository serves a DSH market index (format 1) so the plugin can be
browsed in **Plugins → Discover**:

```
https://raw.githubusercontent.com/HapYP/dsh-session-search/main/index.json
```

Add that URL as a plugin index in DSH, then pick *Session content search* from
the Discover tab.

## Development

```bash
npm test     # host integration tests + client smoke test + market index check
npm run check   # syntax check plus the test suite
```

No runtime or dev dependencies: the tests run on plain Node (24+) with the
built-in `assert`/`fetch` APIs.

## Releasing

Releases are **published by GitHub Actions**, not from a workstation: a tag push
is the trigger. The local step only decides the version, keeps the market index
in sync, commits, tags, and pushes.

```bash
# 1. land your change on main (the test workflow verifies it)
git add -A && git commit -m "feat: ..." && git push

# 2. cut the release — bumps the version, updates index.json, tags, pushes
npm run release patch -- --push     # or: minor / major
```

What the `publish` workflow then does, in order:

1. run the full test suite (same commands as `npm test`)
2. assert the tag (`v1.2.3`) matches `package.json` `version`
3. verify the npm token (`npm whoami`) and check whether the version is already
   published — an existing version is skipped, so re-runs and manual publishes
   never fail the pipeline
4. `npm publish --access public --provenance` (falls back to a plain publish if
   the signed path is unavailable)
5. create the GitHub release, using `.github/release-notes/<tag>.md` when present
   (its first `# heading` becomes the release title) or generated notes otherwise

### Repository secrets

| Secret | Purpose |
|---|---|
| `NPM_TOKEN` | npm **Automation** token (Classic) with publish rights. `Publish`-type tokens fail in CI with `EOTP` because they need a one-time password. |

### Release notes

Add `.github/release-notes/v<version>.md` before releasing. Start it with a
single `# title` line (used as the release title, then stripped from the body),
keep the rest bilingual in this repository's style. See
[CHANGELOG.md](CHANGELOG.md) for the running history.

### Market index

`index.json` is the DSH market index (format 1). `npm run release` prepends the
new version automatically; `node tests/verify-index.mjs` (part of `npm test`)
fails when it drifts from `package.json`.

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

### 或从插件市场索引安装

本仓库同时提供 DSH 市场索引（格式 1），可在**插件 → 发现**中浏览安装：

```
https://raw.githubusercontent.com/HapYP/dsh-session-search/main/index.json
```

在 DSH 中添加该索引地址，然后在「发现」页选择「会话内容搜索」即可。

### 开发

```bash
npm test        # Host 集成测试 + Client 冒烟 + 市场索引校验
npm run check   # 语法检查 + 全部测试
```

无任何运行时与开发依赖：测试直接在 Node 24+ 上运行（使用内置 `assert` / `fetch`）。

### 发布流程

发布**由 GitHub Actions 完成**，触发条件是推送 tag；本地只负责决定版本号、
同步市场索引、提交、打 tag、推送。

```bash
# 1. 改动先落到 main（test 工作流会自动验证）
git add -A && git commit -m "feat: ..." && git push

# 2. 发版：升版本、同步 index.json、打 tag、推送
npm run release patch -- --push     # 或 minor / major
```

随后 `publish` 工作流依次执行：

1. 跑完整测试（与 `npm test` 相同）
2. 校验 tag（`v1.2.3`）与 `package.json` 的 `version` 一致
3. 校验 npm token（`npm whoami`）并检查该版本是否已发布——已发布则跳过，
   因此重跑与手动发布都不会让流水线变红
4. `npm publish --access public --provenance`（签名路径不可用时自动降级为普通发布）
5. 创建 GitHub Release：若存在 `.github/release-notes/<tag>.md` 则用其正文
   （首行 `# 标题` 作为 Release 标题），否则使用自动生成的变更说明

**仓库 Secret**

| Secret | 用途 |
|---|---|
| `NPM_TOKEN` | npm **Automation** 类型（Classic）token，具备发布权限。`Publish` 类型在 CI 里会因需要一次性密码而报 `EOTP`。 |

**发版文案**：发布前新增 `.github/release-notes/v<版本>.md`，首行写一个 `# 标题`
（用作 Release 标题，正文中会被去掉），其余按本仓库的中英双语风格书写。
历史记录见 [CHANGELOG.md](CHANGELOG.md)。

**市场索引**：`index.json` 是 DSH 市场索引（格式 1），`npm run release` 会自动前置
新版本；`node tests/verify-index.mjs`（包含在 `npm test` 中）会在它与
`package.json` 不一致时失败。

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
