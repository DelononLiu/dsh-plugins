# Agent Note: dsh-desk——个人 AI 工作台发行包（开发工具层 + 开箱即用）

Status: proposed

## Problem

最终发布目标是**「个人 AI 工作台」发行包**：装好即是一个完整的个人 AI 工作环境，开箱即用。当前自研核心已具备（AI 对话 tabs / 快捷导航 / 管理 console+守护 / 布局 dsh-desk），**缺开发工具层**（侧边栏文件浏览、git、MD 预览、终端、SSH 等）与**发行包整合**。

## Decision

1. **命名**：产品/代码名 **`dsh-desk`**（个人 AI 工作台）。候选冲突：dsh-workbench / dsh-studio（npm+GitHub 已占）、dsh-mydesk（他平台名，避免混淆）。dsh-desk 承接原 dsh-my-ui 布局平台（my-ui 已改名 dsh-desk）。
2. **开发工具层 = dsh-web-ui 全家桶（@linxin666）按需子集**：
   - 装：`dsh-better-sidebar`（VSCode 式侧边栏：explorer/editor/terminal/git/browser，file viewer 扩展点）· `@linxin666/dsh-client-ui-git-graph`（git 分支图）· `@linxin666/dsh-ssh` · `@linxin666/dsh-client-ui-task-board` · `@mlgbnb/dsh-archive-manager` · `@linxin666/dsh-doctor` · `@linxin666/dsh-client-ui-plugin-manager` · `@linxin666/dsh-client-ui-skill-explorer` · `@linxin666/dsh-desktop-launcher` · `dsh-markdown-preview`（MD 会话内预览）；
   - **排除**：dsh-pet / skin-center / skins / remote-web-ui / liangshen / chat-recovery / describe-image 等（不需要或已否决）。
3. **引入方式（vendoring 双模式）**：submodule 锁 `zhu1090093659/dsh-web-ui` 源码（审查/补丁参考）+ **npm 按需装子集**（不装 `dsh-web-ui-all` 聚合——会带 pet/skin/remote）+ `dsh.lock.json` 锁版本，改造走 profile 层 patch。
4. **集成与摆位**：web profile 模板组合全部插件；dsh-desk 四区布局把开发工具摆到合适位置（侧边栏/内容区/顶栏）——**开箱即用**。
5. **发行包**：web profile = 「个人 AI 工作台」载体（bundles + dsh.lock.json 锁版本）。

## Alternatives

- **dsh-web-ui-all 聚合包**：一键装全部，但带 pet/skin/remote 等不需要 → 按需子集。
- **命名候选**：dsh-workbench / dsh-studio（已占）、dsh-mydesk（他平台混淆）→ dsh-desk。

## Consequences

- profile 模板扩展为工作台组合；vendored 落地（submodule + npm 子集）；
- MD 预览 = better-sidebar file viewer + dsh-markdown-preview；
- 与自研（tabs/quick-nav/console）组合后，web profile = 开箱即用的个人 AI 工作台；
- 后续：布局摆位细节、皮肤类剔除确认（不装皮肤则无关）、README 工作台使用说明。

交叉链接：[ui-official-alignment](../../implemented/process/2026-08-22-ui-official-alignment.md) · [layered-architecture](../../implemented/architecture/2026-08-21-layered-architecture.md)
