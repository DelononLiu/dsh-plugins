/**
 * dsh-plan-show 测试配置：host 侧是纯函数/存储（无 DOM 依赖），client 视图测试需要
 * DOM 环境——统一用 happy-dom，两边都能跑。
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom',
  },
})
