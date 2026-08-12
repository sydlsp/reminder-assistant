const cloud = require('wx-server-sdk')

cloud.init()

const db = cloud.database()
const _ = db.command
const COLLECTION = 'events'

function openid() {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) throw new Error('无法识别当前用户')
  return OPENID
}

function assertId(id) {
  if (typeof id !== 'string' || !id.trim()) throw new Error('事项 ID 无效')
  return id
}

function assertEvent(input, repairLegacy = false) {
  if (!input || typeof input !== 'object') throw new Error('事项数据无效')
  const id = assertId(input.id)
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (!title) throw new Error('事项内容不能为空')

  let type = ['todo', 'event', 'deadline'].includes(input.type) ? input.type : 'todo'
  // 早期本地版本可能留下 type 与时间字段不一致的数据。迁移时修复，
  // 正常保存仍保留严格校验，避免写入新的无效事项。
  if (repairLegacy && type === 'deadline' && !input.deadline && input.startAt) input = { ...input, deadline: input.startAt }
  if (repairLegacy && type === 'event' && input.startAt && !input.endAt) input = { ...input, endAt: input.startAt }
  if (repairLegacy && ((type === 'deadline' && !input.deadline) || (type === 'event' && !input.startAt))) type = 'todo'
  const event = {
    id,
    title,
    type,
    location: typeof input.location === 'string' ? input.location : '',
    remindBefore: Number.isFinite(Number(input.remindBefore)) ? Number(input.remindBefore) : 10,
    overdueReminder: type === 'deadline' && input.overdueReminder === true,
    source: typeof input.source === 'string' ? input.source : 'manual',
    originalText: typeof input.originalText === 'string' ? input.originalText : '',
    status: input.status === 'done' ? 'done' : 'pending',
    createdAt: input.createdAt || new Date().toISOString(),
    reminderId: typeof input.reminderId === 'string' ? input.reminderId : '',
    reminderIds: Array.isArray(input.reminderIds) ? input.reminderIds.filter((item) => typeof item === 'string') : []
  }

  if (type === 'event') {
    if (!input.startAt || !input.endAt) throw new Error('日程时间不完整')
    event.startAt = input.startAt
    event.endAt = input.endAt
  }
  if (type === 'deadline') {
    if (!input.deadline) throw new Error('截止时间不完整')
    event.deadline = input.deadline
  }
  return event
}

async function findOwnedEvent(userOpenid, id) {
  const { data } = await db.collection(COLLECTION)
    .where({ ownerOpenId: userOpenid, id: assertId(id) })
    .limit(1)
    .get()
  if (!data.length) throw new Error('事项不存在或无权操作')
  return data[0]
}

function publicEvent(record) {
  const { _id, ownerOpenId, ...event } = record
  return event
}

async function list(userOpenid) {
  const events = []
  const pageSize = 100
  // 云函数分页读取，支持用户在多设备间恢复完整历史事项。
  for (let skip = 0; skip < 10000; skip += pageSize) {
    const { data } = await db.collection(COLLECTION)
      .where({ ownerOpenId: userOpenid })
      .orderBy('createdAt', 'desc')
      .skip(skip)
      .limit(pageSize)
      .get()
    events.push(...data.map(publicEvent))
    if (data.length < pageSize) break
  }
  return { events }
}

async function upsert(userOpenid, input) {
  const event = assertEvent(input)
  const { data } = await db.collection(COLLECTION)
    .where({ ownerOpenId: userOpenid, id: event.id })
    .limit(1)
    .get()

  if (data.length) {
    await db.collection(COLLECTION).doc(data[0]._id).update({ data: { ...event, updatedAt: new Date() } })
  } else {
    await db.collection(COLLECTION).add({
      // OpenID 只来自云函数上下文，客户端无法传入或覆盖归属字段。
      data: { ...event, ownerOpenId: userOpenid, createdAt: event.createdAt, updatedAt: new Date() }
    })
  }
  return { event }
}

async function updateStatus(userOpenid, id, status) {
  const record = await findOwnedEvent(userOpenid, id)
  const event = { ...publicEvent(record), status: status === 'done' ? 'done' : 'pending' }
  await db.collection(COLLECTION).doc(record._id).update({ data: { status: event.status, updatedAt: new Date() } })
  return { event }
}

async function shift(userOpenid, id, minutes) {
  const record = await findOwnedEvent(userOpenid, id)
  const event = publicEvent(record)
  if (event.type !== 'event') throw new Error('只有日程可以延后')
  const offset = Number(minutes)
  if (!Number.isFinite(offset)) throw new Error('延后时间无效')
  const start = new Date(event.startAt)
  const end = new Date(event.endAt)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new Error('日程时间无效')
  start.setMinutes(start.getMinutes() + offset)
  end.setMinutes(end.getMinutes() + offset)
  const shifted = { ...event, startAt: start.toISOString(), endAt: end.toISOString(), status: 'pending' }
  await db.collection(COLLECTION).doc(record._id).update({
    data: { startAt: shifted.startAt, endAt: shifted.endAt, status: 'pending', updatedAt: new Date() }
  })
  return { event: shifted }
}

async function remove(userOpenid, id) {
  const record = await findOwnedEvent(userOpenid, id)
  await db.collection(COLLECTION).doc(record._id).remove()
  return { deleted: true }
}

async function migrate(userOpenid, events) {
  if (!Array.isArray(events)) throw new Error('迁移数据无效')
  // 单条历史记录异常不应让整批迁移失败。无法修复的记录会保留在本地，
  // 其余合法事项仍可完成云端备份。
  const validEvents = []
  const skipped = []
  for (const item of events.slice(0, 100)) {
    try {
      validEvents.push(assertEvent(item, true))
    } catch (err) {
      skipped.push({ id: item?.id || '', reason: err.message })
    }
  }
  for (const event of validEvents) {
    const { data } = await db.collection(COLLECTION)
      .where({ ownerOpenId: userOpenid, id: event.id })
      .limit(1)
      .get()
    if (!data.length) {
      await db.collection(COLLECTION).add({ data: { ...event, ownerOpenId: userOpenid, updatedAt: new Date() } })
    }
  }
  return { ...(await list(userOpenid)), skipped }
}

exports.main = async (event) => {
  const userOpenid = openid()
  switch (event.action) {
    case 'list': return list(userOpenid)
    case 'upsert': return upsert(userOpenid, event.event)
    case 'updateStatus': return updateStatus(userOpenid, event.id, event.status)
    case 'shift': return shift(userOpenid, event.id, event.minutes)
    case 'delete': return remove(userOpenid, event.id)
    case 'migrate': return migrate(userOpenid, event.events)
    default: throw new Error('不支持的事项操作')
  }
}
