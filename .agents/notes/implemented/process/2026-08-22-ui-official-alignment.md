# Agent Note: UI 与官方组件对齐——照抄原则与调试纪律

Status: implemented

## Problem

dsh-console-ui 控制台按钮与侧栏官方「设置」按钮样式不一致，反复调整 8+ 轮才对齐。根因链：

- 按钮样式**手写近似值**（高度 32px、圆角 8 等靠猜），而官方设置按钮（`dsh-client-ui-settings-general .trigger`）是现成的标准答案——每猜一次错一次；
- 现象「hover 只盖文字区域」被误判为 hover 机制问题（React state / CSS :hover / inline 覆盖来回折腾），**真根因是按钮宽度没占满整行**：外层 `span` 是 `inline-flex`（宽度=内容），按钮 `width: calc(100% + 4px)` 相对它解析成文字宽——hover 一直触发，只是背景区域=按钮宽度；
- 开发环境无法启动浏览器（chromium 缺系统库），无实际渲染验证手段，连续盲改消耗大量验收轮次。

## Decision

**UI 默认和官方一致，抄官方（默认行为，不是不一致时的兜底）。** 三条纪律：

1. **默认照抄**：任何 UI 元素，官方对应组件（结构 + CSS 机制 + 属性值）是唯一基准——纯 CSS 类 + 模块顶层注入（bundle 加载即执行）+ `:hover` 与默认背景同表；**默认就直接抄，不先自建再对齐**，不手写近似、不绕道（inline style 无法表达 `:hover`，组件 `useEffect` 注入 CSS 时机不可靠）。
2. **根因分层**：现象描述先定位真根因在哪个层——触发（事件/伪类没发生）？尺寸（属性值错）？布局链（包裹层改变宽度解析，如 inline-flex span 使子元素 `width:100%` 解析成内容宽）？再动手。
3. **验证纪律**：环境无法亲眼渲染时，第一次出现"官方能行我们不行"就**逐字对比官方实现找差异**，或第一时间索要截图/精确现象；不连续盲改。

## Alternatives

- **手写近似样式**（inline style + 自造尺寸）：与官方总有差异，反复返工 → 否决。
- **hover 用 React state + inline background**：能触发，但按钮窄时只盖内容区；且绕开官方 CSS 机制 → 仅在注入 CSS 不可用的兜底场景使用。
- **组件 useEffect 注入 CSS**：依赖组件生命周期，时机/机制不如模块顶层注入可靠 → 否决。

## Consequences

- 后续 UI 插件开发照此执行；控制台按钮（dsh-console-ui）即范例：`span` 展开态 `display:flex; width:100%`（等效 `settingsArea` 全宽）+ 按钮纯 `className`（模块顶层注入样式表，`:hover` 同表覆盖）。
- 与官方组件不一致的排查顺序：先对比官方实现结构差异（DOM 包裹/容器宽度），再查属性值，最后才怀疑触发机制。
- 环境无浏览器验证时，先索要截图再改。

交叉链接：[console-ui-control-panel](../../implemented/architecture/2026-08-22-console-ui-control-panel.md) · [daemon-host-supervisor](../../implemented/architecture/2026-08-22-daemon-host-supervisor.md)
