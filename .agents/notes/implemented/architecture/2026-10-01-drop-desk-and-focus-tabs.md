# Agent Note: 删 dsh-desk / dsh-focus-tabs，dsh-quick-nav 保留但不加载

Status: implemented

## Problem

UI 层有三个自研插件在 2026-09-26 移除 vendored 全家桶 UI 后失去了存在理由，但一直没清：

| 插件 | 现场（2026-10 实测） |
| --- | --- |
| `dsh-desk` | 106 行；导出的布局服务 `ctx.myUi` **零调用方**（全仓 grep 只命中它自己）；「布局」设置页 2026-09-06 已删；**没有任何 profile 配过 `layout` 值**（只有裸 `- id: dsh-desk` insert）；两个读者（quick-nav/focus-tabs）直接按 entry id 读 Config 且都 `?? true` 兜底 |
| `dsh-focus-tabs` | 666 行；与 `dsh-focus-session` 同一份钉住数据的**第二个视图**；其中 ~600 行只服务于标签行本身（注册 `conversation.view`、点击委托、拦官方 tab、划线态机、占位视图、view 偏好残留清理）；§9 还挂着一个"只装 focus-tabs 时标签行静默为空"的部署依赖缺陷 |
| `dsh-quick-nav` | 350 行；顶栏实例下拉。与**自家 console 面板**重叠——面板每行已有「跳转⧉」；生产（3080）从未加载它 |

官方基线侧（证据取自 `origin/master` = 0.1.7-rc.2）：**没有会话标签行**（会话浏览只有侧栏 `sidebar.workspaces`，唯一的 `role="tablist"` 是单会话内的 View 标签）、**没有多实例导航**（单 Host，`connection/src/operator-peer.ts:2`）、**没有用户/角色模型**（只有浏览器会话鉴权 + 匿名安装 id），布局只到"拖拽宽度/折叠 + 右侧栏 docking"，**没有区域显隐/顺序配置**。也就是说：这几个插件都不是在重复官方，而是在填官方空白——删它们不是清理重复，是**主动放弃能力**。

## Decision

- **删 `dsh-desk` 整包**：布局配置服务无调用方、配置无人填、设置页已不存在，是一项**不可达的能力**。消费者里那两处 `configForms.get('dsh-desk')` 一并删掉（本来就 `?? true`，行为不变）；`tsconfig.host.json`、模板三件套、console 的实例骨架默认 bundles 同步。
- **删 `dsh-focus-tabs` 整包，不做快捷键迁移**：钉住/标签数据本就归 `dsh-focus-session`，其侧栏置顶区（行菜单 + 拖拽排序 + 取消钉）是钉住的唯一管理面；`Alt+P`/`Alt+1..9` 随包一并消失（用户拍板：不要快捷键，要标签行的话成本大于收益）。**代价明确：官方没有会话标签行，删掉就没有了。**
- **`dsh-quick-nav` 保留源码，但从所有 profile 摘掉**（模板 master/dev/explorer + 实例 web2）：包与单测留在仓库、随时可装回；实例跳转收敛到 console 面板唯一入口。
- **`dsh-user` 保留**（身份模型是真的、官方是空白，等认证网关 backlog 落地时还要用）。

## Alternatives

- **`dsh-desk` 降级为"只声明一份 layout 配置 schema"**：能保住"区域显隐/顺序"这个官方没有的自定义面。否决理由：没有任何 profile 填过它、没有设置页可改，保住的是一个连自己都不用的开关。
- **把标签行 UI 并进 dsh-focus-session（真合并）**：能保住标签行。否决理由：那 ~600 行全部围绕官方 tab DOM 的注入/拦截/划线，并进 focus-session 会把一个干净的数据层与一套脆的 DOM 战役绑死；用户明确要删。
- **只把 `Alt+P`/`Alt+1..9` 迁进 focus-session**：~35 行即可保住键盘钉住。用户否决（不要快捷键）。
- **删 quick-nav**：与 console 面板重叠，但保留成本只有"一个不加载的包"，且它是 typert `@Remote` 面唯一的客户端消费者先例。选择保留、不加载。

## Consequences

- **能力代价说清楚**：从此没有会话标签行、没有布局区域配置、没有顶栏实例导航（实例跳转只在 console 面板）。这些能力官方都不提供，属于主动收敛——要回来得重新实现。
- **quick-nav 不再有运行时验证**：只靠单测（4 项）保真；代码腐化风险由"保留但不加载"这个决定带来，装机前需自验。
- 同步更新：`profiles/{master,dev,explorer}`（bundles + patch insert + lock）、`scripts/tests/profiles-templates.test.mjs` 的启用清单、`tsconfig.host.json`、`docs/architecture.md` §1/§2/§5/§9、`AGENTS.md` 分层图与依赖链、`packages/dsh-console` 的实例骨架默认 bundles 与两处测试夹具（原用已删包名当占位）。
- 引用已删插件的 implemented note 按归档规则处理：完全被取代的移入 `archived/`，部分取代的更新事实并交叉链接本 note。
- **已落地（2026-10-01）**：`dsh-channel` 合并进 `dsh-console`（分层改动：系统层 → 管理组件，不是删包），见 [merge-channel-into-console](2026-10-01-merge-channel-into-console.md)。
