# Changelog

All notable changes to `@hapyp/dsh-session-search` are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.1] - 2026-11-24

Packaging and delivery only — **no runtime behaviour changed**; the plugin code
is byte-identical to 1.0.0, so upgrading is optional.

### Added

- **Plugin market index** (`index.json`, DSH index format 1) so the plugin is
  browsable and installable from *Plugins → Discover*.
- **GitHub Actions**: a test workflow (syntax, 21 host integration cases, client
  factory smoke test, market-index validation) and a tag-driven publish
  workflow.
- **Release tooling** (`scripts/release.mjs`, `npm run release <patch|minor|major>`)
  that keeps `package.json` and `index.json` in sync, commits, tags, and pushes.
- `test` / `check` / `release` npm scripts; README badges and development notes.

### Changed

- npm releases are now published by GitHub Actions **with provenance**
  (SLSA v1 attestation), so npm shows a verified source for every release.
- Repository metadata (`repository`, `homepage`, `bugs`) points at
  <https://github.com/HapYP/dsh-session-search>.

## [1.0.0] - 2026-11-24

First public release.

### Added

- **Cross-workspace content palette** (`Ctrl+Shift+F`, or the *Search all
  sessions* entry at the sidebar foot): searches user messages, assistant
  replies, tool calls (name + arguments), tool results and todo entries across
  every session and workspace, with highlighted excerpts, event type, session
  title, workspace and time. `Enter` opens the session, `↑`/`↓` select, `Esc`
  closes, and *Scan older sessions* pages further back.
- **In-conversation find bar** (`Ctrl+F`): highlights every match in the
  rendered conversation with match counting, previous/next navigation and
  scroll-to-match. Selecting text first prefills the query and waits for
  `Enter` or the *Start search* button.
- **Full-history match counting**: each find also counts matches in the complete
  session log, reporting how many still live in history that is not rendered.
- **Edge feedback**: stepping past the first or last match stops and reports the
  edge (buttons and keyboard behave the same); repeating the same direction
  within 1.5 s wraps around.
- **Literal substring matching**: case-insensitive, whitespace-flexible — `AI`
  finds `BRAID`. Not token- or phrase-based.
- **Opt-in disk cache** (off by default): nothing is written to disk unless the
  person ticks *Disk cache* in the palette; enabling it keeps a 48 MB plain-text
  copy in the system temp folder so the first search after a restart is
  near-instant.
- English and Chinese UI, following the DSH light/dark theme.

### Notes

- Reads session history through the read-only `listSessions` / `filterEvents`
  faces of `ctx.sessionQuery`; it never opens, builds or modifies a SQLite
  index, and never changes session storage.
- Diagnostics are off unless the Host runs with
  `SESSION_CONTENT_SEARCH_DEBUG=1`.

---

## 中文

## [未发布]

## [1.0.1] - 2026-11-24

仅打包与交付方式的变化——**运行行为无任何改动**，插件代码与 1.0.0 逐字节一致，
升级可选。

### 新增

- **插件市场索引**（`index.json`，DSH 索引格式 1）：可在「插件 → 发现」中浏览并安装。
- **GitHub Actions**：测试工作流（语法、21 项 Host 集成用例、Client 工厂冒烟、
  市场索引校验）与 tag 驱动的发布工作流。
- **发布脚本**（`scripts/release.mjs`，`npm run release <patch|minor|major>`）：
  自动同步 `package.json` 与 `index.json`、提交、打 tag、推送。
- `test` / `check` / `release` 脚本；README 徽章与开发说明。

### 变更

- npm 发布改由 GitHub Actions 完成，并**带 provenance 签名**（SLSA v1），
  npm 包页可验证来源。
- 仓库元信息指向 <https://github.com/HapYP/dsh-session-search>。

## [1.0.0] - 2026-11-24

首个公开版本。

### 新增

- **跨工作区内容搜索面板**（`Ctrl+Shift+F`，或侧栏底部「搜索全部会话」入口）：
  跨所有会话与工作区搜索用户消息、助手回复、工具调用（名称 + 参数）、工具结果与
  任务清单，结果显示高亮摘录、事件类型、会话标题、所属工作区与时间；`Enter` 打开会话，
  `↑`/`↓` 选择，`Esc` 关闭，「继续扫描更早的会话」可向后翻页。
- **会话内查找栏**（`Ctrl+F`）：高亮当前已渲染对话中的全部匹配，带命中计数、
  上一个/下一个与滚动定位；先选中文字会自动填入并等待回车或点「开始搜索」。
- **完整历史命中计数**：每次查找同时统计完整会话日志中的命中数，提示还有多少条
  位于尚未渲染的历史中。
- **边界反馈**：走到第一个/最后一个匹配时停住并提示（按钮与键盘一致），
  1.5 秒内再次同向操作才回卷。
- **字面子串匹配**：大小写不敏感、空白灵活——`AI` 能命中 `BRAID`；非词元/短语匹配。
- **可选磁盘缓存**（默认关闭）：不勾选时完全不写磁盘；勾选后在系统临时目录保留
  不超过 48 MB 的会话文本明文副本，使重启后首次搜索接近即时。
- 中英文界面，跟随 DSH 明暗主题。

### 说明

- 仅通过 `ctx.sessionQuery` 的只读 `listSessions` / `filterEvents` 读取历史，
  不打开、不建、不修改 SQLite 索引，从不改动会话存储。
- 除非 Host 以 `SESSION_CONTENT_SEARCH_DEBUG=1` 启动，否则不写诊断日志。
