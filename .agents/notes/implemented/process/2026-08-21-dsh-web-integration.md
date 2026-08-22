# Agent Note: 真实接入 dsh-web（首个里程碑）

Status: implemented

## Problem

插件此前只有代码实现 + 单测，未真实接入 dsh-web。接入暴露三个硬门槛：profile bundle 机制、client bundle 格式、测试环境隔离。

## Decision

**接入机制（2026-08-21 实测确认）**：
1. **profile bundle**：profile package.json 的 `dsh.profile.bundles` 只列官方入口（base/web-app）；自研插件经 **cordis.patch.yml insert** 加载（`- insert: - {id, name}`），不进 bundles。
2. **client bundle 格式**：声明 `dsh.client` 的插件必须有 **`lib/client.js`**（官方 closure-factory：`window.__ModuleLoader__.load({id, factory})`，factory 经注入 require 解 external，导出 apply/inject）——DSH client-modules 检查该文件，浏览器经 `/plugins/<id>/client.js` 加载。tsc 产出的 lib/client/index.js 不匹配。
3. **client 构建**：新增 `scripts/build-client.mjs`（esbuild bundle → iife → 包装成 ModuleLoader closure，external 由注入 require 提供）；4 个 client 插件（my-ui/console-ui/nav/tabs）build 脚本已接入。
4. **测试环境 = 目录隔离**（用户要求）：web2/web3 用**独立 DSH_HOME**（`~/.dsh-web2`、`~/.dsh-web3`，`DSH_HOME=<dir> dsh --profile web` 启动），非共享 ~/.dsh 的 profile 隔离——sessions/settings/storages 完全隔离。独立 home 的 profile 用官方方式创建（`dsh plugin --profile web add`）。webserver 端口独立配置（避开正式 3080）。

**验证结果**：独立环境（~/.dsh-web2）web profile 启动成功，4 个 host 插件（user/channel/console/my-ui）加载无错误；浏览器 `/plugins/dsh-desk/client.js` 返回官方格式 bundle；页面 200。

## Consequences

- 插件真实接入 dsh-web：host 服务 + client bundle 均被 DSH Web 加载。
- client UI 渲染（React/slots）仍需 client 集成步（closure 骨架已可加载，渲染后续）。
- 测试流程 = 独立 DSH_HOME + cordis.patch.yml insert + 独立端口。
