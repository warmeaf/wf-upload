import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: 'wf-upload',
  description: '大文件上传',
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: '文档', link: '/docs/guide/introduction', activeMatch: '/docs/' },
      { text: '技术方案', link: '/solution/ideas', activeMatch: '/solution/' },
    ],

    sidebar: {
      '/docs/': [
        {
          text: '指南',
          items: [
            { text: '介绍', link: '/docs/guide/introduction' },
            { text: '安装', link: '/docs/guide/install' },
          ],
        },
        {
          text: '基本使用',
          items: [
            { text: '大文件上传', link: '/docs/use/upload' },
            { text: '文件秒传', link: '/docs/use/secondPass' },
            { text: '暂停上传', link: '/docs/use/pause' },
            { text: '断点续传', link: '/docs/use/sequel' },
            { text: '多文件上传', link: '/docs/use/multiple' },
            { text: '事件监听', link: '/docs/use/event' },
          ],
        },
        {
          text: '自定义',
          items: [
            { text: '请求策略', link: '/docs/custom/request' },
            // { text: '分片策略', link: '/docs/custom/spitor' },
          ],
        },
      ],
      '/solution/': [
        { text: '总体实现思路', link: '/solution/ideas' },
        // { text: '如何减少页面堵塞?', link: '/solution/pageJam' },
        // { text: '通讯协议', link: '/solution/request' },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/warmeaf/wf-upload' },
    ],
  },
})
