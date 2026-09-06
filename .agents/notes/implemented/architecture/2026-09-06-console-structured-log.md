# Agent Note: dsh-console 日志结构化——JSONL 落盘 + 控制台查看器

Status: implemented

## Problem

dsh-console「日志」页签原是自由文本整段 dump：`Logger.append` 写 `[ISO] msg`
（无级别），GUI 只能整段读，无法按级别/关键字过滤、无法高亮错误行，管理员难以
从控制台回溯诊断（用户原话：「这是控制台，日志搜索能让我知道发生了什么事情，
出问题能诊断回溯」）。采纳 B 方案：console/daemon 落盘改结构化 JSONL 带级别，
`readLog` 返回 `records[]`，前端查看器逐行/级别/搜索/错误高亮。

## Decision

### 记录模型（dsh-console/types，Remote 边界）

```ts
type LogLevel = 'debug'|'info'|'warn'|'error'
interface LogRecord { ts:string; role:'console'|'daemon'|'instance'; level:LogLevel|null;
  scope:string; instanceId?:string; msg:string }
interface LogReadResult { records:LogRecord[]; total:number; truncated:boolean }  // 替换原 content
```

### host 侧：Logger.record + log(msg, extra)

- `Logger.record(role,{level,scope,msg,instanceId?})` 写 JSONL
  `{ts,role,level,scope,instanceId?,msg}`；与 `Logger.append`（纯文本 `[ISO] msg` 镜像）
  **双轨共用 resolvePath 同一文件**，保历史 .log 可读与外部工具向后兼容；instance
  角色 resolvePath=null → 不落盘。
- `ConsoleService.log(msg, extra?:{level?;scope?;instanceId?})` 三写
  （console.log + record + append）。级别缺省用**字面标记表**
  `/失败|拒绝|不可达|回滚失败|超时|异常|ENOENT|error/i → 'error'`，否则 `'info'`
  （本库消息为固定中文串）；warn/debug 仅个别显式传。
- 把描述**控制/部署/引导/升级/probe/daemon spawn 结果**的裸 console.log 改走
  `this.log`（带 scope: control/deploy/upgrade/daemon/instance/console），令 GUI 可见。
  保留 terminal-only：console 角色 webServer 注册（「固定动作非审计事件」）与
  daemon/instance 的 v1 占位、instance 自退决策（instance 不落盘，走 this.log 无增益）。
- `readLogFromFile` 逐非空行解析：JSONL 采用为 LogRecord（缺字段补全，level 非法→null，
  role 缺省按文件归属）；老 `[ISO] msg` 宽松解析（ts 可空、level:null）。tail=最后 N 条
  record（0=全部）；total=非空行数；truncated=maxBytes 口径不变。instance 角色文件按
  `logs/<id>.log` 归属 role='instance'。

### client 侧：日志页签结构化查看器（P2）

顶栏：来源 · 级别（全部 / 仅 error / warn 及以上 / info 及以上）· 只看错误 · 搜索 ·
加载行数 · 跟随/暂停 · 重载 · 滚到底 · 复制（=可见过滤行）。正文逐行渲染
`时间(UTC)·级别色标·role[/实例]·msg`：error 行标红、搜索命中高亮；空态区分「暂无日志」
与「无匹配记录」。
过滤/搜索/高亮/复制文本为**纯函数**，抽到 `src/client/logView.ts`
（filterRecords / splitByQuery / formatRowTime / recordsToText 等，node 单测）；
`ConsolePanel` 在组件顶层派生 `visibleLogRecords` 与 `copyLogVisible`，不在
`view()` 的 switch case 内调用 hooks（规避 rules-of-hooks 条件调用）。

## Alternatives

- 仅前端在读取时解析文本做过滤 —— 否决：落盘仍无级别/结构，任何读取方（不只本
  GUI）都拿不到结构化记录；故选 host 落盘 JSONL（B 方案）。
- `formatRowTime` 用本地时区 —— 否决：记录 ts 为 ISO（UTC Z），本地时区让展示与
  单测随机器 TZ 不确定；统一 UTC。

## Consequences

- 磁盘格式：console.log / daemon.log 现为 **JSONL + legacy `[ISO]` 混合**，
  `readLogFromFile` 逐行双解析兼容旧行。
- 共享契约 `LogReadResult` 形状变更（content→records[]）——已同步 client 半区、
  typert host/remote-client 契约；仓库内无其它包消费该类型。
- 已知缺口（v1 边界）：console → 守护的**跨守护实例日志读取仍为 fallback 空**
  （转发需 async @Remote，列为 v2）；daemon `logs/<id>.log` 是实例 stdout 自由文本，
  查看器实例日志项暂不可用。
- 测试：dsh-console 108 全绿（74 index + 34 logView）；typecheck/build 绿。
