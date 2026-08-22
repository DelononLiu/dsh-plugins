# vendored/ —— 社区插件（npm 安装 + lock 锁版本）

> 2026-08 更新：**统一 npm 安装方式**——所有 vendored 走 `dependencies` + `dsh.lock.json` 锁版本（与全家桶一致）。submodule 不再用于轻量单包（npm 有发布版即用 npm）；submodule 仅保留给**无 npm 发布版或需深度改造审查**的例外（当前无）。

| 插件 | 来源 | 模式 | 状态 |
| --- | --- | --- | --- |
| dsh-web-ui 全家桶（@linxin666） | [zhu1090093659/dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui) | npm 安装（@linxin666 子集）+ lock 锁版本 + patch 层改造 | ✅ v1 已装 5 包 |
| dsh-memento | [PerryLink/dsh-memento](https://github.com/PerryLink/dsh-memento) | npm 安装（v0.4.4）+ lock 锁版本 | 📋 选定未接入（v1 无消费方） |
| dst-agent-teams | [NanmiCoder/dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams) | npm 安装（@nanmicoder v0.1.12）+ lock 锁版本 | 📋 选定未接入（v1 发行包未来成员） |

- 安装方式见 AGENTS.md「Vendoring policy」：统一 npm + lock 锁版本 + patch 层改造。
- License：dsh-web-ui Apache-2.0（4 子包 BSD-3-Clause，商用剔除 CC BY-NC-SA 皮肤）· dsh-memento MIT · dst-agent-teams MIT。
