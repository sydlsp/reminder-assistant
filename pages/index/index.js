const { getEvents, updateStatus, shiftEvent, deleteEvent } = require('../../utils/events')
const { dateString, timeString, isSameDay, displayTime, displayTimeRange, displayDate, localDate } = require('../../utils/date')

// 每个时间线节点的预估高度，以及首项前为“现在”标记保留的安全空间（rpx）。
const TIMELINE_NODE_HEIGHT = 180
const NOW_LINE_TOP_INSET = 34

Page({
  data: {
    currentView: 0,  // 0=卡片视图, 1=时间线
    cardTabClass: 'active',
    timelineTabClass: '',
    scheduleLabel: '',
    selectedDate: '',
    isToday: true,
    pageHeight: 0,
    swiperHeight: 600,

    // 卡片视图
    todosPending: [], todosDone: [],
    schedulesPending: [], schedulesDone: [],
    deadlinesPending: [], deadlinesDone: [],
    completedCount: 0,
    totalCount: 0,

    // 时间线视图
    pendingTimeline: [],
    doneTimeline: [],
    hasTimelineItems: false,
    nowLineTop: -1
  },

  onLoad(options) {
    const sys = wx.getSystemInfoSync()
    this.setData({ pageHeight: sys.windowHeight }, () => {
      if (options.date) {
        this.setData({ selectedDate: options.date }, () => this.loadSchedule())
      } else {
        this.setData({ selectedDate: dateString() }, () => this.loadSchedule())
      }
      setTimeout(() => this.measureHeader(), 100)
    })
  },

  measureHeader() {
    const query = wx.createSelectorQuery()
    query.select('.header-area').boundingClientRect()
    query.exec((res) => {
      if (res[0]) {
        const swiperHeight = this.data.pageHeight - res[0].height
        if (swiperHeight > 0) {
          this.setData({ swiperHeight })
        }
      }
    })
  },

  onShow() {
    this.loadSchedule()
  },

  loadSchedule() {
    const selected = localDate(this.data.selectedDate, '00:00')
    const today = dateString()
    const now = new Date()
    const selectedDateObj = new Date(`${this.data.selectedDate}T00:00:00`)

    const allEvents = getEvents()

    // ===== 卡片视图数据 =====
    const cardEvents = allEvents.filter((event) => {
      if (event.type === 'todo') return true
      if (event.type === 'event') return isSameDay(new Date(event.startAt), selectedDateObj)
      if (event.type === 'deadline') return isSameDay(new Date(event.deadline), selectedDateObj)
      return event.startAt && isSameDay(new Date(event.startAt), selectedDateObj)
    })

    const todos = cardEvents
      .filter(e => e.type === 'todo' || (!e.type && !e.startAt && !e.deadline))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

    const schedules = cardEvents
      .filter(e => e.type === 'event' || (e.startAt && !e.type))
      .sort((a, b) => new Date(a.startAt) - new Date(b.startAt))
      .map(e => ({ ...e, timeRange: displayTimeRange(e.startAt, e.endAt) }))

    const deadlines = cardEvents
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

    // ===== 时间线视图数据 =====
    const timelineEvents = allEvents.filter(e => {
      if (e.type === 'todo') return false
      if (e.type === 'event') return isSameDay(new Date(e.startAt), selected)
      if (e.type === 'deadline') return isSameDay(new Date(e.deadline), selected)
      return e.startAt && isSameDay(new Date(e.startAt), selected)
    })

    const timelineItems = timelineEvents.map(e => {
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

    const pendingTimeline = timelineItems.filter(e => e.status !== 'done')
    const doneTimeline = timelineItems.filter(e => e.status === 'done')

    let nowLineTop = -1
    if (this.data.selectedDate === today) {
      const nowMin = now.getHours() * 60 + now.getMinutes()
      let idx = pendingTimeline.length
      for (let i = 0; i < pendingTimeline.length; i++) {
        if (pendingTimeline[i].sortMin > nowMin) { idx = i; break }
      }
      nowLineTop = NOW_LINE_TOP_INSET + idx * TIMELINE_NODE_HEIGHT
    }

    this.setData({
      scheduleLabel: displayDate(selectedDateObj),
      isToday: this.data.selectedDate === today,
      todosPending, todosDone,
      schedulesPending, schedulesDone,
      deadlinesPending, deadlinesDone,
      completedCount: cardEvents.filter(e => e.status === 'done').length,
      totalCount: cardEvents.length,
      pendingTimeline, doneTimeline,
      hasTimelineItems: timelineItems.length > 0,
      nowLineTop
    })
  },

  onSwiperChange(e) {
    const view = e.detail.current
    this.setData({
      currentView: view,
      cardTabClass: view === 0 ? 'active' : '',
      timelineTabClass: view === 1 ? 'active' : ''
    })
  },

  switchView(e) {
    const view = Number(e.currentTarget.dataset.view)
    if (view !== this.data.currentView) {
      this.setData({
        currentView: view,
        cardTabClass: view === 0 ? 'active' : '',
        timelineTabClass: view === 1 ? 'active' : ''
      })
    }
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
    const date = localDate(this.data.selectedDate, '00:00')
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
