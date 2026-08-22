# 调研：UI 全家桶与皮肤层 · 社区可参考插件/设计

> 调研日期：2026-08-21。面向【UI 全家桶与皮肤】层（对应组件：vendored dsh-web-ui → dsh-my-ui 布局/组合自定义）。**注：调研后（同日）皮肤中心已否决**——皮肤相关条目仅作调研快照，不构成采用决定。
> 数据源：GitHub API / raw.githubusercontent / npm registry 元数据（均为第一手核实，2026-08-21 时点）+ awesome-dsh-hub 机器可读 registry（2017 插件）。
> 结论先行：**核心参考 = dsh-web-ui 全家桶（已知，已核实）+ 皮肤中心 v2 纯资产机制 + better-sidebar 服务化布局框架 + dsh-skin-switcher 双引擎协调 + dsh-plugin-pack-web 发行包清单格式**。

---

## 1. zhu1090093659/dsh-web-ui 完整包清单（已逐包核实）

**仓库**：https://github.com/zhu1090093659/dsh-web-ui — Apache-2.0，5216★ / 320 forks，pushed 2026-08-21，默认分支 `dev`，npm 发布 scope `@linxin666`（全部 0.2.6，2026-08-21 发布）。
**结构**：`packages/` 下 16 个插件包 + `packages/skins/`（皮肤中心 v2 + 皮肤资产，即用户说的第 17 项）+ `scripts/plugin-template`（新插件模板）。

| # | 目录 | npm 名 | license | 能力（一句话） |
|---|---|---|---|---|
| 1 | dsh-liangshen | @linxin666/dsh-liangshen | Apache-2.0 | 梁神模式：V4 Pro 两阶段锚定 agent 预设（Minimal 开局→PTC 全量） |
| 2 | dsh-task-board | @linxin666/dsh-client-ui-task-board | Apache-2.0 | Host 权威任务看板：多列 + cron 定时真实执行 + 空闲睡眠保护 |
| 3 | dsh-git-graph | @linxin666/dsh-client-ui-git-graph | Apache-2.0 | 空会话分支选择器 + Git 图谱（分支泳道/提交历史） |
| 4 | dsh-aionui-panel | @linxin666/dsh-client-ui-aionui-panel | Apache-2.0 | 右侧面板（AionUi 复刻）；**已退役**，默认关闭，被 better-sidebar 取代 |
| 5 | dsh-remote-web-ui | @linxin666/dsh-remote-web-ui | Apache-2.0 | 扫码配对移动端/PC 远程控制，SSE 同步，配对令牌门控 /remote/api |
| 6 | dsh-ssh | @linxin666/dsh-ssh | Apache-2.0 | SSH 运维：终端/SFTP/端口转发/集群执行/Agent 直连，~/.dsh/dsh-ssh.json |
| 7 | dsh-tool-describe-image | @linxin666/dsh-tool-describe-image | Apache-2.0 | describe_image 工具：纯文本模型借 OpenAI 兼容视觉端点看图 |
| 8 | dsh-pet | @linxin666/dsh-pet | Apache-2.0 | 多宠物陪伴插件：注册表驱动浮动宠物 + 互动/亲密度 |
| 9 | dsh-skins | @linxin666/dsh-skins | Apache-2.0 | **已退役兼容载具**：皮肤资产已并入 skin-center，仅依赖引渡升级用户 |
| 10 | dsh-web-ui-settings | @linxin666/dsh-client-ui-web-ui-settings | Apache-2.0 | 设置页一级 section：全家桶各插件的启用开关与配置表单 |
| 11 | dsh-web-ui-all | @linxin666/dsh-web-ui-all | Apache-2.0 | **聚合包**：依赖拉入 16 个家族包 + 外部 dsh-better-sidebar（见 §4） |
| 12 | dsh-chat-recovery | @linxin666/dsh-chat-recovery | BSD-3-Clause | fork 式改末条消息 + 监督式重试（保留原始历史） |
| 13 | dsh-community-plugins | @linxin666/dsh-client-ui-community-plugins | BSD-3-Clause | 设置页社区插件索引卡：列社区插件并链到各自仓库 |
| 14 | dsh-desktop-launcher | @linxin666/dsh-desktop-launcher | Apache-2.0 | 桌面启动器 + 一键关机（双击图标起 web GUI） |
| 15 | dsh-plugin-manager | @linxin666/dsh-client-ui-plugin-manager | BSD-3-Clause | 设置页插件管理 tab：经官方 host 通道从 npm/git 安装、列出已装 |
| 16 | dsh-skill-explorer | @linxin666/dsh-client-ui-skill-explorer | BSD-3-Clause | Skill 中心：按来源浏览/启停/增删 skill |
| 17 | skins/skin-center | @linxin666/dsh-client-ui-skin-center | Apache-2.0 | **皮肤中心 v2**（唯一皮肤加载器，见 §2）；另发布 11 款热插拔皮肤包 @linxin666/dsh-client-ui-skin-{minecraft,dragon-heir,xp,blue-fantasy,whale-song,trading,miku,harbor,matrix,whale-mom,maid-atelier}（0.2.0，Apache-2.0） |

**License 陷阱**：仓库与多数包 Apache-2.0；dsh-chat-recovery / dsh-community-plugins / dsh-plugin-manager / dsh-skill-explorer 为 BSD-3-Clause；**Maid Atelier 皮肤单独 CC BY-NC-SA 4.0（仅限非商业）**——团队发行包若商用需剔除或替换该皮肤。

## 2. 皮肤中心 v2（最直接的皮肤自定义设计参考）

`@linxin666/dsh-client-ui-skin-center`（cordis id `ui-skin-center`）是唯一皮肤加载器，核心契约：
- **皮肤 = 纯资产目录**：无 package.json、无 npm 发布、无 cordis 接线，只耦合 skin-center 契约。
- **目录格式 v2**：`skin.json`（fail-closed 校验，v1 字段忽略并告警）+ `skin.css`（L1 token 重映射 + L2 语义选择器）+ 可选 `patches.css`（L3 自由选择器，高敏）+ 可选 `hooks.mjs`（受信逃生舱）。
- **目录来源合并**：包内 `skins/<id>/` 内建 + `$DSH_HOME/skins/<id>/` 用户皮肤（同 id 用户版覆盖内建）；校验失败 fail-closed 排除并报 catalog 诊断。
- **试穿/应用**：同一原子切换引擎（skin-controller）：一次性拉样式表 + 背景媒体 + 可选 hooks，翻 `html[data-dsh-skin="<id>"]`，append-only 效应账本幂等拆解；latest-wins，失败/被取代完全回滚。**无刷新、无 cordis.patch.yml 重写**；应用持久化走 `POST /api/skin-center/v2/active`。
- **首屏无闪烁**：host 侧 index.html transform（webServer.tapIndex）盖章 `html[data-dsh-skin]` 并插样式链接，fail-closed 回退默认外观。
- 另有 Wallpaper Engine 壁纸库导入、12 款内建皮肤、皮肤包同 id 阴影规则。

## 3. 推荐短名单（6 项，均经核实）

### 3.1 zhu1090093659/dsh-web-ui —— 全家桶来源（已知项，核实+补新）
- url: https://github.com/zhu1090093659/dsh-web-ui | Apache-2.0（部分 BSD-3-Clause；1 皮肤 CC BY-NC-SA）
- match: 我们 vendored 的 UI 全家桶来源（dsh-my-ui 布局/组合/皮肤）
- takeaway: ①16 插件 + skins 聚合层 + scripts/plugin-template 的"每样独立成包、可插拔、聚合包一键装齐"组织法；②所有包走官方 profile 机制、不改 DSH 源码、改造走 `dsh.bundle.patch`（= 我们的 cordis.patch.yml 补丁层）；③**聚合包把外部插件（dsh-better-sidebar）拼进全家桶**的先例；④皮肤与插件职责分离（插件管逻辑、皮肤管外观）。

### 3.2 omdsh-dev/DSH-better-sidebar —— 服务化侧边栏/布局框架（新增）
- url: https://github.com/omdsh-dev/DSH-better-sidebar | MIT，974★（awesome-dsh-hub Web UI 增强 Top4，活跃：v0.14.1 适配 DSH 0.1.0-rc.8）
- desc: 右侧栏 + 底部面板双工作台（文件/编辑器/内嵌浏览器/真实终端/Git 面板/后台任务），服务优先：`ctx.betterSidebar.registerTab/registerFileViewer` 与内置 tab/viewer 能力对等。
- match: dsh-my-ui 的布局/组合能力 + "UI 可替换"边界；dsh-web-ui-all 已集成它为右侧面板。
- takeaway: ①布局/Tab/面板**按会话持久化**、陈旧状态自动净化（多会话多实例隔离的直接参考）；②~325KB 核心 + 重依赖按需加载；③拖 Tab 拆分/合并、移动端自动合并全宽抽屉；④外部插件经同一服务 API 注册——我们 UI 层的第三方扩展点可照此设计；⑤dsh-web-ui-all 拼外部插件的依赖集成模式。

### 3.3 @linxin666/dsh-client-ui-skin-center —— 皮肤中心 v2（新增，核心）
- url: https://www.npmjs.com/package/@linxin666/dsh-client-ui-skin-center | Apache-2.0
- desc: 唯一皮肤加载器；皮肤 = 纯资产目录（skin.json + skin.css L1/L2 + patches.css L3 + hooks.mjs），内建 + $DSH_HOME/skins 用户目录，fail-closed 校验，原子切换 + 首屏盖章。
- match: dsh-my-ui 皮肤自定义（调研快照；**后续否决：皮肤中心不引入，功能优先**）
- takeaway: ①皮肤与官方彻底解耦、只与皮肤中心耦合——官方升级不牵动皮肤，新增皮肤只需落目录、免发布免安装（团队分发皮肤 = 拷贝目录/发皮肤包）；②fail-closed 校验 + 原子切换账本 = 换肤安全；③首屏盖章避免 FOUC；④刻意不走 cordis.patch.yml 重写（对比 3.4 的 legacy 路线）。

### 3.4 zhtx2024/dsh-skin-switcher —— 多皮肤引擎统一管理（新增）
- url: https://github.com/zhtx2024/dsh-skin-switcher（npm `dsh-skin-switcher` 0.4.0）| BSD-3-Clause
- desc: 设置页「皮肤」页一键切换；自动发现 profile 中所有 `dsh-client-ui-skin-*`（任意 npm scope）+ dsh-web-ui dsh-skins 载体 + v2 资产引擎目录；legacy 皮肤切换写 `~/.dsh/cordis.patch.yml` managed section（原子重写，配置监视器数秒热重载），v2 皮肤写 `~/.dsh/skin-center-active.json`；启动时把 legacy 活跃皮肤迁移到 v2 激活文件，并禁用旧版写 patch 的竞争者中心。
- match: 我们发行包的 cordis.patch.yml 补丁层 + 皮肤机制接入决策（未定项 #8 的协调方案）
- takeaway: ①两代皮肤引擎（patch 写 vs 资产引擎）共存时的**单一管理权威 + 启动迁移**策略；②managed section 原子重写 + 热重载 = 免重启换肤；③跨 npm scope 的皮肤发现规则（`dsh-client-ui-skin-*` 命名约定）→ 我们皮肤包命名可对齐。

### 3.5 baihejiangnan/dsh-plugin-pack-web —— 发行包/版本锁格式（新增）
- url: https://github.com/baihejiangnan/dsh-plugin-pack-web | MIT（清单 `dsh-plugin-pack.json` 亦 MIT）
- desc: 30 项 profile/web 插件"一键复刻"发行包：`dsh-plugin-pack.json`（DSH Plugin Pack Schema v1）+ 安装命令 + PROMPT.md 复刻提示词 + 环境备份 JSON。
- match: 我们的发行包 profile 模板 + dsh.lock.json 版本锁（Plugin Pack Schema v1 的现成 schema 参考；schema 已定稿采用其字段结构）。
- takeaway: ①清单 schema：`{schemaVersion, id, name, version, description, license, plugins:[{id,name,kind,spec,repository}]}`——`spec` 支持 `github:owner/repo`、npm 包名、tar.gz URL 三种安装源；②"复刻提示词 + 备份 JSON"的克隆即用哲学（= 我们 profiles/ git clone 即用）；③README 中 `dshpm install` 与安装保护门禁的处理。

### 3.6 RevolutionLA/dsh-dream-skin —— 皮肤包分发/共享（新增）
- url: https://github.com/RevolutionLA/dsh-dream-skin（npm `dsh-dream-skin` 0.4.1，2026-08-19）| MIT
- desc: 8 套 iOS/Linear 式主题 + 弥散光壁纸 + 每皮肤智能背景 + 每用户强调色 + **主题包导入导出/分享链接** + 收藏/随机。
- match: 皮肤定制 + 多用户/多实例下皮肤包的制作与分发
- takeaway: ①主题包导入导出 + 分享链接 = 团队内分发皮肤/主题的现成 UX；②每用户强调色（personal 哲学同构）；③壁纸/背景走"资产 + 智能派生"而非贴图——与 skin-center 纯资产思路互补。

## 4. 聚合包 dsh-web-ui-all 的集成模式（核实）

npm `@linxin666/dsh-web-ui-all@0.2.6` dependencies = 16 家族包 + **`dsh-better-sidebar`（外部）** + `@linxin666/dsh-client-ui-skin-center`。即：meta 包通过 dependencies 拉入全部插件，用户 `dsh plugin add dsh-web-ui-all` 一键获得全家桶——与我们 AGENTS.md"UI 层内部允许聚合依赖（meta 包）"一致；且它证明了**在 meta 包里拼外部框架插件**的可行路径。

## 5. 其余值得留档的生态发现（不列短名单）

- 皮肤/主题阵营（awesome-dsh-hub 收录 62 个"皮肤与娱乐"类）：`dsh-skin`（wei-806206088，MIT，CSS 变量 `--dsw-*` 驱动 + 5 图槽换肤 + 命名预设，`~/.dsh/dsh-skin-state.json` 持久化）；`KinGao294/dsh-skin`（MIT，`--dsw-alias-*` 调色板）；`suzike/freestyle-dsh-theme`（BSD-3-Clause，OKLCH 主题设计器跨重启持久化）；Catppuccin 系（NoNameLeGo/dsh-catppuccin、zhijun-dai/Catppuccin-dsh-theme）；`dsh-skin-manager`（xiaoyangcheng84-svg，MIT，skin.json 皮肤发现——与 skin-center 契约同构，说明 skin.json 是生态事实标准）；`dsh-skin-studio`（**AGPL-3.0，避开**）。
- 布局类：`vlln/dsh-navbar`（MIT，会话节点导航条 → 我们 dsh-quick-nav 参考）；`dsh-client-ui-mobile`（gihungdang，MIT，窄屏 CSS + 浮动导航）；`mexiaosqwq/dsh-web-mobile`（MIT，窄屏侧栏变 overlay 抽屉）；`HuanLinOTO/dsh-plugin-ya-workspace-sidebar`（工作区侧栏替代）。
- 发行/管理类：`@dsh-suite/plugin-manager`（whyihaveyou/dsh-suite，MIT，插件应用商店：目录浏览/一键安装/兼容徽章）；`lire1131/dsh-undo-plugin`（MIT，插件/皮肤/设置快照回滚 → 升级回滚策略参考）；`dsh-gateway`（clarknu，MIT，HTTPS+登录网关，多实例远程访问）。
- **双引擎格局**：皮肤中心 v2 资产引擎（免 cordis 重写）vs legacy patch 写入（cordis.patch.yml managed section）——dsh-skin-switcher 明确协调两者；我们接入时二选一并预留迁移（对应未定项 #8）。

## 6. 数据来源

- GitHub API（repo 元数据，2026-08-21 时点）与 raw.githubusercontent.com（各 package.json、README）
- npm registry：`/-/v1/search`、`registry.npmjs.org/<pkg>`（license/version/repo/发布时间）
- ukinch605/awesome-dsh-hub `registry/plugins.json`（2017 条，MIT）
- dsh-web-ui README（dev 分支）与 @linxin666/dsh-client-ui-skin-center npm README（skin.json v2 规格）
