# vendored/ —— 社区插件（submodule 锁定）

| 插件 | 来源 | 模式 | 状态 |
| --- | --- | --- | --- |
| dst-agent-teams | [NanmiCoder/dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams) | 轻量单包 submodule（--depth 1），本地安装，dst- 前缀 | ✅ 已落地（v0.1.10） |
| dsh-memento | [PerryLink/dsh-memento](https://github.com/PerryLink/dsh-memento) | 轻量 submodule（--depth 1），npm 安装，保留原名 | ✅ 已落地（v0.4.3） |
| dsh-web-ui | [zhu1090093659/dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui) | 重型全家桶：npm 安装（@linxin666）+ lock 锁版本；源码快照待补 | ⏳ 源码 submodule 待网络稳定时补 |

- 双模式见 AGENTS.md「Vendoring policy」：轻量单包 submodule 本地安装；全家桶 npm 安装 + lock 锁版本 + patch 层改造。
- submodule 用 `--depth 1`（浅克隆，GitHub 大仓库全量 clone 易断连）。
- License：dst-agent-teams MIT · dsh-memento MIT · dsh-web-ui Apache-2.0（4 子包 BSD-3-Clause，商用剔除 CC BY-NC-SA 皮肤）。
