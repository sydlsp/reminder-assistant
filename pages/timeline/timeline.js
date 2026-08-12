const { getEvents, initializeEvents, refreshEvents, updateStatus, deleteEvent } = require('../../utils/events')
const { dateString, timeString, isSameDay, displayDate, localDate } = require('../../utils/date')
const { cancelReminders } = require('../../utils/reminder')

Page({
  data: {
    scheduleLabel: '',
    selectedDate: '',
    isToday: true,
    pendingTimeline: [],
    doneTimeline: [],
    hasTimelineItems: false,
    nowLineTop: -1
  },

  async onLoad(options) {
    if (options.date) {
      this.setData({ selectedDate: options.date })
    } else {
      this.setData({ selectedDate: dateString() })
    }
    await this.loadCloudEvents()
  },

  async onShow() {
    await this.loadCloudEvents()
  },

  async loadCloudEvents() {
    try {
      await initializeEvents()
      await refreshEvents()
    } catch (err) {
      console.warn('[Events] 云端事项加载失败:', err.message)
    }
    this.loadTimeline()
  },

  loadTimeline() {
    const selected = localDate(this.data.selectedDate, '00:00')
    const today = dateString()
    const now = new Date()

    const allEvents = getEvents()
      .filter(e => {
        if (e.type === 'todo') return false
        if (e.type === 'event') return isSameDay(new Date(e.startAt), selected)
        if (e.type === 'deadline') return isSameDay(new Date(e.deadline), selected)
        return e.startAt && isSameDay(new Date(e.startAt), selected)
      })

    const items = allEvents.map(e => {
      if (e.type === 'event' || (e.startAt && !e.type)) {
        const start = new Date(e.startAt)
        const end = e.endAt ? new Date(e.endAt) : start
        return {
          id: e.id, type: 'event', title: e.title,
          location: e.location || '', status: e.status,
          timeLabel: timeString(start),
          timeRange: `${timeString(start)} - ${timeString(end)}`,
          sortMin: start.getHours() * 60 + start.getMinutes()
        }
      }
      const dl = new Date(e.deadline)
      return {
        id: e.id, type: 'deadline', title: e.title,
        location: e.location || '', status: e.status,
        timeLabel: timeString(dl),
        timeRange: `截止 ${timeString(dl)}`,
        sortMin: dl.getHours() * 60 + dl.getMinutes()
      }
    }).sort((a, b) => a.sortMin - b.sortMin)

    const pending = items.filter(e => e.status !== 'done')
    const done = items.filter(e => e.status === 'done')

    let nowLineTop = -1
    if (this.data.selectedDate === today) {
      const nowMin = now.getHours() * 60 + now.getMinutes()
      let idx = pending.length
      for (let i = 0; i < pending.length; i++) {
        if (pending[i].sortMin > nowMin) { idx = i; break }
      }
      nowLineTop = idx * 180
    }

    this.setData({
      scheduleLabel: displayDate(selected),
      isToday: this.data.selectedDate === today,
      pendingTimeline: pending,
      doneTimeline: done,
      hasTimelineItems: items.length > 0,
      nowLineTop
    })
  },

  selectDate(e) {
    this.setData({ selectedDate: e.detail.value }, () => this.loadTimeline())
  },

  changeDay(e) {
    const date = localDate(this.data.selectedDate, '00:00')
    date.setDate(date.getDate() + Number(e.currentTarget.dataset.offset))
    this.setData({ selectedDate: dateString(date) }, () => this.loadTimeline())
  },

  goToday() {
    this.setData({ selectedDate: dateString() }, () => this.loadTimeline())
  },

  goCards() {
    wx.redirectTo({ url: `/pages/index/index?date=${this.data.selectedDate}` })
  },

  addEvent() {
    wx.navigateTo({ url: `/pages/editor/editor?date=${this.data.selectedDate}` })
  },

  async complete(e) {
    const id = e.currentTarget.dataset.id
    const item = getEvents().find(entry => entry.id === id)
    try {
      await updateStatus(id, 'done')
      this.loadTimeline()
      await cancelReminders(id, item?.reminderId, item?.reminderIds || [])
    } catch (err) {
      wx.showToast({ title: '操作失败，请重试', icon: 'none' })
    }
  },

  editItem(e) {
    wx.navigateTo({ url: `/pages/editor/editor?id=${e.currentTarget.dataset.id}` })
  },

  removeItem(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '确认删除',
      content: '删除后无法恢复',
      confirmColor: '#d45252',
      success: async (res) => {
        if (res.confirm) {
          const item = getEvents().find(entry => entry.id === id)
          try {
            await deleteEvent(id)
            this.loadTimeline()
            await cancelReminders(id, item?.reminderId, item?.reminderIds || [])
          } catch (err) {
            wx.showToast({ title: '删除失败，请重试', icon: 'none' })
          }
        }
      }
    })
  }
})
