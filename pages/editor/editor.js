const { getEvents, upsertEvent, deleteEvent } = require('../../utils/events')
const { dateString, timeString, displayDate, localDate } = require('../../utils/date')
const { aiParse } = require('../../utils/aiParser')
const { registerReminder } = require('../../utils/reminder')

Page({
  data: {
    editId: '',
    isEdit: false,
    showPreview: false,
    showEditForm: false,
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
    reminderOptions: [0,1,5, 10, 15, 30, 60],
    reminderIndex: 2,
    source: 'manual',
    originalText: '',
    location: '',
    loadingClipboard: false,
    loadingParse: false,
    // 预览摘要
    previewTypeLabel: '',
    previewDateLabel: '',
    previewTimeLabel: ''
  },

  onLoad(options) {
    if (options.date) this.setData({ date: options.date })
    if (options.id) {
      this.loadEvent(options.id)
    } else if (options.importClipboard === '1') {
      this.readClipboard()
    } else {
      this.setData({ showEditForm: true })
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

    const d = event.type === 'event' && start ? dateString(start)
      : event.type === 'deadline' && dl ? dateString(dl) : this.data.date
    const t = start ? timeString(start) : dl ? timeString(dl) : timeString()

    this.setData({
      editId: id,
      isEdit: true,
      showPreview: false,
      showEditForm: true,
      type: event.type || 'event',
      typeIndex: typeIndex >= 0 ? typeIndex : 1,
      title: event.title || '',
      date: d,
      time: t,
      endTime: end ? timeString(end) : timeString(),
      remindBefore: event.remindBefore ?? 10,
      reminderIndex: reminderIndex >= 0 ? reminderIndex : 2,
      source: event.source || 'manual',
      originalText: event.originalText || '',
      location: event.location || ''
    }, () => this.buildPreview())
  },

  readClipboard() {
    this.setData({ loadingClipboard: true, loadingParse: true })
    wx.getClipboardData({
      success: async ({ data }) => {
        if (!data || !data.trim()) {
          wx.showToast({ title: '剪贴板没有文字', icon: 'none' })
          return
        }
        const parsed = await aiParse(data)
        this.applyParse(parsed, { source: 'clipboard', originalText: data })
        wx.showToast({ title: parsed.recognized ? '已智能解析，请确认' : '未识别时间，请手动填写', icon: parsed.recognized ? 'success' : 'none' })
      },
      fail: () => wx.showToast({ title: '无法读取剪贴板', icon: 'none' }),
      complete: () => this.setData({ loadingClipboard: false, loadingParse: false })
    })
  },

  async parseTitle() {
    const text = this.data.title.trim()
    if (!text) {
      wx.showToast({ title: '请先输入事项内容', icon: 'none' })
      return
    }
    this.setData({ loadingParse: true })
    const parsed = await aiParse(text)
    this.setData({ loadingParse: false })
    this.applyParse(parsed, { source: 'manual' })
    if (parsed.recognized) {
      wx.showToast({ title: '已智能解析，请确认', icon: 'success' })
    } else {
      wx.showToast({ title: '未识别到时间，已设为待办', icon: 'none' })
    }
  },

  applyParse(parsed, extra) {
    const typeIndex = this.data.typeOptions.findIndex(o => o.value === parsed.suggestedType)
    const setData = {
      title: parsed.title,
      date: parsed.date,
      time: parsed.time,
      type: parsed.suggestedType,
      typeIndex: typeIndex >= 0 ? typeIndex : 0,
      showPreview: true,
      showEditForm: false,
      ...extra
    }
    if (parsed.endTime) setData.endTime = parsed.endTime
    if (parsed.location) setData.location = parsed.location
    this.setData(setData, () => this.buildPreview())
  },

  buildPreview() {
    const { type, typeOptions, typeIndex, title, date, time, endTime, remindBefore } = this.data
    const typeLabel = typeOptions[typeIndex].label
    let dateLabel = displayDate(localDate(date, '00:00'))
    let timeLabel = ''

    if (type === 'event') {
      timeLabel = endTime ? `${time} ~ ${endTime}` : time
    } else if (type === 'deadline') {
      timeLabel = `截止 ${time}`
    }

    if (type === 'todo') {
      dateLabel = '无截止时间'
    }

    this.setData({
      previewTypeLabel: typeLabel,
      previewDateLabel: dateLabel,
      previewTimeLabel: timeLabel
    })
  },

  onLocationInput(event) { this.setData({ location: event.detail.value }) },

  toggleEditForm() {
    this.setData({ showEditForm: !this.data.showEditForm })
  },

  onTypeChange(event) {
    const typeIndex = Number(event.detail.value)
    this.setData({
      typeIndex,
      type: this.data.typeOptions[typeIndex].value
    }, () => this.buildPreview())
  },

  onTitleInput(event) { this.setData({ title: event.detail.value }) },
  onDateChange(event) {
    this.setData({ date: event.detail.value }, () => this.buildPreview())
  },
  onTimeChange(event) {
    this.setData({ time: event.detail.value }, () => this.buildPreview())
  },
  onEndTimeChange(event) {
    this.setData({ endTime: event.detail.value }, () => this.buildPreview())
  },
  onReminderChange(event) {
    const reminderIndex = Number(event.detail.value)
    this.setData({
      reminderIndex,
      remindBefore: this.data.reminderOptions[reminderIndex]
    })
  },

  save() {
    const { editId, type, title, date, time, endTime, remindBefore, source, originalText, location } = this.data
    if (!title.trim()) {
      wx.showToast({ title: '请填写事项内容', icon: 'none' })
      return
    }

    const base = {
      id: editId || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title: title.trim(),
      type,
      location,
      remindBefore,
      source,
      originalText,
      status: 'pending',
      createdAt: new Date().toISOString()
    }

    if (type === 'event') {
      base.startAt = localDate(date, time).toISOString()
      base.endAt = localDate(date, endTime).toISOString()
    } else if (type === 'deadline') {
      base.deadline = localDate(date, time).toISOString()
    }

    upsertEvent(base)

    const onComplete = () => {
      wx.showToast({ title: editId ? '已更新事项' : '已加入日程', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 450)
    }

    // 设置了提醒时间 → 请求订阅消息授权
    if (remindBefore > 0) {
      this.requestReminder(base, onComplete)
    } else {
      onComplete()
    }
  },

  requestReminder(base, callback) {
    const tmplId = getApp().globalData.reminderTmplId
    if (!tmplId) {
      console.warn('[Reminder] 未配置 reminderTmplId，跳过')
      callback()
      return
    }

    wx.requestSubscribeMessage({
      tmplIds: [tmplId],
      success: (res) => {
        if (res[tmplId] === 'accept') {
          registerReminder(base, tmplId).then(id => {
            if (id) wx.showToast({ title: '已设置提醒', icon: 'success' })
          })
        }
      },
      fail: (err) => {
        console.log('[Reminder] 用户拒绝或失败:', err.errMsg)
      },
      complete: () => callback()
    })
  },

  removeItem() {
    wx.showModal({
      title: '确认删除',
      content: '删除后无法恢复',
      confirmText: '删除',
      confirmColor: '#d45252',
      success: (res) => {
        if (!res.confirm) return
        deleteEvent(this.data.editId)
        wx.showToast({ title: '已删除', icon: 'success' })
        setTimeout(() => wx.navigateBack(), 350)
      }
    })
  }
})
