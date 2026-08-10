/**
 * 提醒注册模块
 * 将提醒任务写入云数据库，由 remindWorker 云函数定时发送订阅消息
 */
const db = wx.cloud ? wx.cloud.database() : null

/**
 * 计算提醒目标时间
 * @param {Object} eventData - 事项数据 { startAt, deadline, type, remindBefore }
 * @returns {Date|null} 提醒触发时间
 */
function calcRemindAt(eventData) {
  const { type, startAt, deadline, remindBefore } = eventData
  if (!remindBefore || remindBefore <= 0) return null

  const eventTime = type === 'deadline' ? deadline : startAt
  if (!eventTime) return null

  return new Date(new Date(eventTime).getTime() - remindBefore * 60 * 1000)
}

/**
 * 注册一条提醒到云数据库
 * @param {Object} eventData - 完整事项数据
 * @param {string} templateId - 订阅消息模板 ID
 * @returns {Promise<string|null>} 云数据库记录 _id，失败返回 null
 */
async function registerReminder(eventData, templateId) {
  if (!db) {
    console.warn('[Reminder] 云开发未初始化，跳过提醒注册')
    return null
  }

  const remindAt = calcRemindAt(eventData)
  if (!remindAt || remindAt <= new Date()) {
    console.log('[Reminder] 提醒时间已过，跳过注册')
    return null
  }

  try {
    const { _id } = await db.collection('reminders').add({
      data: {
        eventId: eventData.id,
        title: eventData.title,
        type: eventData.type,
        eventTime: eventData.type === 'deadline' ? eventData.deadline : eventData.startAt,
        remindAt,
        remindBefore: eventData.remindBefore,
        templateId,
        page: '/pages/index/index',
        status: 'pending',
        createdAt: new Date()
      }
    })
    console.log('[Reminder] 提醒已注册:', eventData.title, '→', remindAt)
    return _id
  } catch (err) {
    // 集合不存在 → 调用 ensureDB 创建后重试
    if (err.errCode === -502005) {
      console.log('[Reminder] reminders 集合不存在，自动创建中...')
      try {
        await wx.cloud.callFunction({ name: 'ensureDB' })
        // 重试添加
        const { _id } = await db.collection('reminders').add({
          data: {
            eventId: eventData.id,
            title: eventData.title,
            type: eventData.type,
            eventTime: eventData.type === 'deadline' ? eventData.deadline : eventData.startAt,
            remindAt,
            remindBefore: eventData.remindBefore,
            templateId,
            page: '/pages/index/index',
            status: 'pending',
            createdAt: new Date()
          }
        })
        console.log('[Reminder] 提醒已注册:', eventData.title, '→', remindAt)
        return _id
      } catch (retryErr) {
        console.error('[Reminder] 创建集合重试失败:', retryErr.message)
        return null
      }
    }
    console.error('[Reminder] 注册失败:', err.message)
    return null
  }
}

module.exports = { calcRemindAt, registerReminder }
