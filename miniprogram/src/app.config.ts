export default defineAppConfig({
  pages: ['pages/chat/index', 'pages/cosigner/index', 'pages/trace/index'],
  window: {
    navigationBarTitleText: '元农民',
    navigationBarBackgroundColor: '#ffffff',
    navigationBarTextStyle: 'black',
  },
  permission: { 'scope.record': { desc: '用于语音说话' } },
})
