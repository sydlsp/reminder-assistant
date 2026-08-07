const { getEvents, upsertEvent } = require('../../utils/events')
const { dateString, timeString, parseClipboard } = require('../../utils/date')

Page({
  data: {
    editId: '',
    isEdit: false,
    type: 'todo',
    typeOptions: [
      { label: '待办', value: 'todo', desc: '无明确时间' },
      { label: '日程', value: 'event', desc: '有明确时段' },
      { label: '截止', value: 'deadline', desc: '有截止时间' }
    ],
    typeIndex: 0,
    title: '',
    date: dateString(),
    time: timeString(),
    endTime: timeString(),
    remindBefore: 10,
    reminderOptions: [0, 5, 10, 15, 30, 60],
    reminderIndex: 2,
    source: 'manual',
    originalText: '',
    loadingClipboard: false
  },

  onLoad(options) {
    if (options.date) this.setData({ date: options.date })
    if (options.id) {
      this.loadEvent(options.id)
    } else if (options.importClipboard === '1') {
      this.readClipboard()
    }
  },

  loadEvent(id) {
    const event = getEvents().find(e => e.id === id)
    if (!event) return
    const typeIndex = this.data.typeOptions.findIndex(o => o.value === (event.type || 'event'))
    const start = event.startAt ? new Date(event.startAt) : null
    const end = event.endAt ? new Date(event.endAt) : null
    const dl = event.deadline ? new Date(event.deadline) : null
    const reminderIndex = this.data.reminderOptions.indexOf(event.remindBefore ?? 10)

    this.setData({
      editId: id,
      isEdit: true,
      type: event.type || 'event',
      typeIndex: typeIndex >= 0 ? typeIndex : 1,
      title: event.title || '',
      date: event.type === 'event' && start ? dateString(start) : event.type === 'deadline' && dl ? dateString(dl) : this.data.date,
      time: start ? timeString(start) : dl ? timeString(dl) : timeString(),
      endTime: end ? timeString(end) : timeString(),
      remindBefore: event.remindBefore ?? 10,
      reminderIndex: reminderIndex >= 0 ? reminderIndex : 2,
      source: event.source || 'manual',
      originalText: event.originalText || ''
    })
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
        const typeIndex = this.data.typeOptions.findIndex(o => o.value === parsed.suggestedType)
        this.setData({
          title: parsed.title,
          date: parsed.date,
          time: parsed.time,
          type: parsed.suggestedType,
          typeIndex: typeIndex >= 0 ? typeIndex : 0,
          source: 'clipboard',
          originalText: data
        })
        wx.showToast({ title: parsed.recognized ? '已识别时间' : '请确认时间', icon: 'success' })
      },
      fail: () => wx.showToast({ title: '无法读取剪贴板', icon: 'none' }),
      complete: () => this.setData({ loadingClipboard: false })
    })
  },

  onTypeChange(event) {
    const typeIndex = Number(event.detail.value)
    this.setData({
      typeIndex,
      type: this.data.typeOptions[typeIndex].value
    })
  },

  onTitleInput(event) { this.setData({ title: event.detail.value }) },
  onDateChange(event) { this.setData({ date: event.detail.value }) },
  onTimeChange(event) { this.setData({ time: event.detail.value }) },
  onEndTimeChange(event) { this.setData({ endTime: event.detail.value }) },
  onReminderChange(event) {
    const reminderIndex = Number(event.detail.value)
    this.setData({
      reminderIndex,
      remindBefore: this.data.reminderOptions[reminderIndex]
    })
  },

  save() {
    const { editId, type, title, date, time, endTime, remindBefore, source, originalText } = this.data
    if (!title.trim()) {
      wx.showToast({ title: '请填写事项内容', icon: 'none' })
      return
    }

    const base = {
      id: editId || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title: title.trim(),
      type,
      remindBefore,
      source,
      originalText,
      status: 'pending',
      createdAt: new Date().toISOString()
    }

    if (type === 'event') {
      base.startAt = new Date(`${date}T${time}:00`).toISOString()
      base.endAt = new Date(`${date}T${endTime}:00`).toISOString()
    } else if (type === 'deadline') {
      base.deadline = new Date(`${date}T${time}:00`).toISOString()
    }

    upsertEvent(base)
    wx.showToast({ title: editId ? '已更新事项' : '已加入日程', icon: 'success' })
    setTimeout(() => wx.navigateBack(), 450)
  }
})
