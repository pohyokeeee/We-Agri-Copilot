import { defineConfig } from '@tarojs/cli'
import devConfig from './dev'
import prodConfig from './prod'

export default defineConfig<'webpack5'>(async (merge) => {
  const baseConfig = {
    projectName: 'we-agri-copilot',
    date: '2026-10-15',
    designWidth: 750, // 750 design px = full screen width, so 96px here = 48 CSS px (min tap target)
    deviceRatio: { 640: 2.34 / 2, 750: 1, 375: 2, 828: 1.81 / 2 },
    sourceRoot: 'src',
    outputRoot: process.env.TARO_ENV === 'h5' ? 'dist-h5' : 'dist', // separate folders so a web build never overwrites the WeChat one
    plugins: [],
    // build-time constant: the Mini Program runtime has no `process`, so nothing in src/ may read process.env
    defineConstants: { API_BASE_URL: JSON.stringify(process.env.TARO_APP_API_BASE_URL || 'http://localhost:8000') },
    copy: { patterns: [], options: {} },
    framework: 'react',
    compiler: { type: 'webpack5', prebundle: { enable: false } },
    cache: { enable: false },
    // web preview for teammates (the submission is the WeChat Mini Program); `taro build --type h5 --watch` serves devServer
    h5: { publicPath: '/', staticDirectory: 'static', devServer: { host: '0.0.0.0', port: 10086 } },
    mini: {
      postcss: {
        pxtransform: { enable: true, config: {} },
        cssModules: { enable: false, config: {} },
      },
    },
  }
  return merge({}, baseConfig, process.env.NODE_ENV === 'development' ? devConfig : prodConfig)
})
