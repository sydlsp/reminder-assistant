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
    if (event.id !== id || event.type !== 'event') return event
    const start = new Date(event.startAt)
    const end = new Date(event.endAt)
    start.setMinutes(start.getMinutes() + minutes)
    end.setMinutes(end.getMinutes() + minutes)
    return { ...event, startAt: start.toISOString(), endAt: end.toISOString(), status: 'pending' }
  })
  saveEvents(events)
}

function deleteEvent(id) {
  const events = getEvents().filter((event) => event.id !== id)
  saveEvents(events)
}

module.exports = { getEvents, upsertEvent, updateStatus, shiftEvent, deleteEvent }
