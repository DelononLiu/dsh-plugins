/**
 * dsh-focus-session client vitest 配置：DOM 注入测试（侧栏置顶区/活跃区）用
 * happy-dom 环境。
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom',
  },
})
