# 迁移速查表：rc.2 → alpha.5 官方 API 变化（源码实证，2026-08-24）

> 供 dsh-plugins 全面对齐重构使用。子代理深度研究报告（controller/ui-装配/typert/身份设置）完成后并入设计文档。

## 包结构变化

| rc.2 | alpha.5 | 影响 |
|---|---|---|
| `dsh-client-runtime`（client 全部 ctx） | **移除**；client 插件 `ClientContext = Context`(cordis) | 5 个 client 插件 import 已改 cordis |
| ctx.slots 来自 client-runtime | ctx.slots 来自 **ui-renderer**（SlotRegistry） | inject/devDeps 换 ui-renderer |
| ctx.sessions/workspaces 来自 client-runtime | 来自 **api/session-controller、api/workspace-controller**（Host+Client 成对） | 用 sessions 的插件（dsh-tabs）适配 |
| ctx.settingsScope 来自 client-runtime | 来自 **ui-settings**（`inject=['remote','remote.settings']`） | devDeps + inject 换 ui-settings |
| ctx.remote 来自 client-runtime | 来自 **api-remotes** | inject + devDeps 换 api-remotes |
| cordis ^4.0.1 | cordis **^4.0.2** | peer/devDeps bump |
| `settingsNamespace` 在 dsh-settings | 迁移 **api/settings-controller** | host 注册设置命名空间改 import |
| 无 store 基建 | 新增 **dsh-client-store**（defineStore/zustand） | 新 client model 用它 |

## 官方 client 插件形态（样板 = ui-schedule）

```
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'      // 类型副作用合并
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client' // ctx.slots
export const inject = ['slots', 'locale']                          // 运行时服务
export function apply(ctx: ClientContext): void { ctx.slots.inject('...', () => ctx.slots.register({...}, Comp)) }
```

package.json:
- peerDependencies: 只 `@deepseek-ai/cordis`
- devDependencies: 类型声明包（ui-renderer/ui-session/ui-slots/api-remotes...）
- dsh.client.inject: 按需服务（用 slots→ui-renderer，用 locale→ui-locale...）
- react ^18（官方）vs 我们 react 19 —— 需确认兼容或降级

## 官方 host controller 形态（样板 = api/settings-controller）

```
class SettingsController extends TypertRemoteService {
  @Remote 方法...  // 不写 HTTP 端点，client 经 ctx.remote 消费
}
```
- controller 层 = Host 权威（@Remote）+ 无 HTTP 端点
- 我们 console/channel 的 /api/* 端点评估是否改 @Remote controller

## 待子代理补全
- session-controller/workspace-controller 完整 Host+Client 成对模式
- ui-session/ui-workspace adapter → hooks
- typert generator 完整接入（tsconfig.host/client + tsdown）
- experimental agent-team 覆盖面（是否替代我们 vendored task-board 等）

## 身份与设置模型调研结论（子代理，2026-08-24）

- **官方无用户/角色**：仅 per-home 匿名 UUID（telemetry）+ 浏览器会话 cookie（无用户维度）。dsh-user 无法挂官方 core；用户登录/角色只能在**前置网关**实现（我们 dsh-gateway 已做，需配 Host 转发 + trustedHosts）。
- **浏览器认证**：client-connection 的 BrowserAuth = 进程启动 token → 一次性兑换 HMAC cookie（`dsh-auth-*`，HttpOnly/SameSite=Strict，request Host 作 audience）。无用户维度。
- **settings host 权威**：ctx.settings (SettingsProvider) register(ns, schema, {base}) → SettingsScope owner handle (get/watch/update/replace)。写队列串行 + expectedRevision 防冲突。解析：defaults→base→user。
- **settings client**：ui-settings 提供 ctx.settingsScope.bind({namespace}) → getSnapshot/subscribe/set/unset/mutate。**持久化门槛**：仅 loopback 页同步 host；非 loopback=memory 只读态（远程/网关打开的 GUI 设置不持久化——多实例布局持久化需自研通道）。
- **设置 UI 槽位**：settings.section（页，list/root，id+order+label）/ settings.general.item（General 区偏好行）。注册设置页 = host 注册命名空间 + client 注册 section 槽两步。
- **风险**：settingsScope 双义术语（host owner handle vs client 服务）勿混；官方 UI 是抄官方基准。

## dsh-console controller 化初步判断（2026-08-24 自查）

- host 已有 @Remote：listInstances / controlInstance ✅
- HTTP 端点 /api/console/instances + /api/console/control：**只被 client 探测用**（数据已走 ctx.remote）→ 冗余旧路，重构移除
- daemon startControlServer（client-request 信封处理 @Remote）：**跨实例控制直连载体**（保留）
- 暴露面规范化：实例列表/控制/inbox 等 client 消费的 → 全 @Remote；内部方法（registerHost/setInstanceRecord）→ 保留 host 私有或经 channel
- 待 controller 子代理报告校验：是否需拆 "api/console-controller" 独立包（Host 权威）+ client model 层
