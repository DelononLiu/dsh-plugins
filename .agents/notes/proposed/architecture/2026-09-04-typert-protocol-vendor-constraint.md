# typert-protocol vendored 约束：根因分析与 upstream 演进建议

## 背景

0.1.2-alpha.5 / rc.1 起，dsh-plugins 将 `@deepseek-ai/dsh-typert-protocol` 的
官方源码 vendored 进 `packages/typert-protocol`，并由 `tsconfig.host.json` 的
paths/references 指向它（另在 pnpm-workspace overrides 中 `link:` 单实例）。
升级 rc.1 时曾误判"官方 npm 已内置同内容 → vendor 冗余可删"，导致
typert generator 构建失败（`publishes Remote artifacts but has no Remote
methods`）。本文档记录根因、已排除的替代方案与 upstream 建议。

## 我们 vendored protocol 解决的根本问题

让 typert generator 在**构建期**识别本仓包的 `@Remote` 方法并生成契约产物
（`lib/typert.host.{js,d.ts}` + `lib/typert.remote-client.{js,d.ts}`），
client 侧经 `ctx.remote` 消费。

**卡点机制**：generator 的 `isTypeMetaSymbol(node, name)` 做装饰器来源校验，
只认两种"真正的 Typert 装饰器"声明位置（rc.1 与 alpha.5 实现相同）：

```js
isTypeMetaSymbol(node, name) {
  const symbol = this.checker.getSymbolAtLocation(node);   // TS 类型检查器
  const resolved = this.resolveSymbol(symbol);
  if (resolved.name !== name) return false;
  const declaration = preferredDeclaration(resolved);
  if (declaration === void 0) return false;
  // 分支 1：符号声明文件位于某个 workspace 注册包内，且该包名 = protocol
  if (registrationForFile(declaration.file)?.name === "@deepseek-ai/dsh-typert-protocol") return true;
  // 分支 2：符号声明位于源码 `declare module "@deepseek-ai/dsh-typert-protocol"` 块内
  for (let c = declaration; c; c = parent(c))
    if (moduleDeclaration(c)?.name === "@deepseek-ai/dsh-typert-protocol") return true;
  return false;
}
```

- **分支 1**：generator 用 root `tsconfig.host.json` 的 references 发现包，
  只认 `root/packages/*` 下的注册（`loadRegistrations` 的 `isWithin(root/packages)`
  过滤）。官方 npm 的 protocol 声明在 `node_modules/.pnpm/...`，不在 packages/
  下 → 不命中。
- **分支 2**：官方 npm 的 `.d.ts` 是普通模块文件（非 `declare module` 包装），
  Remote 声明的父链上没有 module declaration → 不命中。

因此**纯 npm 依赖的 protocol 无法被 generator 识别**（实测复现报错）。

## vendor 的本质作用

1. 把官方源码镜像放进 `packages/typert-protocol`（workspace 注册包）；
2. `tsconfig.host.json` `paths` 让 generator 的 TS program 把 `import { Remote }
   from '@deepseek-ai/dsh-typert-protocol'` 解析到该源码 → 声明文件 realPath
   落在 packages/ 下 → 分支 1 命中。

vendor 内容与官方 npm 发布产物逐字一致（rc.1 已内置 remote-error.ts，而
alpha.5 官方缺——当初 vendored 也补了这个缺口），但 **generator 仍要求它
以 workspace 源码包形式存在**，纯运行时同内容不够。

## 已排除的替代方案（均实测/源码验证）

| 方案 | 结果 |
| --- | --- |
| 直接依赖 npm 版 + tsconfig 去 paths | ❌ generator 报 "no Remote methods"（符号在 node_modules，两分支都不命中） |
| `declare module` augmentation 内重导出 Remote | ❌ TS TS2666「augmentations 不允许 export」+ TS2484 冲突 |
| 官方 rc.1 加 node_modules 白名单/选项 | ❌ rc.1 `isTypeMetaSymbol` 与 alpha.5 相同，无外部包支持 |
| 官方 tsdown-plugin（`./tsdown` 子路径） | ❌ 底层同一 `WorkspaceTypertGenerator`，无免除路径 |

## 结论

- rc.1 没有免除 vendored 的新方案；这是 generator 架构约束下的唯一解。
- **连官方 monorepo 自己都把 protocol 放 `packages/typert/protocol`**（同
  workspace），generator 从设计上不支持"protocol 是外部 npm 依赖"的布局。
- vendor 是**构建期镜像**：升级内核后对比官方 tag（deepseek-harness
  `packages/typert/protocol/src`）与本地 vendored src，diff 一致即无需动
  （2026-09-04 rc.1 验证三文件逐字一致）；不一致则 `git archive dsh-v<ver>
  packages/typert/protocol/` 同步。

## upstream 建议（dsh-typert-generator）

让 `isTypeMetaSymbol` 的分支 1 或新增分支认可 node_modules 中
`@deepseek-ai/dsh-typert-protocol` 的声明：装饰器来源校验的本意是防
"同名假装饰器"，用 **package.json name（经 TS 的 module resolution 得
realPath 后上溯最近 package.json）** 而非"必须在 workspace packages/"即可
覆盖 npm 消费方，且不削弱防伪。此改进可让外部业务包免 vendored、直接
npm 依赖 protocol。待官方接受前，本仓维持 vendored。
