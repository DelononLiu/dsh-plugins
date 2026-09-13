# Agent Note: plan-show 消息内就地渲染——只认 AI 侧代码块形状

Status: implemented

## Problem

dsh-plan-show 的主路径是"AI 按约定围栏输出产物 → 客户端把围栏就地渲染成图片"。首版靠**猜官方 DOM 钩子**：
代码块根取 `.md-code-block`，语言名取 `.md-code-block .infostring`，流式判定取祖先 `data-streaming`。

真机（web2 / 3082）一验就露两处：

1. **语言名读不到 → 一条都不渲染。** 官方 `CodeBlock` 的语言名元素是 css-modules 类
   `In.infostring`，编译产物是哈希类名 `_infostring_5swpp_44`（`md-code-block` 才是官方显式挂的稳定类）。
   `.infostring` 选择器永不命中 → `languageOf()` 恒为空串 → 约定围栏被当成普通代码块原样显示。
   测试却在绿：现场是手写的 `.infostring` 假 DOM，与真产物不同形。
2. **用户消息里的围栏永远不成型。** 官方对**用户消息**走 `MessageText`（引用 chip + 纯文本，`_plainRun_` 里空白被
   `replace(/\s+/g,' ')` 折叠），只有 **AI 输出**走 `MarkdownText` → `CodeBlock`。因此"贴一段 ```plan-show 进去看图"
   不可能成立——围栏只在 AI 输出里成为代码块。

## Decision

- **钩子按官方真实形状取，不按好听的语义取**：代码块根仍用稳定类 `.md-code-block`；语言名元素无稳定类，
  按类名子串匹配（`[class*="infostring"]`）——哈希值 `5swpp` 随构建变，子串不受影响。
- **测试现场必须照抄官方产物**（含哈希类名、`bannerWrap/banner/action/copyButton` 结构），不再手写"结构相近"的假 DOM。
- **作用域只认 AI 输出**：不做用户消息侧的 markdown 渲染（那是官方 `MessageText` 的设计，不是本插件该改的）；
  想要图，让 AI 重新输出一份围栏。
- 契约（官方 `CodeBlock`）：根 `div.md-code-block` ＞ `bannerWrap` ＞ `banner` ＞ 语言名元素 + 操作区；正文在 `pre code`。

## Alternatives

- **按哈希类名精确匹配（`.infostring_5swpp_44`）**：下次内核构建哈希即变，脆。
- **要求官方给语言名元素挂稳定类（提 issue）**：正解但不在本项目控制内；子串匹配已足够稳（该元素只此一处）。
- **自己解析消息文本、不依赖 DOM**：要拿到"这条消息定型了没"，等于重写官方的流式与消息模型；DOM 观察是成本最低的接入点。
- **给用户消息也加 markdown 渲染**：越过官方 `MessageText` 的既定语义，属 UI 层替换而非增强——本插件定位是增强，不做。

## Consequences

- 真机自验（web2 / 3082）需用**AI 输出**的围栏验证：本插件在自己的回复里放围栏即可看到图；贴用户消息验证会误判成"插件没生效"。
- 语言名靠类名子串匹配 = 依赖官方保留 `infostring` 这个名字；内核升级时这条要跟着核（`dsh-kernel-upgrade` 的核对项）。
- 现场照抄官方产物的做法推广到其它 DOM 钩子类改动：凡是"快照官方 DOM 结构"的测试，fixture 必须来自实产，不能凭语义猜类名。
- 相关：[场景与分期 note](../../proposed/feature/2026-09-13-dsh-plan-show-scenarios-and-directions.md)（D7 删除侧栏入口与面板）
