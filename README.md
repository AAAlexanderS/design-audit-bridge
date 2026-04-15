# Design Audit Bridge

**A Figma plugin that puts you in control when Claude edits your designs.**

When you ask Claude to make changes to your Figma file, every proposed edit appears in the plugin panel as a reviewable checklist — *before* anything is applied. You approve what looks good, reject what doesn't, and apply. Nothing touches your file without your sign-off.

> **中文说明见下方 →** [跳转到中文文档](#中文说明)

---

## What it looks like

```
┌─ Design Audit Bridge ──────────────────── ● Connected ─┐
│  Pending review                          +5 ops         │
│  Rename all icon layers to DS naming                    │
│  ─────────────────────────────────────────────────────  │
│  Review · 4 approved of 5                               │
│  ┌──────────────────────────────────────────────────┐  │
│  │ ✓ FRAME  Foundations › Icons                     │  │
│  │   "icon_arrow" → "ic/arrow/right-16"       Zoom  │  │
│  ├──────────────────────────────────────────────────┤  │
│  │ ✓ FRAME  Foundations › Icons                     │  │
│  │   "icon_close" → "ic/close-16"             Zoom  │  │
│  ├──────────────────────────────────────────────────┤  │
│  │   FRAME  Foundations › Icons         ⚠ risky    │  │
│  │   "Button / Primary" → "btn-primary"       Zoom  │  │
│  └──────────────────────────────────────────────────┘  │
│  ┌──────────────────────┐  ┌─────────────┐             │
│  │  Approve & Apply 4   │  │  Reject All │             │
│  └──────────────────────┘  └─────────────┘             │
│  Audit log: 2 sessions · 9 applied      [↩ Undo last]  │
└────────────────────────────────────────────────────────┘
```

---

## Why this exists

Most AI-Figma integrations let Claude run arbitrary JavaScript directly against your file. That works — but gives you no preview, no per-change approval, and no plugin-managed undo.

Design Audit Bridge is the **control surface** between Claude's intent and your file:

- Claude **proposes** a structured Plan document
- You **review** each operation in the plugin UI
- You **approve** what you want, reject what you don't
- The plugin **executes** only what you approved, then saves a reverse snapshot so you can undo the whole pass in one click

Claude can audit your Design System, rename layers, bind tokens to frames, export variables — but your hand stays on the wheel.

---

## Features

| Feature | What it does |
|---------|-------------|
| **Visual review checklist** | Every proposed change is a row — see before/after, breadcrumb, and risk level before applying |
| **Risk levels** | `safe` ops auto-checked; `risky` / `destructive` require explicit opt-in |
| **Zoom to node** | Click Zoom on any row to jump to that layer in Figma |
| **Session undo** | One-click undo for the entire last applied pass |
| **Token audit** | Scans every node on the page for hardcoded colors that should be tokens |
| **Override audit** | Finds component instances with styles that diverge from the master |
| **Variable export** | Exports all Figma variables as CSS variables, Style Dictionary, Tailwind config, or JSON |
| **Component snapshot & diff** | Snapshot component state to a file; later diff two snapshots to detect breaking changes |
| **Semantic token suggestion** | Given a selected layer, finds the closest semantic token to bind |
| **Batch operations** | Send multiple rename / set-variable / create-node operations as one Plan |

---

## Architecture

```
┌──────────────────┐   HTTP POST /plan   ┌──────────────────┐  WebSocket   ┌───────────────┐
│   Claude (MCP)   │ ──────────────────> │  bridge-server   │ ───────────> │  Figma Plugin │
│                  │                     │  Node.js         │              │  (code.ts)    │
└──────────────────┘                     │  localhost:7879  │              │               │
                                         └──────────────────┘              │  postMessage  │
                                                  ▲                        │      ▼        │
                                                  │ SSE events             │   ui.html     │
                                                  └────────────────────────┘  (checklist)  │
                                                                           └───────────────┘
                                                                                   │
                                                                                   ▼
                                                                            figma.* mutations
```

Three components, all running locally:

| Component | Role |
|-----------|------|
| `bridge-server.js` | Tiny Node.js HTTP + WebSocket server. Receives Plans from Claude, forwards to plugin, streams execution events back via SSE. Zero npm dependencies. |
| `mcp-server.js` | MCP server that gives Claude 12 Figma tools. Communicates with the bridge server over HTTP. |
| Figma Plugin (`src/`) | Renders the approval UI inside Figma. Executes approved operations via the Figma Plugin API. |

---

## Quick Setup (one command)

```bash
cd ~/Downloads/design-audit-bridge
./setup.sh
```

`setup.sh` will:
1. Install npm dependencies
2. Build the TypeScript plugin
3. Register the MCP server with Claude Code
4. Start the bridge server in the background

Then load the plugin in Figma:

```
Figma Desktop → Plugins → Development → Import plugin from manifest…
→ select manifest.json in this folder
→ Plugins → Development → Design Audit Bridge
```

The status dot turns green once the plugin connects to the bridge server.

---

## Manual Setup

### Prerequisites

- Node.js 18+
- Figma Desktop app (the browser version does not support development plugins)
- [Claude Code CLI](https://claude.ai/code)

### Step 1 — Install and build

```bash
npm install
npm run build
```

### Step 2 — Start the bridge server

```bash
node bridge-server.js
# Design Audit Bridge server listening on http://localhost:7879
```

### Step 3 — Register the MCP server with Claude Code

```bash
claude mcp add figma-control-bridge -- node /absolute/path/to/mcp-server.js
# Verify:
claude mcp list
```

### Step 4 — Load the plugin in Figma Desktop

1. Open any Figma file
2. `Plugins → Development → Import plugin from manifest…`
3. Select `manifest.json` in this directory
4. `Plugins → Development → Design Audit Bridge`

### Step 5 — Ask Claude

```
Audit this page for hardcoded colors — I'll review each fix before applying
```
```
Find all component instances with override drift and show me what changed
```
```
Export all color tokens as CSS variables to ~/Desktop/tokens.css
```

---

## MCP Tools Reference

| Tool | Description |
|------|-------------|
| `figma_get_selection` | Get the currently selected nodes in Figma |
| `figma_inspect_node` | Get full style data for a node (fills, strokes, bound variables, children) |
| `figma_propose_rename` | Propose a rename — user approves in plugin UI |
| `figma_propose_batch_operations` | Send multiple operations as one reviewable Plan |
| `figma_propose_set_variable` | Bind a Figma variable to a node property |
| `figma_audit_tokens` | Scan the page for hardcoded color violations |
| `figma_audit_overrides` | Find component instances with style override drift |
| `figma_list_components` | List all components and component sets on the current page |
| `figma_search_components` | Search components by name, variant, or type |
| `figma_export_tokens` | Export all variables in CSS / Style Dictionary / Tailwind / JSON format |
| `figma_component_snapshot` | Save component state to a JSON file for future diffing |
| `figma_diff_snapshots` | Compare two snapshots, classify breaking vs non-breaking changes |

---

## Plan Schema

POST plans directly to the bridge server (for testing or custom scripts):

```bash
curl -X POST http://localhost:7879/plan \
  -H "Content-Type: application/json" \
  -d '{
    "planId": "plan_001",
    "title": "Rename icon layers",
    "summary": "Apply DS naming conventions to icon layer group",
    "domain": "figma",
    "operations": [
      {
        "id": "op_1",
        "verb": "rename",
        "target": { "kind": "node", "id": "123:456", "type": "FRAME" },
        "context": { "page": "Icons", "breadcrumb": "Icons › Arrows" },
        "from": "icon_arrow",
        "to": "ic/arrow/right-16",
        "reason": "DS naming convention",
        "risk": "safe",
        "reversible": true,
        "cascades": []
      }
    ]
  }'
```

**Supported verbs:** `rename` · `set-variable` · `create-node`

**Risk levels:**
- `safe` — auto-checked in the review UI
- `risky` — unchecked by default, shown with warning color
- `destructive` — unchecked by default, shown in red

---

## SSE Event Stream

Monitor execution in real time from any terminal:

```bash
curl http://localhost:7879/events
```

```
data: {"type":"plan.received","planId":"plan_001"}
data: {"type":"plan.executing","planId":"plan_001","selectedOpIds":["op_1"]}
data: {"type":"op.complete","opId":"op_1","result":"ok"}
data: {"type":"plan.complete","planId":"plan_001","snapshotId":"snap_1713..."}
```

---

## Security

- Bridge server binds to `127.0.0.1` only — not reachable from other machines on your network
- Plugin manifest restricts network access to `ws://localhost:7879` — enforced by Figma
- File write operations (token export, snapshots) are restricted to your home directory
- No design data is sent to external servers — everything stays on your machine
- Operation history is stored in `figma.clientStorage` (local, per file, per user)

---

## File Structure

```
design-audit-bridge/
├── manifest.json          # Figma plugin manifest
├── package.json
├── tsconfig.json
├── setup.sh               # One-click setup script
├── bridge-server.js       # HTTP + WebSocket bridge (zero npm deps)
├── mcp-server.js          # MCP server exposing 12 tools to Claude
├── example-plan.json      # Example Plan for testing with curl
├── src/
│   ├── code.ts            # Plugin sandbox — all Figma API calls live here
│   ├── ui.html            # Plugin panel UI — approval checklist
│   └── schema.ts          # Shared Plan / Operation / Event types
└── dist/                  # Generated by npm run build (gitignored)
    ├── code.js
    └── ui.html
```

---

## Troubleshooting

**Plugin shows "Disconnected"**
→ Make sure the bridge server is running: `node bridge-server.js`
→ Check for port conflicts: `lsof -i :7879`

**MCP tools not showing in Claude**
→ Re-register: `claude mcp add figma-control-bridge -- node /path/to/mcp-server.js`
→ Verify registration: `claude mcp list`

**"Node not found" errors**
→ The node may have been moved or deleted. Use `figma_get_selection` to get a fresh ID.

**Build errors**
→ Confirm Node.js ≥ 18: `node --version`
→ Run `npm install` first

---

## License

MIT

---
---

# 中文说明

**Design Audit Bridge — 让 Claude 修改 Figma 时，你始终掌控每一步**

这是一个 Figma 插件。当你让 Claude 对设计文件执行操作时（改名、绑定 token、创建节点等），每一个改动都会先出现在插件面板的审查清单里，**你逐一确认后才会真正执行**。没有你的点击，什么都不会发生。

---

## 它解决什么问题

普通的 AI + Figma 集成会让 Claude 直接运行 JavaScript 操作你的文件——没有预览，没有逐步确认，没有插件级别的撤销。

Design Audit Bridge 是 Claude 意图和你的文件之间的**可视化把控层**：

- Claude **提出**一份结构化的操作计划（Plan）
- 你在插件 UI 里**逐条审查**每个操作
- **勾选**你同意的，取消你不同意的
- 点击「Approve & Apply」后，插件**只执行你批准的操作**，并保存快照供一键撤销

---

## 快速开始（一条命令）

```bash
cd ~/Downloads/design-audit-bridge
./setup.sh
```

脚本会自动完成：

1. 安装 npm 依赖
2. 编译 TypeScript 插件
3. 向 Claude Code 注册 MCP 服务
4. 在后台启动 bridge server

然后在 Figma Desktop 里加载插件：

```
Figma Desktop → Plugins → Development → Import plugin from manifest…
→ 选择本目录下的 manifest.json
→ Plugins → Development → Design Audit Bridge
```

插件状态指示灯变绿，即表示连接成功。

---

## 环境要求

| 依赖 | 版本要求 |
|------|---------|
| Node.js | 18+ |
| Figma Desktop | 最新版（浏览器版不支持开发插件） |
| Claude Code CLI | 最新版 |

---

## 手动安装步骤

### 第一步 — 安装依赖并编译

```bash
npm install
npm run build
```

### 第二步 — 启动 bridge server

```bash
node bridge-server.js
# Design Audit Bridge server listening on http://localhost:7879
```

### 第三步 — 注册 MCP 服务

```bash
claude mcp add figma-control-bridge -- node /绝对路径/mcp-server.js
# 验证：
claude mcp list
```

### 第四步 — 在 Figma Desktop 加载插件

1. 打开任意 Figma 文件
2. `Plugins → Development → Import plugin from manifest…`
3. 选择本目录的 `manifest.json`
4. `Plugins → Development → Design Audit Bridge`

### 第五步 — 向 Claude 提问

```
审计这个页面的 hardcoded 颜色，每个修复我都要在插件里确认后再应用
```
```
找出所有存在 override 漂移的组件实例，告诉我哪些属性被改动了
```
```
将所有 color token 导出为 CSS 变量，保存到 ~/Desktop/tokens.css
```

---

## 功能一览

| 功能 | 说明 |
|------|------|
| **可视化审查清单** | 每个操作显示为一行，包含改前/改后值、层级路径、风险等级 |
| **风险分级** | `safe` 自动勾选；`risky` / `destructive` 需手动确认 |
| **Zoom to node** | 点击任意行的 Zoom，直接跳转到 Figma 中对应图层 |
| **一键撤销** | 整个上一次执行的操作，一键全部还原 |
| **Token 审计** | 扫描页面内所有 hardcoded 颜色，找出应该绑定 token 的节点 |
| **Override 审计** | 找出组件实例中样式与主组件不符的属性 |
| **变量导出** | 将 Figma 变量导出为 CSS variables / Style Dictionary / Tailwind / JSON |
| **组件快照与 Diff** | 快照当前组件状态，之后对比两个快照找出 breaking changes |
| **语义 token 建议** | 选中图层后，找出最匹配的语义 token 供绑定 |
| **批量操作** | 多个操作打包成一个 Plan，一次审查一次执行 |

---

## 12 个 MCP 工具

| 工具 | 功能 |
|------|------|
| `figma_get_selection` | 获取 Figma 当前选中的节点 |
| `figma_inspect_node` | 获取节点完整样式数据（fills、strokes、token 绑定、子节点） |
| `figma_propose_rename` | 提出改名操作，用户在插件里审批 |
| `figma_propose_batch_operations` | 批量操作作为一个 Plan 发送审查 |
| `figma_propose_set_variable` | 提出将 Figma 变量绑定到节点属性 |
| `figma_audit_tokens` | 扫描页面内 hardcoded 颜色违规 |
| `figma_audit_overrides` | 扫描组件实例的 override 漂移 |
| `figma_list_components` | 列出当前页面的所有组件和组件集 |
| `figma_search_components` | 按名称/variant/类型搜索组件 |
| `figma_export_tokens` | 导出所有变量（CSS / Style Dictionary / Tailwind / JSON） |
| `figma_component_snapshot` | 将组件状态快照保存为 JSON 文件 |
| `figma_diff_snapshots` | 对比两个快照，识别 breaking vs non-breaking 变更 |

---

## 安全说明

- Bridge server 仅监听 `127.0.0.1`（本机），不对局域网开放
- 插件 manifest 限定网络访问范围为 `ws://localhost:7879`，由 Figma 强制执行
- 文件写入操作（token 导出、快照）仅限 home 目录内
- 设计数据不发送到任何外部服务器，全部在本地处理
- 操作历史通过 `figma.clientStorage` 存储（本地、按文件、按用户）

---

## 常见问题

**插件显示"Disconnected"**
→ 确认 bridge server 正在运行：`node bridge-server.js`
→ 检查端口占用：`lsof -i :7879`

**Claude 看不到 MCP 工具**
→ 重新注册：`claude mcp add figma-control-bridge -- node /完整路径/mcp-server.js`
→ 验证：`claude mcp list`

**操作报错"Node not found"**
→ 节点可能已被移动或删除，用 `figma_get_selection` 重新获取节点 ID

**编译报错**
→ 确认 Node.js 版本 ≥ 18：`node --version`
→ 先运行 `npm install`

---

## License

MIT
