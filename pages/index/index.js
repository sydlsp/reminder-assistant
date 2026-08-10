const { getEvents, updateStatus, shiftEvent, deleteEvent } = require('../../utils/events')
const { dateString, isSameDay, displayTime, displayTimeRange, displayDate } = require('../../utils/date')

Page({
  data: {
    scheduleLabel: '',
    selectedDate: '',
    isToday: true,
    todos: [],
    schedules: [],
    deadlines: [],
    completedCount: 0,
    totalCount: 0
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

    const allEvents = getEvents()
      .filter((event) => {
        // todo: no date filter, always shown (but only today or earlier)
        if (event.type === 'todo') return true
        // event: filter by startAt date
        if (event.type === 'event') return isSameDay(new Date(event.startAt), selected)
        // deadline: filter by deadline date
        if (event.type === 'deadline') return isSameDay(new Date(event.deadline), selected)
        // legacy events without type: treat as event
        return event.startAt && isSameDay(new Date(event.startAt), selected)
      })

    const todos = allEvents
      .filter(e => e.type === 'todo' || (!e.type && !e.startAt && !e.deadline))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

    const schedules = allEvents
      .filter(e => e.type === 'event' || (e.startAt && !e.type))
      .sort((a, b) => new Date(a.startAt) - new Date(b.startAt))
      .map(e => ({ ...e, timeRange: displayTimeRange(e.startAt, e.endAt) }))

    const deadlines = allEvents
      .filter(e => e.type === 'deadline')
      .sort((a, b) => new Date(a.deadline) - new Date(b.deadline))
      .map(e => ({ ...e, time: displayTime(e.deadline) }))

    const split = arr => [
      arr.filter(e => e.status !== 'done'),
      arr.filter(e => e.status === 'done')
    ]

    const [todosPending, todosDone] = split(todos)
    const [schedulesPending, schedulesDone] = split(schedules)
    const [deadlinesPending, deadlinesDone] = split(deadlines)

    this.setData({
      scheduleLabel: displayDate(selected),
      isToday: dateString(selected) === dateString(today),
      todosPending, todosDone,
      schedulesPending, schedulesDone,
      deadlinesPending, deadlinesDone,
      completedCount: allEvents.filter(e => e.status === 'done').length,
      totalCount: allEvents.length
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
  },

  editItem(event) {
    const id = event.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/editor/editor?id=${id}` })
  },

  removeItem(event) {
    const id = event.currentTarget.dataset.id
    wx.showModal({
      title: '确认删除',
      content: '删除后无法恢复',
      confirmColor: '#d45252',
      success: (res) => {
        if (res.confirm) {
          deleteEvent(id)
          this.loadSchedule()
        }
      }
    })
  }
})
