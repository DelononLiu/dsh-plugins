# dsh-console 日志面（2026-09-05）

## 背景

dsh-console 的运维痛点：实例/守护出了事只能 SSH 上目标机查
`~/.dsh-daemon/logs/<id>.log` / `daemon.log`，控制台看不到——管理端没有
"侦察"通道，跨实例 RPC 没有暴露日志面。

**v1 范围（讨论确认）**：
- 日志来源 = 实例 + 守护自身（**不**含控制面 console 角色决策日志的 UI 集成）
- 传输 = `@Remote` 函数调用（typert，自动 wire；不走 broker task 平面事件）
- UI = `ConsolePanel` 新增 `日志` 页签
- 能力 = 查看 + tail + 复制 + 守护自身 + 自动 tail（3s 轮询 + 滚到底）

## 设计要点

### 数据面

**新增 `Logger` 模块**（`packages/dsh-console/src/index.ts`）：
- `resolvePath(role)`：**统一按各角色 DSH_HOME（roleDataRoot）**——daemon → `${DSH_HOME}/daemon.log`（fallback `~/.dsh-daemon`）、console → `${DSH_HOME}/console.log`（fallback `~/.dsh/console.log`）；**instance → null**（无管理面）。日志文件每 profile 一目录，天然隔离
- `append(role, line)`：`fs.appendFileSync` 追加一行（带 ISO 时间戳），失败静默吞（不能让日志落盘挂掉主流程）

**不劫持 `console.log`**：保留 45+ 处原样（避免 review 噪音），新增 `private log(line)` 双写（console + 文件），由 17 个**关键事件点**显式调用：升级/部署/启停/回滚/跨实例 RPC 失败/控制端点注册/SIGTERM 等。普通噪声行（"已在运行"/"收到 v1 占位"）只走 console.log，不刷盘。

### typert 传输

**新增 2 个 `@Remote` 方法**（自动 wire `console/listLogFiles` + `console/readLog`）：
- `listLogFiles(): { daemon: LogFileMeta | null; instances: LogFileMeta[] }`：daemon 角色返回本机；console 角色 v1 只返回自身 console.log（**不**转发到 launch 守护——callRemote 同步签名限制，v2 改 async @Remote 或专用 channel 事件）
- `readLog(target: { kind: 'daemon' } | { kind: 'instance'; instanceId }, opts: { tail?; maxBytes? }): { content; total; truncated }`

**安全约束**：
- **白名单**：daemon 角色读 `${DSH_HOME}/{logs/<id>.log, daemon.log}`（实例 id 必须在 `config.instances` 内；实例 stdout 由 daemon spawn 收集到 daemon 的 `${DSH_HOME}/logs/<id>.log`）；console 角色读 `${DSH_HOME}/console.log`（仅 'daemon' target）；instance 角色一律返回空。**跨 DSH_HOME 读取 = 跨实例 RPC（@Remote readLog 本地读文件）**，不做文件级同步
- **路径硬编码**：不接 target 参数拼路径，防任意文件读
- **maxBytes 兜底**：默认 512KB（v1 readFileSync 全文不卡），超限标记 `truncated: true`
- **tail 倒推**：默认 200 行（业界 `tail -N` 语义：去尾空行后切片 `slice(-N)`），可配置 100/200/500/1000

### UI（ConsolePanel '日志' 页签）

```
┌─ 工具条 ─────────────────────────────────────────────┐
│ 来源 [daemon ▾]  行数 [200 ▾]  [⟳ 重载]  ☐自动 tail │
│                                       [⤓ 滚到底] [⧉ 复制] │
├─ 元信息 ─────────────────────────────────────────────┤
│ 共 247 行，显示最后 200 行                            │
├─ 内容区（max-height 50vh，overflow auto）─────────────┤
│ [2026-09-05T13:31:42.301Z] [dsh-console/daemon] ... │
│ ...                                                   │
└──────────────────────────────────────────────────────┘
```

- 沿用 `dsh-console-toolbar` / `dsh-console-code` 样式契约（已有），仅日志容器加 `max-height: 50vh; overflow: auto`
- 切换到 `logs` 页签：`listLogFiles()` 拉一次下拉选项 + 立即 `readLog`；开 `自动 tail` 后每 3s 周期拉 + 滚到底
- 复制走 `navigator.clipboard.writeText`（与升级页一致）

## v1 限制（backlog）

- **console 角色 listLogFiles 转发到守护**未实现（typert @Remote 同步签名限制）；v1 console UI 只能看 console 自身日志，daemon 拉取留 v2 改 async @Remote 或专用 channel 事件转发
- **自动 tail 客户端 3s 轮询**，未走 SSE/WS（broker 不在 v1 范围）
- **关键字过滤 / grep** 未实现（前端 substring 可在 v2 加；不调守护）
- **多实例合并视图** 未实现（用户切下拉 = 它的多实例并行）
- **inbox UI 入口** 不在 v1（backlog 项）
- **dsh-prometheus 挂起**（backlog）

## 风险

| 风险 | 处置 |
| --- | --- |
| 日志文件无限增长耗磁盘 | **v1 不做**——运维责任；按需 v2 加 rotate |
| daemon 没装过实例 → logs 目录不存在 | `listLogFiles` 跳过不存在文件；`readLog` 返回 `content: ''` |
| 跨实例 RPC 不可达 | UI 提示「读取失败：…」（与现有 `listInstances` 失败一致） |
| 日志敏感信息（DSH_CONSOLE_ADDR 等） | 现状：daemon spawn 实例时已传 env（命令行为可见）——**与现状对齐**，不引入新暴露面 |
| `console.log` 改成 `this.log` 后多 IO | 升级事务 5-8 行/事务，量级可忽略；console 角色更低频 |

## 落地

3 个 commit（worktree `feat/dsh-console-logs`，每个独立可回滚）：
1. `feat: dsh-console 关键事件落盘——daemon/console 角色双写 console.log + .log 文件`
2. `feat: dsh-console @Remote listLogFiles/readLog——UI 读日志的传输层`
3. `feat: dsh-console client ConsolePanel '日志' 页签——下拉 + tail + 复制 + 自动 tail`

## 测试

62 通过（49 旧 + 7 Logger + 6 日志 remote：logPathFor 白名单 / listLogFiles daemon / readLog tail 倒推 / maxBytes 截断 / console 角色读 console.log / instance 角色拒绝）。

全仓库 `pnpm -r typecheck` 通过。
