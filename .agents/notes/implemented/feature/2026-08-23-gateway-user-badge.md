# Agent Note: dsh-gateway 集成 + 侧边栏用户显示

Status: implemented

## Problem

架构矩阵中 dsh-gateway（认证网关）标"选定未装"。用户要求：集成 dsh-gateway，结合 dsh-user，并在**左侧边栏设置按钮下方**增加当前用户显示。

**架构约束（用户强调）**：dsh-gateway / dsh-user 的总体设计必须保证**未来可替换为 APISIX 这类通用网关**——身份链路不得与任何具体网关（cookie/账号体系/协议）耦合，只能依赖"网关注入身份头"这一稳定契约。

## 调研结论（源码确认，2026-08）

1. **dsh-gateway（clarknu，npm v1.6.0，MIT）**：HTTPS + 登录网关，插件式安装（`dsh plugin add`），fail-closed（默认 loopback + 无账号）。能力：远程访问 DSH Web、HTTPS 加密、登录保护（scrypt 哈希、限速、会话吊销）、多站点、设置页 Remote Gateway 卡片、配置热生效。
2. **关键事实**：gateway **不注入身份头**——登录后只把用户名留在自己 cookie（`auth.verify(req.headers.cookie)`），透传 upstream 时仅加 `x-forwarded-*`（标准代理头），**不写 `x-dsh-user-id` 类身份头**。即 gateway 的账号体系（`gateway.users`）与 dsh-user 身份模型**当前是断开的**。
3. **dsh-user 现状**：`ctx.user` 已实现（UserService：current/instanceAccess/isOwner，13 测试），`gatewayHeaders` 配置（`x-dsh-user-id`/`x-dsh-user-roles` 默认）为"网关注入模式"预留——但 gateway 不注入，所以该路径当前不生效；实际走静态配置回退（`users` 列表或 anonymous guest）。
4. **官方无当前用户/会话 API**（grep 无 currentUser/whoami//api/me）——用户显示需自研消费方。
5. **侧边栏结构**（SidebarRoot.tsx）：`.footArea` 含 `.footerActions`（sidebar.footer.action = 控制台/工具入口）+ `.settingsArea`（sidebar.settings = 设置按钮）。用户显示目标 = **settingsArea 之下、footArea 内**（设置按钮下方）。

## Decision（已实现 2026-08）

**身份令牌契约 = JWT（RFC 7519，网关签发 → dsh-user 验签消费）**——这是可替换 APISIX 类通用网关的关键：任何网关只要签发标准 JWT，dsh-user 就能消费。**社区现状**（npm 源码确认）：已调研 6 个 DSH 网关（clarknu/dsh-gateway、TecFancy/dsh-auth-gate、Yuuz12/dsh-webui-auth、luodeb/dsh-web-auth-gateway、xbzbing/dsh-auth-gateway、slywalker2006/dsh-passwords）**均不签发标准 JWT**（私有 cookie/内存 token + 不注入身份头）。

**落地策略（接口先行，不阻塞当前）**：
1. **dsh-user 定义 `IdentityResolver` 接口**（`resolve(headers) → User | undefined`）——身份来源可插拔的稳定边界；`current()` 解析链 = 网关注入头 → resolver → 静态配置回退。
2. **现在实现 `gateway-cookie` 适配器**：读 clarknu/dsh-gateway 的私有 cookie（`dsh_gw_sid`，HMAC 签名）+ `hmacSecret`（`$DSH_HOME/gateway/state.json`）验签取用户名——**不改 vendor**（三方插件尽量不改）。
3. **将来接 APISIX**：新增 `jwt` 适配器（验标准 JWT）——dsh-user 消费方与用户显示**零改动**；契约的"JWT 标准"体现在接口与未来实现。
4. **侧边栏用户显示**：dsh-user client 半区（新增 exports["./client"] + build-client 接入），经 host 端点（如 `/api/user/me`）读 `ctx.user.current()` 显示用户名 + 角色；落点 = footArea 最底部（设置按钮下方），样式对齐官方 foot 按钮契约。
5. **用户显示只消费身份模型**（`ctx.user.current()`），不依赖具体网关实现——换网关后显示不变。

## Alternatives

- **不集成 gateway，只做用户显示**：用户显示可独立做（静态配置即显示），gateway 集成另议——但用户明确要求 gateway 集成。
- **fork gateway 加身份头**：违反 vendoring policy（不 fork，走 patch 层）——优先找配置项/最小 patch；且三方插件尽量不改（用户指示）。
- **替换为签发 JWT 的网关**：社区**无现成**（调研 6 个均不签发标准 JWT）——JWT 化留给接 APISIX 时（届时 APISIX 原生签发，dsh-user 的 jwt 适配器直接可用），不阻塞当前。
- **直接耦合 gateway 的 cookie/账号 API**（不做 resolver 接口）：换 APISIX 要重写身份链路——违反用户约束，否决。
- **用户显示放 sidebar.footer.action**：与控制台并列（order 更大→显示在更下），但那是"控制台上方/设置上方"，非"设置下面"——不满足。

## Consequences

- dsh-user 增加 `IdentityResolver` 接口 + `gateway-cookie` 适配器（读私有 cookie + hmacSecret 验签，不改 vendor）；将来 APISIX 增 `jwt` 适配器，消费方零改动。
- 用户显示：侧边栏底部（设置下方）显示当前用户（名称 + 角色徽标），样式对齐官方 foot 按钮；只消费身份模型，网关可替换。
- 已验证（web2 实测通过）：gateway cookie 验签（`dsh_gw_sid` + hmacSecret 读取路径）；用户显示落点（设置下方）的官方 slots 支持（可能需要 DOM 注入或新插槽声明）。
- 依赖：dsh-user client 半区（新增 exports["./client"] + build-client 接入）。
- 可替换性验收：实现后以"dsh-gateway 换成 APISIX，dsh-user/用户显示零改动"为设计验证标准。
