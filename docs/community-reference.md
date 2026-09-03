# 社区参考调研（按分层，2026-08-21）

基于定稿架构（系统-身份/系统-通信/管理组件/UI/部署）的社区扫描。每条含：repo、定位、与我们组件的对应关系（match）、可借鉴点（takeaway）、License。**只收录真实存在、与"多用户/多实例团队发行包"相关的参考。**

## 系统层 · 身份（dsh-user）

| 参考 | 定位 | 借鉴点 | License |
| --- | --- | --- | --- |
| [slywalker2006/dsh-passwords](https://github.com/slywalker2006/dsh-passwords)（npm dsh-passwords） | 多租户平台：主/子用户账号体系、按账号的工作区/会话/沙盒权限、token/时长配额、消息隔离、登录审计、自动 HTTPS | **最直接对应 dsh-user 的"多用户+归属与授权"**：主/子用户模型；授权矩阵到"工作区→会话"粒度；沙盒三档（只读/可写/完全）；每小时 token+每日时长上限；改密即吊销全部旧会话+审计 | BSD-3-Clause |
| [Z-6354/dsh-local-hanaccount](https://github.com/Z-6354/dsh-local-hanaccount)（npm v0.1.1） | 静态配置本地多账号门：cordis.patch.yml 配置、cookie→ALS 对原生 workspace 做账号级视图/守卫 | **对应"静态配置模式+归属"**：不另建数据树，只 gate 登录+按账号 scoping 原生 workspace；identity 用 cookie→ALS；明确"cordis.patch.yml config 整段替换非深合并"的坑；诚实声明边界（不 claim 全局 HTTP 中间件） | MIT |
| [Yuuz12/dsh-webui-auth](https://github.com/Yuuz12/dsh-webui-auth)（npm） | HTTP/传输层强制登录：WebUI/插件 bundle/api/WS 四层运行时包装（不改核心源码），持久会话+HttpOnly Cookie+scrypt | **"网关注入模式"的对标**：四层兜底路由包装+fail-closed（包装不全拒绝启用认证）；已认证请求以"回环形状"转交核心（解决反代下 settings/credentials 回环钉死特权方法）；反代下 WS 需 trustedHosts；HMAC 假名化 IP 审计+空跑 scrypt 抹平枚举时序 | MIT |
| [luodeb/dsh-web-auth-gateway](https://github.com/luodeb/dsh-web-auth-gateway) | 独立回环端口认证反代网关：登录页+代理完整 DSH Web 面 | 网关注入的反代形态；scrypt 加盐哈希（credential.json 0600）+HttpOnly/SameSite=Strict；**安全边界：上游 DSH 必须保持 127.0.0.1**（暴露即绕过） | BSD-3-Clause |
| [clarknu/dsh-gateway](https://github.com/clarknu/dsh-gateway)（npm v1.6.0） | 自包含 HTTPS+登录网关：scrypt、一键全体会话失效、多站点、配置热生效、fail-closed | fail-closed 默认（零账号谁都登不进）；listenHost 门控（默认凭据生效时拒绝非本机地址启动）；每 IP 登录限速+锁定；一键吊销所有已登录设备 | MIT |
| [TecFancy/dsh-auth-gate](https://github.com/TecFancy/dsh-auth-gate)（npm v0.7.2） | 应用层登录门：密码/共享 token 双模式、会话 Cookie、CLI 用户管理、`Authorization: Bearer` 直连 API | **Bearer token 模式 = 脚本/无头访问现成设计**；配置缺失/损坏时 block 而非放行；声明 dsh.bundle manifest 使 `dsh plugin add` 自动挂载 | MIT |
| [xbzbing/dsh-auth-gateway](https://github.com/xbzbing/dsh-auth-gateway) | 密码+TOTP 双因素登录网关 | 2FA 是网关注入模式的直接增强 | MIT |
| 排除边界 | [Stormycry-cryp/dsh-AuthInOne](https://github.com/Stormycry-cryp/dsh-AuthInOne)（43★）、hrhgit/dsh-oauth | 实为 **LLM provider 登录**（Codex/OpenAI OAuth、用量统计），非用户身份——避免误引 | MIT |

## 系统层 · 通信（dsh-channel）

| 参考 | 定位 | 借鉴点 | License |
| --- | --- | --- | --- |
| [baixianger/dsh-weave](https://github.com/baixianger/dsh-weave)（npm 0.1.0-rc.0） | Iroh/QUIC P2P 网状织网：多机 DSH 组可信网络、加密对等发现、过期邀请 ticket、显式信任、心跳/可达性、会话级事件投递 | **与 dsh-channel 发现层几乎一一对应（设计蓝本）**：①节点持久身份存 identity.json（重启不换身份——实例 ID 应同样持久化）；②双层信任：传输加密≠授权（连接≠权限，远程执行默认拒绝直到接收节点批准）；③三平面协议 control/task（幂等 at-least-once）/session；④自托管 relay/discovery 是生产路径；⑤endpoint ticket 带寻址提示。**stage=design-preview，当设计蓝本而非生产依赖** | MIT |
| [BotonJ/dsh-remote-link](https://github.com/BotonJ/dsh-remote-link) | 把 DSH Web 暴露到局域网/隧道：QR+HMAC 一次性配对、HttpOnly Cookie 会话、设备注册表与吊销、mDNS 发现、/status 健康页 | **鉴权平面最接近的蓝本**：配对流 QR→/pair/challenge→HMAC proof→Cookie（解决 WS/EventSource 无法带 Authorization 头、官方事件流必须走 cookie 的难题——typert 远程调用同样面临）；网关独立端口+主 webserver 保持 127.0.0.1；长期恢复码；WS ping 防 NAT 静默收割 | MIT |
| [liguobao/deepseek-harness-remote](https://github.com/liguobao/deepseek-harness-remote)（npm ds-harness-remote@0.3.21） | 多设备远程继续同一会话：Noise IK 端到端加密+自适应 relay/WebRTC、设备授权、**仅暴露 ApiProxy 远程能力面** | ①远程端只拿 ApiProxy-only 能力（无 shell/无写权限）——**typert 远程调用面收缩的正确姿势，安全边界写在能力面而非网络**；②Noise IK+自适应传输；③**跨实例协议必须带版本协商**（client 0.3.21 兼容 host 0.3.15）；④自托管 relay"稍后提供"= 我们要补的缺口 | MIT |
| [SunNull/dsh-relay](https://github.com/SunNull/dsh-relay) | Wire-Trunk 云中继：家端 ~200 行零构建树外插件充当进程内"隐形浏览器"复放真实浏览器协议，云端纯转发，家端零入站端口天然穿 NAT | **多实例互联最实用的传输底座**：①Wire-Trunk（家端主动拨出长连接，前端与宿主永不漂移）；②"dsh 无认证层且特权方法钉死回环"的破解：请求以回环身份进入、认证补在转发面入口；③干线令牌（机↔云）与配对码（人↔云）分离=实例身份/用户身份分离 | MIT |
| [Noelune/dsh-agent-relay](https://github.com/Noelune/dsh-agent-relay)（npm 0.3.0） | Loopback-first 多 Agent 通信总线：HMAC-SHA256 鉴权 HTTP broker、relay_send/recv/peers/history、SQLite/JSONL 持久化 | **事件总线可照抄的骨架**：HMAC+300s 重放窗口+连续 5 次失败锁定 5min+单 IP 限速；投递语义（游标增量轮询+租约确认、7 天 TTL、UUID 幂等去重、指数退避）；Privacy-by-Design（消息体只为本机留存）；通信与编排解耦 | MIT |
| [GengDaPeng/dsh-agent-message](https://github.com/GengDaPeng/dsh-agent-message) | 进程内跨会话 Agent 通信：list_peer_agents/send_agent_message（followup|inject|steer）/check_delivery 回执、离线恢复会话再投递 | **控制指令投递语义**：三种投递模式=控制指令动词表；回执状态机 queued/claimed/discarded/unknown（跨实例控制必备确认语义）；离线恢复+按消息 ID 重启可查 | MIT |
| 更正 | [awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)（10,772★） | **Anil-matcha/awesome-dsh-plugin 已 404 失效**，用此替代；[ukinch605/awesome-dsh-hub](https://github.com/ukinch605/awesome-dsh-hub)（MIT，机器可读 registry 每小时刷新，消息通讯类 82 插件） | CC0-1.0 |

## 管理组件（dsh-console）

| 参考 | 定位 | 借鉴点 | License |
| --- | --- | --- | --- |
| [Linjiangxian0203/dsh-remote-tunnel](https://github.com/Linjiangxian0203/dsh-remote-tunnel) | Remote Host Tunnel Manager：远程服务器跑 dsh web，端口自动分配/注册、systemd 监督、断线自愈 SSH 隧道 | **部署编排最接近的社区参照**：端口分配前真实占用+注册表双校验（并发安全）、/etc/dsh-ports.tsv 注册表+audit 对账、每用户专属端口、up/down/status/check/hosts CLI（~/.ssh/config 自动发现）——"主机档案+生命周期+审计"直接映射 console 档案/编排模型 | MIT |
| [polaris-smart/dsh-devices](https://github.com/polaris-smart/dsh-devices) | 多设备 fleet：mDNS 局域网发现+双向密钥配对+SSH 直连执行，工具自动注册进会话（原 dph-fleet） | 发现/配对/执行三阶段+能力边界写明（mDNS 不跨子网）；纯插件挂载零核心改动 | MIT |
| [Airmetro/dsh-update-checker](https://github.com/Airmetro/dsh-update-checker) | 全栈更新管理：检测官方+第三方插件更新（npm+GitHub 双源）、一键更新+**备份/回滚**/watchdog 重启 | **直答未定项 U3（升级回滚策略）**：备份→更新→回滚闭环（/rollback、/plugin-rollback、/backups.json）；更新与回滚持久化到 profile package.json+lockfile 防静默回退；watchdog 以端口监听+HTTP 200 探活；写路由强制 loopback+confirm | MIT |
| [alex04130/dsh-forge](https://github.com/alex04130/dsh-forge) | DSH 运行时扩展套件：跨会话邮箱 mailbridge、agent 团队 teamhub、模型委派、运行时注入器与插件管理面板 | **inbox/投递对应物**：mailbridge 跨会话邮箱（session_list/read/send/mailbox_check、离线消息持久排队、重启自动投递）；注入器 symlink+loader.create+auto-plugins.json 持久注册表（与发行包 patch 层思路一致） | MIT |
| [zoahdev/dsh-plugin-doctor](https://github.com/zoahdev/dsh-plugin-doctor) | 插件健康检查：manifest/patch/entry/build/pack+全新 profile 安装验证+环境诊断（RFC #1629 dsh plugin check 先行） | **发行包质量门禁**：每条检查绑定真实事故编号；--full 模式在全新 profile 跑 pack→install→dump-config——版本锁校验+CI 冒烟可直接借鉴 | MIT |
| [xxiaoxiong/dsh-prometheus](https://github.com/xxiaoxiong/dsh-prometheus) | 有界 Prometheus 指标（会话/回合/LLM/工具/审批/子代理/后台任务）+ Grafana dashboard，默认 loopback-only | **总览数据面**：指标刻意有界、命名语义独立成文档、不导出 payload——多实例总览聚合复用同一指标面，避免逐插件私有指标模型 | MIT |

## UI · 导航与会话（dsh-quick-nav / dsh-tabs）

| 参考 | 定位 | 借鉴点 | License |
| --- | --- | --- | --- |
| [xinspark/dsh-better-session-title](https://github.com/xinspark/dsh-better-session-title) | 顶栏中央会话标题换「工作区/会话」两级面包屑+顶栏工作区/会话下拉（会话数、一键切换、新建） | **nav+tabs 的设计完全对应物**：顶栏内嵌两级下拉实现跨工作区会话切换；行内操作全部复用 DSH 原生能力（0 改系统源码）；released v1.0.0 可作功能清单对照 | MIT |
| [csiroqa/dsh-hotkeys](https://github.com/csiroqa/dsh-hotkeys) | 全局快捷键：会话切换（侧栏顺序环绕、按住连切）、新会话、发送/清空、停止、复制/归档 | **tabs 的 Alt+1..9 实现层同构**：动作全部基于 dsh-client-runtime 公开服务（不依赖宿主 DOM——跨版本稳定关键）；键位经 settings 命名空间持久化（host 半区 schema+浏览器半区 settingsScope，改值即时重建）；完整守卫集（IME/AltGr/输入框 ignoreInputs） | MIT |
| [dream12347/dsh-session-manager](https://github.com/dream12347/dsh-session-manager) | 会话管理：回收站、工作区分组排序、未读/已读状态点、继续/暂停、fork、上下文压缩 | **状态语义参照**：未读/已读状态点（手动蓝/等待琥珀/完成）；展示会话插件如何挂顶栏（并被 dsh-topbar-manager 接管治理） | MIT |
| [baihejiangnan/dsh-topbar-manager](https://github.com/baihejiangnan/dsh-topbar-manager) | 顶栏按钮治理：扫描其他插件添加的按钮，设置页开关控制显隐 | **顶栏注册表模型**：发行包内 nav/tabs/console 都会注入顶栏元素，借鉴"扫描-识别来源-开关"统一治理 | MIT |
| [HuanLinOTO/dsh-plugin-ya-workspace-sidebar](https://github.com/HuanLinOTO/dsh-plugin-ya-workspace-sidebar)（npm v0.3.1） | 工作区侧栏整体替代：顶部固定 5 条全局最近会话、日期分组、搜索/重命名/删除/Fork | cordis.patch.yml 禁用官方 ui-workspace 后整体替换（**与发行包 patch 层同思路**）；「全局最近会话置顶+日期分组」好 UX；预构建 lib/client.js+window.__ModuleLoader__.load() 发布流程可照抄 | **AGPL-3.0（只可参考设计，不可 vendored）** |
| [0xsline/dsh-spotlight](https://github.com/0xsline/dsh-spotlight)（npm @0xsline/dsh-spotlight） | 键盘命令面板：⌘K 唤起、模糊搜索斜杠命令/最近会话/UI 动作/插件设置 | 「复用原生注册表」原则（只向原生斜杠菜单贡献 /spotlight 而非维护第二套）；干净生命周期（卸载清理事件/样式/DOM） | MIT |

## UI · 全家桶与皮肤（dsh-desk / vendored dsh-web-ui）

> 详细版（17 包逐包核实 + 皮肤中心 v2 完整契约）见 [docs/research/2026-08-21-ui-skins-community-survey.md](research/2026-08-21-ui-skins-community-survey.md)。

| 参考 | 定位 | 借鉴点 | License |
| --- | --- | --- | --- |
| [zhu1090093659/dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui) | 全家桶：16 独立插件包（task-board/git-graph/remote-web-ui/ssh/pet/liangshen 等）+skins 皮肤中心 v2+dsh-web-ui-all 聚合包 | **vendored 来源（已核实补全）**：每能力独立成包+聚合包一键装齐（meta 包拼外部框架可行）；全部走官方 profile 机制、改造走各自 dsh.bundle.patch（=我们的 cordis.patch.yml）；插件管逻辑/皮肤管外观。**License 陷阱：4 包 BSD-3-Clause（chat-recovery/community-plugins/plugin-manager/skill-explorer）、1 款皮肤 CC BY-NC-SA 非商用** | Apache-2.0（混合） |
| [omdsh-dev/DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)（974★） | 服务化侧边栏框架：右侧栏+底部面板（文件/编辑器/内嵌浏览器/终端/Git/后台任务），ctx.betterSidebar.registerTab/registerFileViewer 对等注册 | **布局/组合+扩展点设计**：布局/Tab/面板按会话持久化+陈旧状态自动净化（多会话/多实例隔离参考）；~325KB 核心+重依赖按需加载；服务优先 API（第三方注册侧边栏页面/文件预览器）——UI 层扩展点照此设计 | MIT |
| [@linxin666/dsh-client-ui-skin-center](https://www.npmjs.com/package/@linxin666/dsh-client-ui-skin-center)（皮肤中心 v2） | 唯一皮肤加载器：皮肤=纯资产目录（skin.json+L1 token 重映射/L2 语义选择器+可选 L3 patches+hooks.mjs），内建 skins/+$DSH_HOME/skins 用户目录，试穿/应用原子切换 | **直答未定项 U8（皮肤中心接入方式）**：皮肤与官方彻底解耦只与皮肤中心耦合；新增皮肤=落目录免发布免安装（团队分发皮肤=拷贝目录）；fail-closed 校验+append-only 切换账本；index.html transform 首屏盖章防 FOUC | Apache-2.0 |
| [zhtx2024/dsh-skin-switcher](https://github.com/zhtx2024/dsh-skin-switcher) | 皮肤统一管理器：发现所有 dsh-client-ui-skin-*（任意 scope），legacy 切换原子重写 cordis.patch.yml managed section、v2 写 skin-center-active.json，启动迁移禁用旧竞争者 | **未定项 U8 的双引擎协调**：单一管理权威+启动迁移策略；managed section 原子重写+配置监视器热重载；皮肤包命名对齐 dsh-client-ui-skin-* 约定 | BSD-3-Clause |
| [baihejiangnan/dsh-plugin-pack-web](https://github.com/baihejiangnan/dsh-plugin-pack-web) | 30 插件"一键复刻"发行包：dsh-plugin-pack.json（**Plugin Pack Schema v1**）+安装命令+PROMPT.md | **直答未定项 U2（版本锁格式）**：清单 schema {schemaVersion,id,name,version,description,license,plugins:[{id,name,kind,spec,repository}]}，spec 支持 github:owner/repo、npm 包名、tar.gz 三种安装源；"复刻提示词+备份 JSON"克隆即用哲学（=profiles/ git clone 即用） | MIT |
| [RevolutionLA/dsh-dream-skin](https://github.com/RevolutionLA/dsh-dream-skin)（npm 0.4.1） | 换肤插件：8 套主题+每用户强调色+主题包导入导出/分享链接/收藏随机 | 主题包导入导出+分享链接=**团队内分发皮肤/主题的现成 UX**（多用户共享直接参考）；每用户强调色（呼应实例 personal） | MIT |

## 远程与 agent（部署链路 / headless host）

| 参考 | 定位 | 借鉴点 | License |
| --- | --- | --- | --- |
| [dsh-ssh](https://github.com/zhu1090093659/dsh-web-ui/tree/main/packages/dsh-ssh)（@linxin666/dsh-ssh，全家桶内） | 完整 SSH 运维：主机档案（~/.dsh/dsh-ssh.json）+连接池+Web 终端+SFTP+端口转发+集群并发执行，GUI 与 Agent 共享配置 | **SSH 引导与远程执行面板**：连接池复用（空闲 30min 断、重连≤3 次）；~/.ssh/config 导入+ProxyJump；ssh_list/exec/upload/download/tunnel/cluster 六工具与 GUI 共用配置（"console 只编排、agent 本地执行"形态）；安全模型（/api/* 仅 loopback、隧道只听 127.0.0.1、改连接字段立即断旧凭据） | Apache-2.0 |
| [chenkai2/dsh-daemon](https://github.com/chenkai2/dsh-daemon)（npm @chenkai114） | dsh web 注册为自启自愈后台服务：LaunchAgent/systemd/cron、watchdog 每 30s 健康检查 /health、连续 3 次失败重启（watchdog 为独立生成脚本） | **headless host 常驻/守护**：守护用独立 watchdog+ /health 端点（不依赖插件进程内存存活——"常驻"做成可验证契约）；dsh_daemon_install 等 7 工具让 agent 自助完成守护安装（契合"引导装最小 agent"后自举）。备选 [gitsang/dsh-daemon](https://github.com/gitsang/dsh-daemon)：systemd --user+独立管理 profile、拒绝 --host 0.0.0.0 | MIT |
| [bruc3van/dsh-desktop](https://github.com/bruc3van/dsh-desktop) | 独立桌面客户端：官方 Web UI 原封不动、长任务常驻托盘、精选插件先审查再安装 | "官方 UI 原封不动+宿主壳层"；**插件先审查再安装的供应链控制**（对应 vendored 审查与发行包 patch 层）；托盘常驻长任务=桌面侧"常驻 agent"最小形态 | MIT |

## 多 dsh 管理与多用户（2026-09-04 调研，对应 dsh-console 扩展 / 多用户需求）

> 背景：用户确认真实需求 = **多用户隔离实例**（团队多人共服务器、每人独立 DSH 实例）；
> 跨主机"自主协同"（agent 互相派活）判定为**现阶段伪需求/过早，搁置**（官方无概念、
> 社区无人做决策层协同）。以下为社区"多 dsh"全部相关项目与本层对照。

| 参考 | 定位 | 与本层对照 | License |
| --- | --- | --- | --- |
| [AnkoCD/dsh-server-deployment](https://github.com/AnkoCD/dsh-server-deployment)（25★） | 服务器多用户门户：登录 + 每用户**独立 OS 账号**（runuser 降权）+ 独立 DSH 实例(端口/DSH_HOME) + 独立 API Key + 交付文件抽屉 | **多用户隔离实例的最成熟参考**：OS 级隔离（0700 目录 + root 助手仅校验参数降权执行，修复 TOCTOU）；userctl 一条命令建号/改密/删号/预置 Key；网关对用户目录零权限；每用户实例自 3101 递增 | 未标注（自查） |
| [x102201/deepseek-harness-helper](https://github.com/x102201/deepseek-harness-helper) | 单机无限多开：每实例=独立一套 dsh、可拖拽分屏、.dshpack 环境打包 | 单机多开 launcher（桌面工具，非服务器场景）；.dshpack 打包分发思路可参考 | 未标注 |
| [dsh-plugins/dsh-launcher](https://github.com/dsh-plugins/dsh-launcher)（30★） | Tauri 桌面 launcher：多版本多实例并存，DSH_HOME 三模式（共享/默认/专属）、插件市场接入（stable/beta/alpha 三通道） | 多实例"DSH_HOME 专属"模式 + 三通道版本管理；桌面壳层（非服务器管理面） | 未标注 |
| [xswt442-cmd/dsh-instance-manager](https://github.com/xswt442-cmd/dsh-instance-manager) | DSH 常驻插件：侧边栏面板查看并管理**本机** dsh web 实例 | 本机实例管理 UI（不跨主机、不做档案/编排）；"实例列表+启停"交互参考 | 未标注 |
| [Chinesezjc/dsh-interconnect](https://github.com/Chinesezjc/dsh-interconnect)（35★） | 跨实例消息/事件通道：host 挂 HTTP/WS，暴露 `interconnect_send`/`interconnect_ping` 工具，多实例互通消息+探活（共享密钥 DSH_INTERCONNECT_TOKEN） | ≈ **dsh-channel 通信层**的社区版：只做"agent 间传消息"，**不做实例档案/生命周期/管理面**；密钥/投递语义可对照 | 未标注 |
| [Lanxi26/dsh-cluster](https://github.com/Lanxi26/dsh-cluster)（@lanxi266/dsh-cluster-plugin） | cluster mode：画布定义 agent 节点+有向边，`cluster_send`/`cluster_spawn` 编排多 agent 消息流（single/multi/any 寻址） | ≈ 我们**已搁置的协同层**（多 agent 编排）；印证协同是独立大课题，社区也在单点试探 | MIT |
| [lixiaoshuang79/dsh-helm](https://github.com/lixiaoshuang79/dsh-helm) | 多节点控制平面（hub+node-agent）：多机 dsh 出站 WS 注册 hub、HMAC 握手、五级路由、presence、fail-closed——**面向 ChatGPT↔DSH 连接器 MCP 转发** | 有"多机注册/心跳/路由"的控制面骨架，但目标是 MCP 工具路由（ChatGPT 入口），**不是管理 dsh 实例本身**；路由策略/心跳/审计可参考 | 未标注 |

### 关键判断：我们的插件是"分层体系"，不是社区插件的聚合

社区 124+ 插件是**无契约的散件**（每插件干一件事、单机/单面视角、彼此无共享模型）；我们的 6 插件是**有依赖纪律的分层**（user→channel→console 系统/管理组件，desk/tabs/quick-nav UI 层），共享一套概念模型（身份/主机/实例）。对照：

| 我们的能力 | 社区对应物 | 结论 |
| --- | --- | --- |
| dsh-user：**用户身份**（人登录+角色+跨实例授权） | AgentConnect/dsh-awiki、muretai（**agent 对 agent** 身份 ANP/邀请/加密） | 语义不同（人 vs agent）；官方无、社区无人做"人的多用户身份" |
| dsh-channel：跨实例**控制 RPC** | dsh-interconnect、dsh-bridge（agent **闲聊**消息） | 半覆盖（有消息通道，无控制面语义） |
| dsh-console：多实例**管理面**（档案/生命周期/部署/升级） | xswt442（本机）、AnkoCD（多用户）、dsh-remote-tunnel（端口编排） | **无人做一体化管理面**——差异化空白 |
| dsh-desk/tabs/quick-nav：UI 组装 | 社区大量 UI 插件（skin/标题/热键/侧栏…） | "像聚合"最明显的层——但我们是**平台/扩展点**而非功能堆叠 |

**一句话**：表象像聚合（社区单点各自存在），本质是带分层纪律的体系；系统/管理组件层
（user/channel/console）社区无人做完整，是应守的自研边界；UI 层若嫌维护重才考虑
"聚合社区更优"。



## SSH 远程工作区（2026-09-04 调研，对应用户「远程工作区/他机工作区」需求）

> 背景：用户问"社区的 ssh 远程工作区插件是否可用搞进来"。先分清**三条轴**：
> ① **远程访问面**（把本机 dsh web 暴露给外部设备访问——remote-web-ui）；
> ② **SSH 运维**（终端/SFTP/隧道——全家桶 dsh-ssh）；
> ③ **远程工作区/执行面**（把远端机器目录/会话作为 agent 可操作的工作区——本节的真正匹配项）。
> 全部经 GitHub/npm primary source 于 2026-09-04 核实。

| 参考 | 定位 | match 与差距 | License / 可引入性 |
| --- | --- | --- | --- |
| [flymysql/dsh-remote](https://github.com/flymysql/dsh-remote)（npm `dsh-remote` v0.8.12） | **远程工作区执行面**：SSH（密钥/密码）连远端 → 选远程工作区 → `rw_*` 工具操作 → SFTP 镜像成本地真实 DSH 工作区 | Model-A 形态最典型（远端目录=agent 可操作工作区）；SFTP 镜像到本地工作区的双向语义需实测；`engines` 未声明（cslht fork 曾为 rc.2 适配 → rc 兼容有门槛）；依赖 dsh-better-sidebar（我们已 vendored） | MIT · 55★ · 2026-09-03 活跃 · **引入候选（需 rc.1 实测）** |
| [DobyChao/dsh-workspace-enhancement](https://github.com/DobyChao/dsh-workspace-enhancement)（npm `dsh-workspace-enhancement`） | **本地+远程工作区一体**：`ctx.subprocess`+`ctx.fs` 透明远程 provider（单 SSH 链多跳），会话可挂多个 side workspace（各自 `fs: ro/rw`+`exec: on/off` 权限），`sw_exec` 跨服务器执行，TOFU 主机钥/系统钥匙串 | 最贴合"远程工作区进会话"的**架构**（provider 注入 → tools 零改动）；多工作区+权限模型可直接参照；npm 可装 | MIT · 0★（新）· 2026-08-31 · **引入候选（需 rc.1 实测 + 质量评估）** |
| [dsh-ssh/dsh-ssh](https://github.com/dsh-ssh/dsh-ssh)（GitHub-only） | SSH remote workspaces：在任意外部机器上跑 **bash/file/search** 工具 | 工具面最小集（只三种工具）= 远程执行面最小契约参考 | MIT · 8★ · 2026-08-27 · 无 npm（与 @linxin666/dsh-ssh 名冲突）→ 按 policy 例外不入 |
| [@linxin666/dsh-remote-web-ui](https://github.com/zhu1090093659/dsh-web-ui/tree/main/packages/dsh-remote-web-ui)（npm v0.3.13） | **远程访问面**：QR 扫码配对手机/PC，同一官方 Web GUI（手机竖屏触控适配层），一次性配对令牌+可吊销设备会话，LAN bind 开关 / 自带 cloudflared 隧道+固定域名 | **不是工作区**（暴露"本机实例"给外部设备）；peer 钉 alpha.2 cohort + cloudflared 下载/一键自升级/遥测 → 与 daemon/多实例/官方 fence 合拍风险高，不直接引入；**其 cookie-less 配对链（/pair-accept→/pair-app，插件自 serve 官方 shell 绕过 BrowserAuth 401）= "官方会话桥"的社区实现证据，作会话桥参考** | Apache-2.0 · rc.1 对齐 · 2026-09-03 活跃 |
| [@linxin666/dsh-ssh](https://github.com/zhu1090093659/dsh-web-ui/tree/main/packages/dsh-ssh)（npm v0.3.13） | **SSH 运维**：主机档案+连接池+Web 终端+SFTP+**127.0.0.1 端口转发**+集群执行+Agent 六工具 | 非远程工作区；其本地端口转发 = "SSH 转发他机 dsh 端口→本机浏览器开他机 UI"的手工轻量路径（两步，非工作区语义）；rc.1 对齐已在发行包依赖（曾入侧边栏后按用户要求移除入口） | Apache-2.0 · rc.1 对齐 · 2026-09-03 活跃 |

**判定一句话**：SSH 远程工作区社区**有真实现且 npm MIT 可装**（flymysql/dsh-remote、DobyChao/dsh-workspace-enhancement）——可"搞进来"，但属"实例内把远端机挂成工作区"的执行面插件，与我们 console/daemon 的**多实例管理面正交不冲突**；引入前需在 rc.1 隔离环境实测（host 面注入/ctx.fs/subprocess provider、bundle、与官方 fence），走 cordis.patch.yml 补丁层裁剪（cslht fork 曾为 rc 适配打补 = 门槛真实存在）。评估与实测清单见 [ssh-remote-workspace-survey](../.agents/notes/proposed/feature/2026-09-04-ssh-remote-workspace.md)。

## 对未定项的回应

| 未定项 | 社区答案 |
| --- | --- |
| **U2 版本锁格式** | dsh-plugin-pack-web 的 **Plugin Pack Schema v1**（{schemaVersion,id,name,version,plugins:[{id,name,kind,spec,repository}]}，spec 三种安装源）可直接参考扩为 dsh.lock.json |
| **U3 升级回滚** | dsh-update-checker 的**备份→更新→回滚闭环**（/rollback、lockfile 持久化防静默回退、watchdog 探活、写路由 loopback+confirm） |
| **U8 皮肤中心接入** | 皮肤中心 v2（皮肤=纯资产目录，团队分发=拷贝目录）+ dsh-skin-switcher（双引擎协调：单一管理权威+启动迁移）——~~直接作为 dsh-desk 皮肤自定义的接入方案~~（**否决** 2026-08：用户明确"不喜欢换肤，功能优先"，不引入皮肤中心；dsh-desk 自定义维度=布局+插件组合，见 architecture.md §9） |

## 重要更正

- **Anil-matcha/awesome-dsh-plugin 已失效（404）**，用 [awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)（10,772★）替代
- 社区 "dsh-auth/dsh-channel" 搜索命中大半是 **LLM provider 凭证域 / IM 消息渠道**，与我们的用户身份/跨实例通信语义不同（dsh-AuthInOne、ZinkLu/dsh-channel 等），勿误引
- [HuanLinOTO/dsh-plugin-ya-workspace-sidebar](https://github.com/HuanLinOTO/dsh-plugin-ya-workspace-sidebar) 为 **AGPL-3.0**——只可参考设计，不可 vendored 进发行包（license 红线）
