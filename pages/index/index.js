const { getEvents, updateStatus, shiftEvent } = require('../../utils/events')
const { dateString, isSameDay, displayTime, displayDate } = require('../../utils/date')

Page({
  data: {
    scheduleLabel: '',
    selectedDate: '',
    isToday: true,
    events: [],
    completedCount: 0
  },

  onLoad() {
    this.setData({ selectedDate: dateString() }, () => this.loadSchedule())
  },

  onShow() {
    this.loadSchedule()
  },

  loadSchedule() {
    const selected = new Date(`${this.data.selectedDate}T00:00:00`)
    const today = new Date()
    const events = getEvents()
      .filter((event) => isSameDay(new Date(event.startAt), selected))
      .sort((a, b) => new Date(a.startAt) - new Date(b.startAt))
      .map((event) => ({ ...event, time: displayTime(event.startAt) }))
    this.setData({
      scheduleLabel: displayDate(selected),
      isToday: dateString(selected) === dateString(today),
      events,
      completedCount: events.filter((event) => event.status === 'done').length
    })
  },

  addEvent() {
    wx.navigateTo({ url: `/pages/editor/editor?date=${this.data.selectedDate}` })
  },

  importClipboard() {
    wx.navigateTo({ url: `/pages/editor/editor?importClipboard=1&date=${this.data.selectedDate}` })
  },

  selectDate(event) {
    this.setData({ selectedDate: event.detail.value }, () => this.loadSchedule())
  },

  changeDay(event) {
    const date = new Date(`${this.data.selectedDate}T00:00:00`)
    date.setDate(date.getDate() + Number(event.currentTarget.dataset.offset))
    this.setData({ selectedDate: dateString(date) }, () => this.loadSchedule())
  },

  goToday() {
    this.setData({ selectedDate: dateString() }, () => this.loadSchedule())
  },

  complete(event) {
    updateStatus(event.currentTarget.dataset.id, 'done')
    this.loadSchedule()
  },

  postpone(event) {
    const id = event.currentTarget.dataset.id
    shiftEvent(id, 60)
    wx.showToast({ title: '已延后 1 小时', icon: 'success' })
    this.loadSchedule()
  }
})
