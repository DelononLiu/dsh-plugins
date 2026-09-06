/**
 * dsh-tabs client vitest 配置：DOM 注入测试（左侧栏「置顶」区）用 happy-dom 环境。
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom',
  },
})
