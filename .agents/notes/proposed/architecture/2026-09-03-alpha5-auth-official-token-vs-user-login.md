# alpha.5 访问认证：官方 token fence vs dsh-user 登录（实测结论）

## 背景

升级 0.1.2-alpha.5 后，官方 `dsh-client-connection` 给每个 web 进程加了
BrowserAuth fence：启动打印一次性 launch token（`?token=`），浏览器换取
HMAC 签名 cookie（绑定 authority，secret 持久在本 home，默认 30 天）；
之后 `/` 与官方 transport 全被 cookie 挡。**无用户名/密码/角色**（纯
possession 模型）。官方代码里 `password/username/role` 匹配数为 0。

## 实测发现

1. **clarknu/dsh-gateway（社区 vendored，当前 1.6.0）已被官方 fence 架空**：
   登录页可访问（3443/3445），但反代到 upstream `/` 时无官方 cookie →
   **401**。伪造合法 `dsh_gw_sid`(admin) 也进不去 UI。
2. **上游 1.7.0 只修了 Host/Origin fence**（loopback 伪装 + Location 改写），
   **没有桥接官方 BrowserAuth cookie**——升级解决不了 401。
3. **官方 fence 无 bypass 开关**：仅 `trustedHosts`（Host 白名单，非 auth
   豁免）+ `cookieMaxAgeDays`。gateway 反代链路在 alpha.5 必然需要官方会话。
4. **dsh-user 的 cookie 验签链路与 clarknu gateway 解耦**：web5 关掉
   gateway 插件实测——dsh-user 零报错，身份恒回退静态第一用户（admin）；
   但只要 ① HTTPS 网关头 `x-forwarded-proto: https` ② 有效 `dsh_gw_sid`，
   即正确解析 `user/member/viaGateway:true`。clarknu gateway 只是"签发
   cookie 的 HTTPS 网关"的一种实现，**不是 dsh-user 的硬依赖**。
5. dsh-user 另有 `gatewayHeaders` 注入头模式（userId/userRoles 头直接
   解析），可作第二种网关适配。

## 决策

- **不放弃官方 token fence**（内核防线，alpha.5 起默认开启，语义 =
  防局域网陌生人直连；我们不该绕它）。
- **不放弃 dsh-user 多用户身份**（差异化核心，官方无 user/roles）。
- **方向：自研"官方会话桥"替代 clarknu gateway 角色**——登录后持官方
  cookie 进 UI，同时以 HTTPS 头 + 身份 cookie 喂 dsh-user，恢复多用户/
  角色/owner 隔离。官方会话获取：进程内插件可调 `ctx.connection.authenticatedUrl()`
  （官方已暴露，见 dsh-client-connection `HostConnectionService`）。
- clarknu/dsh-gateway 桥接列为 **backlog**（较大改造，先沉淀本文档）。

## 状态

- 2026-09-03：web5 隔离实测完成（关 gateway 只留 dsh-user 的完整行为矩阵
  已记录）；测试环境已还原 gateway 配置并恢复运行。
- 待办：官方会话桥设计 + 实施（worktree 新分支），验证后铺开。
