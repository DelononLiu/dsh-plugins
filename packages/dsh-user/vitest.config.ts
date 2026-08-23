/**
 * dsh-user client vitest 配置：DOM 测试（侧边栏注入）用 happy-dom 环境。
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom',
  },
})
