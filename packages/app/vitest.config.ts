import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 测试环境：使用 jsdom 模拟浏览器环境，支持 DOM API 和 Web Workers
    environment: 'jsdom',

    // 测试文件匹配模式
    include: ['**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: ['node_modules', 'dist', '.idea', '.git', '.cache'],

    // 全局测试设置
    globals: true,

    // 覆盖率配置
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/types.ts',
        '**/index.ts',
      ],
    },

    // 测试超时时间（毫秒）
    testTimeout: 10000,
  },
})
