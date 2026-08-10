App({
  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({
        env: 'cloud1-d5gfoypaw26e17b38',
        traceUser: true
      })
    }
  },
  globalData: {
    appName: '提醒助手',
    // 订阅消息模板 ID：去 mp.weixin.qq.com → 功能 → 订阅消息 → 选用"待办事项提醒"模板后填入
    // 模板字段要求：thing1(事项名称)、date2(提醒时间)、thing3(备注)
    reminderTmplId: 'JOJYF_qTOzR7cIi48MouJ0B2HCB5485JhlO3ThXBGYo'
  }
})
