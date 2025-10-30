import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  worker: {
    format: 'es'
  },
  server: {
    proxy: {
      '/file': {
        target: 'http://127.0.0.1:3000/file',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/file/, ''),
      },
    },
  },
})
