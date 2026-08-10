const { getEvents, updateStatus, shiftEvent, deleteEvent } = require('../../utils/events')
const { dateString, timeString, isSameDay, displayTime, displayTimeRange, displayDate, localDate } = require('../../utils/date')

Page({
  data: {
    scheduleLabel: '',
    selectedDate: '',
    isToday: true,
    // 卡片视图数据
    todosPending: [], todosDone: [],
    schedulesPending: [], schedulesDone: [],
    deadlinesPending: [], deadlinesDone: [],
    completedCount: 0,
    totalCount: 0,
    // 时间线视图数据
    pendingTimeline: [],
    doneTimeline: [],
    hasTimelineItems: false,
    nowLineTop: -1,
    // swiper
    swiperCurrent: 0,
    swiperHeight: 600   // 默认值，onReady 中更新
  },

  onLoad() {
    this.setData({ selectedDate: dateString() }, () => this.loadSchedule())
  },

  onReady() {
    this.calcSwiperHeight()
  },

  onShow() {
    this.loadSchedule()
  },

  calcSwiperHeight() {
    const query = wx.createSelectorQuery().in(this)
    query.select('.page').boundingClientRect()
    query.select('.header-area').boundingClientRect()
    query.exec((res) => {
      if (res[0] && res[1]) {
        const h = res[0].height - res[1].height
        this.setData({ swiperHeight: Math.max(h, 400) })
      }
    })
  },

  loadSchedule() {
    const selected = localDate(this.data.selectedDate, '00:00')
    const today = dateString()
    const now = new Date()

    const allEvents = getEvents()
      .filter((event) => {
        if (event.type === 'todo') return true
        if (event.type === 'event') return isSameDay(new Date(event.startAt), selected)
        if (event.type === 'deadline') return isSameDay(new Date(event.deadline), selected)
        return event.startAt && isSameDay(new Date(event.startAt), selected)
      })

    // ── 卡片视图 ──
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

    // ── 时间线视图 ──
    const timelineItems = schedules.concat(deadlines).map(e => {
      if (e.type === 'event') {
        const start = new Date(e.startAt)
        const end = new Date(e.endAt)
        return {
          id: e.id, type: 'event', title: e.title,
          location: e.location || '', remindBefore: e.remindBefore,
          source: e.source, status: e.status,
          timeLabel: timeString(start),
          timeRange: `${timeString(start)} - ${timeString(end)}`,
          sortMin: start.getHours() * 60 + start.getMinutes()
        }
      }
      const dl = new Date(e.deadline)
      return {
        id: e.id, type: 'deadline', title: e.title,
        location: e.location || '', remindBefore: e.remindBefore,
        source: e.source, status: e.status,
        timeLabel: timeString(dl),
        timeRange: `截止 ${timeString(dl)}`,
        sortMin: dl.getHours() * 60 + dl.getMinutes()
      }
    }).sort((a, b) => a.sortMin - b.sortMin)

    const pendingTL = timelineItems.filter(e => e.status !== 'done')
    const doneTL = timelineItems.filter(e => e.status === 'done')

    // 当前时间红线（仅今天）
    let nowLineTop = -1
    if (this.data.selectedDate === today) {
      const nowMin = now.getHours() * 60 + now.getMinutes()
      let idx = pendingTL.length
      for (let i = 0; i < pendingTL.length; i++) {
        if (pendingTL[i].sortMin > nowMin) { idx = i; break }
      }
      nowLineTop = idx * 180
    }

    this.setData({
      scheduleLabel: displayDate(selected),
      isToday: this.data.selectedDate === today,
      todosPending, todosDone,
      schedulesPending, schedulesDone,
      deadlinesPending, deadlinesDone,
      completedCount: allEvents.filter(e => e.status === 'done').length,
      totalCount: allEvents.length,
      pendingTimeline: pendingTL,
      doneTimeline: doneTL,
      hasTimelineItems: timelineItems.length > 0,
      nowLineTop
    })
  },

  // ── 日期导航 ──
  selectDate(e) {
    this.setData({ selectedDate: e.detail.value }, () => this.loadSchedule())
  },

  changeDay(e) {
    const date = localDate(this.data.selectedDate, '00:00')
    date.setDate(date.getDate() + Number(e.currentTarget.dataset.offset))
    this.setData({ selectedDate: dateString(date) }, () => this.loadSchedule())
  },

  goToday() {
    this.setData({ selectedDate: dateString() }, () => this.loadSchedule())
  },

  addEvent() {
    wx.navigateTo({ url: `/pages/editor/editor?date=${this.data.selectedDate}` })
  },

  importClipboard() {
    wx.navigateTo({ url: `/pages/editor/editor?importClipboard=1&date=${this.data.selectedDate}` })
  },

  // ── 视图切换 ──
  switchView(e) {
    this.setData({ swiperCurrent: Number(e.currentTarget.dataset.index) })
  },

  onSwiperChange(e) {
    this.setData({ swiperCurrent: e.detail.current })
  },

  // ── 操作 ──
  complete(e) {
    updateStatus(e.currentTarget.dataset.id, 'done')
    this.loadSchedule()
  },

  postpone(e) {
    const id = e.currentTarget.dataset.id
    shiftEvent(id, 60)
    wx.showToast({ title: '已延后 1 小时', icon: 'success' })
    this.loadSchedule()
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
      success: (res) => {
        if (res.confirm) {
          deleteEvent(id)
          this.loadSchedule()
        }
      }
    })
  }
})
