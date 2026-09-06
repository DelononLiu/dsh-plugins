# Agent Note (proposed): dsh-console 控制台日志结构化 + 可用查看器

Status: proposed（计划未实现，供续接会话执行）
分支：feat/console-structured-log（工作树 `../dsh-plugins-feat-console-log`，当前 == main HEAD 737c3bb，无实现改动）

## 目标与背景
dsh-console「日志」页签现状：`Logger.append` 写自由文本 `[ISO] 消息`（无级别），GUI 整段 dump 无法搜索/过滤。
需求：B 方案——console/daemon 落盘改结构化 JSONL 带级别；`readLog` 返回 `records[]`；前端查看器逐行/级别/搜索/错误高亮。
管理员使用场景（用户原话）：「这是控制台，日志搜索能让我知道发生了什么事情，出问题能诊断回溯」。

## 现状锚点（已核实）
- `packages/dsh-console/src/types.ts`：`LogReadResult{content,total,truncated}`、`LogReadOptions{tail,maxBytes}`、`LogTarget`、`LogFileMeta`、`LogFileList`。
- `src/index.ts`：`ConsoleService.log(line)`(≈193, console.log+Logger.append)、`logPathFor/logStat/listLogFiles/readLog/readLogFromFile`(≈1486-1665)、`roleDataRoot`/`export const Logger{resolvePath,append}`(≈1718-1748)。
- 日志点规模：裸 `console.log(` ≈28、`this.log(` ≈21、`Logger.append` 1。instance 不落盘。
- 测试 `tests/index.spec.ts`：`describe('Logger…')` 与 `describe('日志（@Remote readLog / listLogFiles）')`。现状 5 失败均为 readLog 用例（只设 HOME 未设 DSH_HOME，读到真实 ~/.dsh-*）。
- dsh-console 现状 63 通过 / 5 失败（baseline，工作树已 build）。

## 记录模型
```ts
type LogLevel = 'debug'|'info'|'warn'|'error'
interface LogRecord { ts:string; role:'console'|'daemon'|'instance'; level:LogLevel|null; scope:string; instanceId?:string; msg:string }
interface LogReadResult { records:LogRecord[]; total:number; truncated:boolean }
```

## P1 host 侧
1. types.ts 加 LogLevel/LogRecord、LogReadResult 改 records[]。
2. Logger 加 `record(role,{level,scope,msg,instanceId?})`：JSONL `JSON.stringify({ts,role,level,scope,...(instanceId?...:{}),msg})`；保留 resolvePath 与 append(纯文本)。
3. `readLogFromFile` 解析 records：每非空行 JSON.parse（含 ts+msg 且兼容→采用，缺字段补全）否则老 `[ISO] msg` 宽松解析（ts 可空、level:null）；role 按文件归属；tail 取最后 N 条 record；total=非空行数；truncated=maxBytes 口径不变。
4. `readLog`（@Remote）返回新 LogReadResult；跨守护 instance 转发路径保持现状但类型对齐。
5. client 最小适配（仅编译过）：`src/client/ConsolePanel.tsx` fetchLog 从 r.records 汇文本（`records.map(r=>r.msg).join('\n')`）喂现有渲染；P2 再做完整查看器。
6. ConsoleService 内部日志升级带级别：加 `private log(msg, extra?:{level?;scope?;instanceId?})`，内部 console.log + Logger.record；级别用**字面标记表**（本库消息固定中文串）：`/失败|拒绝|不可达|回滚失败|超时|异常|ENOENT|error/`→error，否则 info；warn/debug 个别显式。把描述控制/部署/引导/升级/probe/daemon spawn 结果的日志点改走 this.log（裸 console.log 里属事件的也纳入，令 GUI 可见）；instance 不落盘保持。
7. 测试更新：Logger.record JSONL round-trip 断言；readLog 组修 DSH_HOME 环境问题并改为 records 断言（JSONL+老行混合、tail 最后 N、truncated、白名单外空）；目标 dsh-console 全绿。
8. 校验：`pnpm --filter dsh-console typecheck/test/build` 全绿（build 会 build-typert + client）。

## P2 查看器（client）
`ConsolePanel.tsx` 日志页签重做：顶栏 `来源` + `级别(全部/error/warn/info)` + `搜索框` + `跟随/暂停`；正文逐行 `时间·级别色标·role/实例·msg`，错误行标红、命中高亮，只看错误一键；复制按可见。对齐『知道发生什么+诊断回溯』。更新设置文案/文档，加 client 测试（可测渲染逻辑的函数化）。

## P3 收尾
- 其余裸 console.log（非事件/终端调试）归并或收敛。
- 跨守护 instance 日志读取缺口（console→daemon 转发 v1 fallback 空）视需要补。
- 文档 docs/architecture.md 相关段落 + implemented Agent Note 同提交；全量 `pnpm typecheck`/受影响包 test/build。
- 全部通过后合入 main（一个功能单元）。

## 已踩坑 / 续接注意
- subagent 实现模型：用户 `subagent-model-selection.allowedModels` 当前 = kilo 网关免费模型（cohere/north-mini-code、dots-studio/dots-3-note-preview、nvidia/nemotron-3-super）。**策略按会话投影缓存**——重启后**新开会话**才能用上新 allowedModels；已存在/恢复会话沿用旧快照。委托时显式 `provider`+`model` 且须命中 allowedModels，否则抛 not allowed；纯继承（不带模型字段）会继承父代理(deepseek-v4-flash)。
- 免费模型跑大重构可能慢/低产出；必要时用户可临时把父模型(deepseek-v4-flash)用于实现子代理（仅继承路径可达）。
