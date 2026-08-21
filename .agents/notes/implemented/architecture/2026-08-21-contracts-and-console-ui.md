# Agent Note: 契约跟随数据所有者 + console 界面拆分

Status: implemented

> 2026-08 修正：撤销独立 contracts 包（用户确认：契约类型不适合单独搞一个插件）。

## Problem

两个联动未定项：①实例档案共享契约的载体——nav（UI 读端）需要读档案，不能直接绑定 console 运行时实现；②总览 UI 归属——console 自带 client 会混淆"管理组件"与"UI 层"边界。

## Decision

**契约跟随数据所有者**（不单独建契约包）：
- 实例/主机档案类型与 @Remote 服务签名由 **dsh-console 定义并导出**（console 是数据所有者）。
- 消费者（dsh-nav / dsh-console-ui）用 **`import type`** 引用（编译期类型，**运行时零依赖**——产物无对 console 的 require）+ `ctx.remote` 调用（client 面）。
- 依赖方向 UI → 管理组件（向下），合规；"一套概念模型"由"唯一定义在 console"保证。

**总览 UI → console 纯服务端 + `dsh-console-ui`（UI 层）**：
- dsh-console 去掉 client 导出与 dsh.client 字段（纯服务端）。
- 总览/管理界面独立为 UI 层插件 dsh-console-ui（devDeps 依赖 dsh-console 类型 + ctx.remote 消费）。

## Alternatives

- 独立 types-only 契约包（dsh-contracts）——否决（2026-08 修正）：契约类型不适合单独搞一个插件；定义在数据所有者处更自然，type-only import 已解决耦合。
- 契约放 dsh-channel——否决：档案含归属/类型/生命周期等业务概念，放通信层让 L2 依赖 L3 语义。
- console 自带 client——否决：混淆管理组件与 UI 层边界。

## Consequences

- packages/ = 7 自研插件（user/channel/console/console-ui/nav/tabs/my-ui），无独立契约包。
- nav/console-ui 对 console 为 **devDependencies type-only 引用**（运行时零依赖）；调用走 Typert ctx.remote。
- profiles bundles 无 contracts 项（web 9 项 / web3 8 项）。
