/**
 * dsh-focus-session client vitest 配置：DOM 注入测试（侧栏置顶区/活跃区）用
 * happy-dom 环境。
 *
 * `@deepseek-ai/dsh-client-ui-primitives` 官方发布的 `lib/index.js` 引用未随包
 * 发布的 `simple-icons` 且以 `.module.css` 实现样式，node 直接加载会失败；测试期
 * 别名到 `tests/stubs/ui-primitives.tsx`（真实导入名/类型仍由 typecheck 对着官方
 * .d.ts 把关，运行时由 ModuleLoader 提供官方共享模块）。
 */

import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@deepseek-ai/dsh-client-ui-primitives': fileURLToPath(
        new URL('./tests/stubs/ui-primitives.tsx', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'happy-dom',
  },
})
