/**
 * dsh-desk client vitest 配置：DOM 组装器测试用 happy-dom 环境。
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom',
  },
})
