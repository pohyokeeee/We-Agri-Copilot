// The web build opens one combined page (farmer phone + judge panel); the Mini Program keeps its three pages.
const WEB = process.env.TARO_ENV === 'h5'

export default defineAppConfig({
  pages: WEB ? ['pages/web/index', 'pages/chat/index', 'pages/cosigner/index', 'pages/trace/index'] : ['pages/chat/index', 'pages/cosigner/index', 'pages/trace/index'],
  window: {
    navigationBarTitleText: '元农民',
    navigationBarBackgroundColor: '#ffffff',
    navigationBarTextStyle: 'black',
  },
})
