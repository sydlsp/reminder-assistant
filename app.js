App({
  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({
        env: 'your-env-id',  // 替换为你的云开发环境 ID
        traceUser: true
      })
    }
  },
  globalData: {
    appName: '提醒助手'
  }
})
