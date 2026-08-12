/**
 * 事项云端存储。
 *
 * 云函数根据调用者 OpenID 过滤数据，客户端缓存只用于渲染和离线查看，
 * 不再是事项的唯一数据源。
 */
const STORAGE_KEY = 'reminder_events_v1'
const MIGRATION_KEY = 'reminder_events_cloud_migrated_v1'

let initialized = false
let initializing = null

function getEvents() {
  const events = wx.getStorageSync(STORAGE_KEY)
  return Array.isArray(events) ? events : []
}

function saveCache(events) {
  wx.setStorageSync(STORAGE_KEY, events)
  return events
}

async function callEvents(action, data = {}) {
  const result = await wx.cloud.callFunction({
    name: 'events',
    data: { action, ...data }
  })
  return result.result
}

async function ensureCollections() {
  await wx.cloud.callFunction({ name: 'ensureDB' })
}

async function listCloudEvents(retryAfterEnsure = true) {
  try {
    const result = await callEvents('list')
    return Array.isArray(result?.events) ? result.events : []
  } catch (err) {
    if (!retryAfterEnsure) throw err
    // 首次部署时 events 集合尚不存在，创建后只重试一次。
    await ensureCollections()
    return listCloudEvents(false)
  }
}

/**
 * 首次使用时把旧本地事项导入当前登录用户的云端空间。
 * 迁移完成标记仅在云端确认成功后写入，失败不会丢失本地数据。
 */
async function initializeEvents() {
  if (initialized) return getEvents()
  if (initializing) return initializing

  initializing = (async () => {
    const localEvents = getEvents()
    let cloudEvents = await listCloudEvents()

    if (!wx.getStorageSync(MIGRATION_KEY)) {
      if (localEvents.length) {
        // 云函数单次最多接收 100 条；分批导入确保历史数据不会被截断。
        for (let index = 0; index < localEvents.length; index += 100) {
          await callEvents('migrate', { events: localEvents.slice(index, index + 100) })
        }
        cloudEvents = await listCloudEvents()
      }
      wx.setStorageSync(MIGRATION_KEY, true)
    }

    initialized = true
    return saveCache(cloudEvents)
  })()

  try {
    return await initializing
  } finally {
    initializing = null
  }
}

async function refreshEvents() {
  await initializeEvents()
  return saveCache(await listCloudEvents())
}

function replaceCachedEvent(event) {
  const events = getEvents()
  const index = events.findIndex((item) => item.id === event.id)
  if (index === -1) events.push(event)
  else events[index] = event
  saveCache(events)
  return event
}

async function upsertEvent(event) {
  const result = await callEvents('upsert', { event })
  return replaceCachedEvent(result.event)
}

async function updateStatus(id, status) {
  const result = await callEvents('updateStatus', { id, status })
  return replaceCachedEvent(result.event)
}

async function shiftEvent(id, minutes) {
  const result = await callEvents('shift', { id, minutes })
  return replaceCachedEvent(result.event)
}

async function deleteEvent(id) {
  await callEvents('delete', { id })
  saveCache(getEvents().filter((event) => event.id !== id))
}

function isSchedule(event) {
  return event.type === 'event' || (!event.type && event.startAt)
}

/** 找出与候选日程重叠的未完成日程。 */
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

module.exports = {
  getEvents,
  initializeEvents,
  refreshEvents,
  upsertEvent,
  updateStatus,
  shiftEvent,
  deleteEvent,
  getScheduleConflicts
}
