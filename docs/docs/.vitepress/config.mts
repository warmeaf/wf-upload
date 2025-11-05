import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  base: '/wf-upload/',
  title: 'wf-upload',
  description: '基于文件分片的大文件上传解决方案',
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: '文档', link: '/docs/guide/introduction', activeMatch: '/docs/' },
      { text: 'API 参考', link: '/docs/api/file-uploader', activeMatch: '/docs/api/' },
      { text: '后端 API', link: '/docs/server/overview', activeMatch: '/docs/server/' },
      { text: '技术方案', link: '/solution/ideas', activeMatch: '/solution/' },
    ],

    sidebar: {
      '/docs/': [
        {
          text: '指南',
          items: [
            { text: '介绍', link: '/docs/guide/introduction' },
            { text: '快速开始', link: '/docs/guide/quick-start' },
            { text: '安装', link: '/docs/guide/install' },
          ],
        },
        {
          text: '核心功能',
          items: [
            { text: '基本使用', link: '/docs/use/upload' },
            { text: '配置选项', link: '/docs/use/config' },
            { text: '事件监听', link: '/docs/use/event' },
            { text: '进度追踪', link: '/docs/use/progress' },
            { text: '上传控制', link: '/docs/use/control' },
            { text: '多文件上传', link: '/docs/use/multiple' },
          ],
        },
        {
          text: '高级特性',
          items: [
            { text: '文件秒传', link: '/docs/use/secondPass' },
            { text: '断点续传', link: '/docs/use/sequel' },
            { text: '暂停与恢复', link: '/docs/use/pause' },
            { text: '自定义 API 客户端', link: '/docs/custom/api-client' },
          ],
        },
        {
          text: 'API 参考',
          items: [
            { text: 'FileUploader', link: '/docs/api/file-uploader' },
            { text: '类型定义', link: '/docs/api/types' },
            { text: '事件类型', link: '/docs/api/events' },
          ],
        },
        {
          text: '后端服务',
          items: [
            { text: '概述', link: '/docs/server/overview' },
            { text: 'API 接口', link: '/docs/server/api' },
            { text: '部署指南', link: '/docs/server/deployment' },
          ],
        },
      ],
      '/solution/': [
        { text: '总体实现思路', link: '/solution/ideas' },
        { text: '架构设计', link: '/solution/architecture' },
        { text: '通信协议', link: '/solution/protocol' },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/warmeaf/wf-upload' },
    ],
  },
})
