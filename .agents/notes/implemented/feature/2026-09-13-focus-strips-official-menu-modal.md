# Agent Note: 关注区菜单/弹框对齐官方 Menu 与 Modal 契约

Status: implemented

## Problem

用户实测报缺陷：置顶区与活跃区的**行菜单**和**标签弹框**与官方 session 行的
菜单/弹框设计不一致（位置、配色、大小）。查证确认两侧都是**手写近似**：

| 维度 | 修正前（本包，对齐前） | 官方基准（menu 行 = 2026-10-04 复检 kernel 0.1.7-rc.2；modal 行 = 0.1.2-rc.1） |
| --- | --- | --- |
| 菜单卡片圆角 | 12px（注释自认"官方规则未声明，取协调值"） | `MenuSurface.module.css`：`--dsw-radius-lg` = **16px** |
| 菜单最小/最大宽 | 180 / 320px | **144 / 360px** |
| 菜单最大高 | `min(360px, 100vh - 96px)`，卡片自身滚动 | **`calc(100vh - 12px - max(12px, var(--dsh-frame-top-clearance, 12px)))`**，内层 `.viewport` 滚动 |
| 菜单层级 | `z-index: 2147483000` | **1100**（`.portal`，需盖过模态 1000） |
| 菜单底色 | 自造 | **表面材质层**（`MenuSurface.module.css .material`，`z-index:-1`）：`background:var(--dsw-menu-surface-fill)`（浅 `#f8f9fa94` / 深 `#43454a73`）+ `backdrop-filter:var(--dsw-menu-backdrop-filter)`（`blur(40px) saturate(150%)`）；卡片自身不着色 |
| 菜单定位 | 开时一次算完，**不跟随**滚动/缩放；clamp margin 8 | portal 由**触发按钮**矩形算位（官方 anchor 即按钮，Menu 包装 span 收缩到按钮）、**跟随** `scroll`(capture)/`resize`；`MARGIN=12`，上边距经 `overlayTopMargin` 用 `--dsh-frame-top-clearance` 放宽 |
| 指针离开 | 不关（只点外/Esc） | session 行用 **`closeOnPointerLeave`** + `POINTER_GRACE_MS=200` |
| 菜单项 | `height:40px; padding:0 10px`；无图标槽/省略号/危险态钩子 | `.item`：**`min-height:34px`、`padding:6px 8px`、`gap:6px`、`13px/20px`、`border-radius:var(--dsw-radius-md)`** + `.itemIcon` **14×14**（`--dsw-alias-menu-icon`）+ `.itemLabel` 省略号 + `:disabled`/`:focus-visible`/`.danger`（danger hover `--dsw-alias-interactive-bg-hover-danger`） |
| 标签弹框 | 贴行气泡：`min 200/max 260`、r8、`bg-overlay`、自造阴影、无遮罩 | `Modal.module.css`：**居中模态**——全屏层 z1000 + 遮罩（`--dsw-alias-bg-mask-1` + `--dsw-mask-blur`）+ 卡片 r24 / `bg-layer-2` / `elevation-prominent` / `width:min(380px,100%)` / gap 20 / 标题行 `22px 14px 12px 24px` + 关闭钮 28×28 r8 / body 与 footer `0 24px` |

## Decision

照官方实现逐条对齐（官方组件实现即样式契约），不引官方 React 组件——两个区是
**DOM 注入**路径，没有 React 渲染树可挂官方 `Menu`/`Modal`，因此照抄 DOM 结构、
CSS 机制与属性值：

- **菜单**（`src/client/menu.ts`）：卡片/视口/菜单项/触发按钮四组值全部照官方
  `Menu.module.css` + `MenuSurface.module.css` + 会话行 `.iconButton`；定位照官方
  `Menu` 的 `place()`（`align:'start'` 取**触发按钮**矩形左边、`side:'bottom'` 取
  `rect.bottom + 4`、`MARGIN=12` clamp、上边距经 `overlayTopMargin`、开着期间跟随
  滚动与缩放）；关闭语义补官方 session 行用法（pointerdown 点外、Esc、选中、指针离开
  200ms 宽限）；菜单打开期间锚点行打 `data-dsh-row-menu-open`（对应官方
  `.sessionRow.menuOpen` 保持 hover 底）。
  （2026-10-04 复检 0.1.7-rc.2：卡片底色改官方 `MenuSurface` 的 `.material` 层——
  `--dsw-menu-surface-fill` + `backdrop-filter:var(--dsw-menu-backdrop-filter)`，卡片
  自身不着色；圆角 / 最小宽 / 最大高 / 菜单项度量按 0.1.7 值更新；定位锚点从「整行」
  改为「触发按钮」——官方 anchor 就是按钮，此前锚整行导致菜单落在行左端。）
- **标签弹框**（`src/client/tags.ts`）：改为官方 Modal 结构（遮罩 + 居中卡片 +
  标题行/正文/底部操作行），内部胶囊/输入框/按钮分别用官方 **Pill**（h24/pad 0 8px/
  r12/12-18）、**Input**（h32/pad 0 8px/0.5px `border-l4`/r8/`bg-layer-1`）、
  **Button**（h36/pad 0 14px/r18；outline 0.5px `border-l3`、primary
  `button-primary-fill`）的几何与 token。交互随之改为官方 Modal 语义：遮罩点击 /
  Esc / 取消 / 完成 都关闭；标签仍在回车时即时写入，`anchor` 参数随之删除。
- **token 取证**：用到的 `--dsw-elevation-prominent` / `--dsw-mask-blur` /
  `--dsw-alias-label-primary-foreground` / `--dsw-alias-border-l3|l4` 已逐个在官方
  主题（`ui-theme/src/styles/`）确认存在——写错 token 只会静默无色。

## Alternatives

- **只换 token、保留气泡与既有几何**：否决——用户明确要求"位置配色大小"一致，
  居中模态 vs 贴行气泡是不可调和的形态差异。
- **改用官方 React `Menu`/`Modal`**：否决——两个区经 DOM 注入挂进侧栏，无 React
  渲染路径；`Menu` 的 `closeOnPointerLeave` 与点外判定绑在**含触发按钮的包装 span**
  上，宿主自有按钮上无法照官方行用法保留（要保留得把两个区的行构造改成 React），且
  官方 `lib/index.js` 在 vitest 里加载失败（只走 `tests/stubs/ui-primitives.tsx` 替身）。
- **只修菜单、弹框留待后议**：否决——两者同属用户报的同一个一致性缺陷。

## Consequences

- 两个区的菜单/弹框在圆角、宽度、层级、间距、配色、定位与关闭语义上与官方 session 行一致。
- 弹框从"贴行气泡"变为"居中模态"：会遮挡页面内容（换来与官方一致的形态），
  标签写入时机不变（回车即写）。
- 层级从 `2147483000` 回落到官方层级（菜单 1100 / 弹框 1000）：菜单仍能盖住模态，
  但不再无条件盖过一切页面浮层。
- 官方契约以注释形式记在 `menu.ts`/`tags.ts` 头部（含文件路径与值），后续升级内核
  时按同一处核对。
- （2026-10-04）用户实测两处缺陷已修：行菜单**落在触发按钮处**（此前锚整行，菜单落在
  行左端，与官方不一致），且**底色与背景模糊取官方 `MenuSurface` 材质层**（此前裸用旧
  `--dsw-specific-menu` 且无 `backdrop-filter`，半透明底未模糊，观感不对）。

## 测试

- `tests/menu.spec.ts` 共 15 项：官方卡片/项度量断言、卡片内含 `.viewport` 且项挂视口内、
  卡片材质层用官方同 token（`--dsw-menu-surface-fill` + `backdrop-filter`）、
  `place()` 定位算术（无按钮回落整行 / 有按钮锚按钮）、开着时跟随滚动重定位、
  行打开标记的置位与清理、danger/disabled 语义、指针宽限关闭（进入取消 / 离开 200ms 关闭）。
- `tests/tags.spec.ts` 改 6 项：Modal 结构（遮罩/卡片/标题行 h2/关闭钮/正文/底部双按钮）、
  官方 Modal/Input/Button 度量断言、遮罩·Esc·完成三种关闭路径、回车加标签、点标签移除、
  单例打开且 Esc 监听不残留。
- 包内共 130 测试通过（`pnpm --filter dsh-focus-session test`），typecheck/build 通过。

相关：[session-row-menu](2026-09-06-session-row-menu.md)（其记录的手挑度量已在本提交更正）
· [session-tag-pills](2026-09-06-session-tag-pills.md) · [focus-session-tabs-split](2026-09-06-focus-session-tabs-split.md)
· [ui-official-alignment](../process/2026-08-22-ui-official-alignment.md)
