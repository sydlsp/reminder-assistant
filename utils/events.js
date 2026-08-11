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

function isSchedule(event) {
  return event.type === 'event' || (!event.type && event.startAt)
}

/**
 * 找出与候选日程重叠的未完成日程。重叠是提示信息，不会阻止保存。
 */
function getScheduleConflicts(candidate) {
  if (!isSchedule(candidate) || !candidate.startAt || !candidate.endAt) return []
  const candidateStart = new Date(candidate.startAt).getTime()
  const candidateEnd = new Date(candidate.endAt).getTime()
  if (!Number.isFinite(candidateStart) || !Number.isFinite(candidateEnd) || candidateEnd <= candidateStart) return []

  return getEvents().filter((event) => {
    if (event.id === candidate.id || event.status === 'done' || !isSchedule(event)) return false
    const start = new Date(event.startAt).getTime()
    const end = new Date(event.endAt).getTime()
    return Number.isFinite(start) && Number.isFinite(end) && candidateStart < end && candidateEnd > start
  })
}

module.exports = { getEvents, upsertEvent, updateStatus, shiftEvent, deleteEvent, getScheduleConflicts }
