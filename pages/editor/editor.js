const { upsertEvent } = require('../../utils/events')
const { dateString, timeString, parseClipboard } = require('../../utils/date')

Page({
  data: {
    title: '',
    date: dateString(),
    time: timeString(),
    remindBefore: 10,
    reminderOptions: [0, 5, 10, 15, 30, 60],
    reminderIndex: 2,
    source: 'manual',
    originalText: '',
    loadingClipboard: false
  },

  onLoad(options) {
    if (options.date) this.setData({ date: options.date })
    if (options.importClipboard === '1') this.readClipboard()
  },

  readClipboard() {
    this.setData({ loadingClipboard: true })
    wx.getClipboardData({
      success: ({ data }) => {
        if (!data || !data.trim()) {
          wx.showToast({ title: '剪贴板没有文字', icon: 'none' })
          return
        }
        const parsed = parseClipboard(data)
        this.setData({
          title: parsed.title,
          date: parsed.date,
          time: parsed.time,
          source: 'clipboard',
          originalText: data
        })
        wx.showToast({ title: parsed.recognized ? '已识别时间' : '请确认时间', icon: 'success' })
      },
      fail: () => wx.showToast({ title: '无法读取剪贴板', icon: 'none' }),
      complete: () => this.setData({ loadingClipboard: false })
    })
  },

  onTitleInput(event) { this.setData({ title: event.detail.value }) },
  onDateChange(event) { this.setData({ date: event.detail.value }) },
  onTimeChange(event) { this.setData({ time: event.detail.value }) },
  onReminderChange(event) {
    const reminderIndex = Number(event.detail.value)
    this.setData({
      reminderIndex,
      remindBefore: this.data.reminderOptions[reminderIndex]
    })
  },

  save() {
    const { title, date, time, remindBefore, source, originalText } = this.data
    if (!title.trim()) {
      wx.showToast({ title: '请填写事项内容', icon: 'none' })
      return
    }
    const start = new Date(`${date}T${time}:00`)
    upsertEvent({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title: title.trim(),
      startAt: start.toISOString(),
      remindBefore,
      source,
      originalText,
      status: 'pending',
      createdAt: new Date().toISOString()
    })
    wx.showToast({ title: '已加入日程', icon: 'success' })
    setTimeout(() => wx.navigateBack(), 450)
  }
})
