import { defineWorkspace } from 'vitest/config'

// defineWorkspace 会提供一个很好的类型提示开发体验
export default defineWorkspace(['packages/*'])
