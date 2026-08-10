const cloud = require('wx-server-sdk')
cloud.init()

const db = cloud.database()

exports.main = async () => {
  try {
    await db.createCollection('reminders')
    return { created: true }
  } catch (e) {
    // 已存在不算错误
    if (e.errCode === -502001) {
      return { created: false, reason: 'already exists' }
    }
    throw e
  }
}
