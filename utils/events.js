const STORAGE_KEY = 'reminder_events_v1'

function getEvents() {
  return wx.getStorageSync(STORAGE_KEY) || []
}

function saveEvents(events) {
  wx.setStorageSync(STORAGE_KEY, events)
}

function upsertEvent(event) {
  const events = getEvents()
  const index = events.findIndex((item) => item.id === event.id)
  if (index === -1) events.push(event)
  else events[index] = event
  saveEvents(events)
  return event
}

function updateStatus(id, status) {
  const events = getEvents().map((event) => event.id === id ? { ...event, status } : event)
  saveEvents(events)
}

function shiftEvent(id, minutes) {
  const events = getEvents().map((event) => {
    if (event.id !== id) return event
    const start = new Date(event.startAt)
    start.setMinutes(start.getMinutes() + minutes)
    return { ...event, startAt: start.toISOString(), status: 'pending' }
  })
  saveEvents(events)
}

module.exports = { getEvents, upsertEvent, updateStatus, shiftEvent }
