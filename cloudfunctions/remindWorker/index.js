const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const now = new Date()
  const _ = db.command
  console.log('========================================')
  console.log('[remindWorker] 触发时间:', now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }))

  try {
    const { data: reminders } = await db.collection('reminders')
      .where({
        status: 'pending',
        remindAt: _.lte(now)
      })
      .limit(100)
      .get()

    console.log('[remindWorker] 扫描到待发送提醒:', reminders.length, '条')

    if (reminders.length === 0) {
      console.log('[remindWorker] 无需发送，结束')
      return { sent: 0 }
    }

    // 打印每条待发送提醒的详情
    reminders.forEach(r => {
      console.log(`[remindWorker] → [${r.title}] remindAt=${formatDate(r.remindAt)} openid=${r._openid}`)
    })

    const results = []
    for (const r of reminders) {
      try {
        await cloud.openapi.subscribeMessage.send({
          touser: r._openid,
          templateId: r.templateId,
          page: r.page || '/pages/index/index',
          data: {
            thing4: { value: r.title.slice(0, 20) },
            time2: { value: formatDate(r.eventTime) },
            thing3: { value: '无' }
          }
        })
        await db.collection('reminders').doc(r._id).update({
          data: { status: 'sent', sentAt: now }
        })
        console.log('[remindWorker] ✅ 发送成功:', r.title)
        results.push({ id: r._id, sent: true })
      } catch (err) {
        console.error(`[remindWorker] ❌ 发送失败 [${r.title}]:`, err.errCode, err.message)
        if (err.errCode === 43101) {
          await db.collection('reminders').doc(r._id).update({
            data: { status: 'failed', error: 'user not subscribed' }
          })
        }
        results.push({ id: r._id, sent: false, error: err.message })
      }
    }

    console.log('[remindWorker] 完成。成功:', results.filter(r => r.sent).length, '/ 总数:', reminders.length)
    console.log('========================================')
    return { sent: results.filter(r => r.sent).length, total: reminders.length }
  } catch (err) {
    console.error('[remindWorker] 异常:', err.errCode, err.message)
    return { error: err.message }
  }
}

function formatDate(d) {
  if (!d) return ''
  const date = new Date(d)
  const M = date.getMonth() + 1
  const D = date.getDate()
  const h = String(date.getHours()).padStart(2, '0')
  const m = String(date.getMinutes()).padStart(2, '0')
  return `${M}月${D}日 ${h}:${m}`
}
