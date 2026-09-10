# Agent Note: 会话胶囊标签——人工自定义标签的渲染与编辑

Status: implemented

## Problem

多会话并行时，侧栏与标签行的标题只说明了会话**叫什么**，说不清它**是什么**
（哪个在等重要回复、哪个是参考资料、哪个是待办的活）。用户要能给会话打人工
标签，并让它显示在会话标题旁。

会话关注层拆分（见 [focus-session-tabs-split](2026-09-06-focus-session-tabs-split.md)）
时已把数据面备好：host 面注册 `dsh-focus-tags` 命名空间。本 note 记录渲染与编辑。

## Decision

- **数据**：settings `dsh-focus-tags` 的 `tags` 字段，
  `{ [sessionId]: [{ text: string; tone?: string }] }`。由 `dsh-focus-session`
  拥有并写入（删除最后一个标签时清掉该会话键，不留空数组）。
- **渲染**：**行首**胶囊容器（`data-dsh-tag-list`，状态点之后、标题之前——`#功能 会话标题` 形态），
  在**置顶区行**与**活跃区行**都显示；可见文字带 `#` 前缀（`tagLabel`），存的数据不带
  ——输入 `#功能` 归一化为 `功能`，否则显示成 `##功能`；渲染幂等——内容相同零 DOM 写（两区都由 body 级
  MutationObserver 驱动 sync，多余写入会形成自触发循环，见
  [session-pin-status-sync-convergence](2026-09-06-session-pin-status-sync-convergence.md)）。
- **编辑入口**：行尾「#」按钮（hover/focus-within 显示，与取消钉 × 同显隐契约）
  → 弹出编辑面板：输入框回车添加、点当前标签移除、圆点选色调。面板**单例**
  （同时只开一个），点面板外或 Esc 关闭。
- **形状与配色一律取官方基准**（不自由发挥）：
  - 胶囊 = 官方小标签形态：`height:18px` / `border-radius:9px`（全圆）/
    `font-size:11px` / `padding:0 6px`，介于官方 `.seat`（16px 全圆）与
    `.label`（22px/12px）之间的会话行内尺寸。
  - 配色只用官方 token：底 `--dsw-alias-fill-tsp-secondary`、字
    `--dsw-alias-label-secondary`；色调只换字色
    （`--dsw-alias-state-{business,success,warn,error}-primary`）。
  - 面板：底 `--dsw-alias-bg-overlay`、边 `--dsw-alias-border-l2`、阴影用
    `color-mix` 调官方 `--dsw-alias-label-primary` 14%（不引入新色值）。
- **色调**：`neutral`（缺省）/ `blue` / `green` / `amber` / `red`；未知值归一化
  为 `neutral`（`normalizeTone`）。

## Alternatives

- **标签库 + 会话关联**（先定义标签再挂到会话，便于复用与统一改名）：多一层管理与
  UI；v1 直接存文字数组——同一标签在多个会话各输一次即可，语义更直白。
- **只显示、不做编辑 UI**（纯 settings 手改）：用户要的是 GUI 内可用的功能。
- **在官方侧栏会话行 / 顶部标签行也显示胶囊**：两者都是官方 React 渲染的 DOM，
  需按行注入并跟随重渲染；本 note 先覆盖自持的两个侧栏区，官方行注入留作后续
  （数据面已就绪，加渲染不涉及契约变更）。
- **用 `<select>`/对话框做色调选择**：自研 DOM 面板更轻，且形状参数已对齐官方 token。

## Consequences

- 标签按会话 id 存储，**会话删除后其标签键会残留**（无 GC）。残留项只占 settings
  体积，UI 不显示（行已不存在）；将来若需要，可在 sync 时按现存会话裁剪。
- 胶囊显示宽度上限 96px（超出省略号），长标签以 `title` 提供完整文本。
- 编辑面板用 `position:fixed` + 视口收敛定位（行下方，越界时上移）；窄窗口下宽度
  上限 260px。
- 顶部标签行的胶囊与官方侧栏行的胶囊仍是后续项；`dsh-focus-tabs` 若要显示，需读
  同一份 `dsh-focus-tags`（跨包只读，无新契约）。
