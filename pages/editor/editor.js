const { getEvents, upsertEvent, deleteEvent, getScheduleConflicts } = require('../../utils/events')
const { dateString, timeString, displayDate, localDate } = require('../../utils/date')
const { aiParse } = require('../../utils/aiParser')
const { registerReminder, cancelReminders } = require('../../utils/reminder')

Page({
  data: {
    editId: '',
    isEdit: false,
    isCompleted: false,
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
    overdueReminder: true,
    reminderOptions: [0,1,5, 10, 15, 30, 60],
    reminderIndex: 2,
    source: 'manual',
    originalText: '',
    location: '',
    loadingClipboard: false,
    loadingParse: false,
    saving: false,
    showReminderSetup: false,
    savedEventId: '',
    settingReminder: false,
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
      isCompleted: event.status === 'done',
      showReminderSetup: false,
      savedEventId: '',
      showPreview: false,
      showEditForm: true,
      type: event.type || 'event',
      typeIndex: typeIndex >= 0 ? typeIndex : 1,
      title: event.title || '',
      date: d,
      time: t,
      endTime: end ? timeString(end) : timeString(),
      remindBefore: event.remindBefore ?? 10,
      overdueReminder: event.overdueReminder !== false,
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
        if (parsed.source === 'fallback') {
          wx.showToast({ title: '智能服务不可用，已规则解析', icon: 'none' })
        } else {
          wx.showToast({ title: parsed.recognized ? '已智能解析，请确认' : '未识别时间，请手动填写', icon: parsed.recognized ? 'success' : 'none' })
        }
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
    if (parsed.source === 'fallback') {
      wx.showToast({ title: '智能服务不可用，已规则解析', icon: 'none' })
    } else if (parsed.recognized) {
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
  onOverdueReminderChange(event) {
    this.setData({ overdueReminder: event.detail.value })
  },
  onCompletedChange(event) {
    this.setData({ isCompleted: event.detail.value })
  },

  async save() {
    if (this.data.saving) return
    const { editId, type, title, date, time, endTime, remindBefore, overdueReminder, isCompleted, source, originalText, location } = this.data
    if (!title.trim()) {
      wx.showToast({ title: '请填写事项内容', icon: 'none' })
      return
    }

    const previous = editId ? getEvents().find(event => event.id === editId) : null
    const base = {
      id: editId || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title: title.trim(),
      type,
      location,
      remindBefore,
      overdueReminder: type === 'deadline' && overdueReminder,
      source,
      originalText,
      status: isCompleted ? 'done' : 'pending',
      createdAt: previous?.createdAt || new Date().toISOString()
    }

    if (type === 'event') {
      base.startAt = localDate(date, time).toISOString()
      base.endAt = localDate(date, endTime).toISOString()
    } else if (type === 'deadline') {
      base.deadline = localDate(date, time).toISOString()
    }

    const conflicts = getScheduleConflicts(base)
    if (conflicts.length) {
      this.setData({ saving: true })
      const confirmed = await this.confirmScheduleConflicts(conflicts)
      if (!confirmed) {
        this.setData({ saving: false })
        return
      }
    } else {
      this.setData({ saving: true })
    }

    try {
      // 编辑、完成或删除过的旧版本可能存在多条提醒，先统一取消，避免重复或错时提醒。
      if (previous) await cancelReminders(base.id, previous.reminderId, previous.reminderIds || [])
      upsertEvent(base)

      const reminderPlan = this.getReminderPlan(base)
      if (base.status !== 'done' && reminderPlan.tmplIds.length) {
        this.setData({ showReminderSetup: true, savedEventId: base.id })
        wx.showToast({ title: '已保存，请设置提醒', icon: 'none' })
        return
      }

      wx.showToast({ title: editId ? '已更新事项' : '已加入日程', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 450)
    } finally {
      this.setData({ saving: false })
    }
  },

  confirmScheduleConflicts(conflicts) {
    const summaries = conflicts.slice(0, 2).map((event) => {
      const start = timeString(new Date(event.startAt))
      const end = timeString(new Date(event.endAt))
      return `「${event.title}」 ${start}–${end}`
    })
    const more = conflicts.length > 2 ? `\n另有 ${conflicts.length - 2} 项重叠日程` : ''

    return new Promise((resolve) => wx.showModal({
      title: `发现 ${conflicts.length} 个时间冲突`,
      content: `与以下日程重叠：\n${summaries.join('\n')}${more}`,
      cancelText: '返回修改',
      confirmText: '仍然保存',
      confirmColor: '#176b55',
      success: (res) => resolve(res.confirm),
      fail: () => resolve(false)
    }))
  },

  getReminderPlan(base) {
    const { reminderTmplId, overdueTmplId } = getApp().globalData
    const needsAdvance = base.type !== 'todo' && base.remindBefore > 0 && Boolean(reminderTmplId)
    let needsOverdue = base.type === 'deadline' && base.overdueReminder && Boolean(overdueTmplId)

    if (needsAdvance && needsOverdue && reminderTmplId === overdueTmplId) {
      console.warn('[Reminder] 提前提醒与逾期提醒不能共用同一一次性订阅模板，已跳过逾期提醒')
      needsOverdue = false
    }
    return {
      needsAdvance,
      needsOverdue,
      tmplIds: [needsAdvance && reminderTmplId, needsOverdue && overdueTmplId].filter(Boolean),
      reminderTmplId,
      overdueTmplId
    }
  },

  // 此方法必须由 setupReminder 的直接点击同步调用，不能在 await 之后调用。
  requestReminders(base, plan) {
    if (!plan.tmplIds.length) return Promise.resolve([])
    return new Promise((resolve) => wx.requestSubscribeMessage({
      tmplIds: plan.tmplIds,
      success: async (res) => {
        const ids = await Promise.all([
          plan.needsAdvance && res[plan.reminderTmplId] === 'accept'
            ? registerReminder(base, plan.reminderTmplId, 'advance') : null,
          plan.needsOverdue && res[plan.overdueTmplId] === 'accept'
            ? registerReminder(base, plan.overdueTmplId, 'overdue') : null
        ])
        resolve(ids.filter(Boolean))
      },
      fail: (err) => {
        console.log('[Reminder] 订阅授权失败:', err.errMsg)
        resolve([])
      }
    }))
  },

  setupReminder() {
    if (this.data.settingReminder) return
    const event = getEvents().find(item => item.id === this.data.savedEventId)
    if (!event || event.status === 'done') {
      wx.showToast({ title: '事项状态已变化', icon: 'none' })
      return
    }
    const plan = this.getReminderPlan(event)
    if (!plan.tmplIds.length) {
      wx.showToast({ title: '没有可用的提醒模板', icon: 'none' })
      return
    }

    // requestReminders 在这里立即执行，保持在用户 tap 手势的同步调用链中。
    const reminderRequest = this.requestReminders(event, plan)
    this.setData({ settingReminder: true })
    reminderRequest.then((reminderIds) => {
      if (!reminderIds.length) {
        wx.showToast({ title: '未设置提醒，可稍后重试', icon: 'none' })
        return
      }
      upsertEvent({ ...event, reminderId: reminderIds[0], reminderIds })
      this.setData({ showReminderSetup: false })
      wx.showToast({ title: '已设置提醒', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 450)
    }).catch((err) => {
      console.warn('[Reminder] 设置提醒异常:', err.message)
      wx.showToast({ title: '设置提醒失败', icon: 'none' })
    }).finally(() => this.setData({ settingReminder: false }))
  },

  skipReminder() {
    wx.navigateBack()
  },

  noop() {},

  removeItem() {
    wx.showModal({
      title: '确认删除',
      content: '删除后无法恢复',
      confirmText: '删除',
      confirmColor: '#d45252',
      success: async (res) => {
        if (!res.confirm) return
        const event = getEvents().find(item => item.id === this.data.editId)
        deleteEvent(this.data.editId)
        await cancelReminders(this.data.editId, event?.reminderId, event?.reminderIds || [])
        wx.showToast({ title: '已删除', icon: 'success' })
        setTimeout(() => wx.navigateBack(), 350)
      }
    })
  }
})
