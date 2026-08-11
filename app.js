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
    // 普通提醒模板：字段要求与 remindWorker 中发送的数据一致。
    reminderTmplId: 'JOJYF_qTOzR7cIi48MouJ0B2HCB5485JhlO3ThXBGYo',
    // 逾期提醒模板：待办事项=thing1，截止时间=time3。
    overdueTmplId: 'N6dLCfjFKzwg6rzo3GnYN16tHpSyyxY8FDOoDuefN6E'
  }
})
