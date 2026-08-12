const cloud = require('wx-server-sdk')
cloud.init()

const db = cloud.database()

exports.main = async () => {
  const collections = ['events', 'reminders']
  const results = await Promise.all(collections.map(async (name) => {
    try {
      await db.createCollection(name)
      return { name, created: true }
    } catch (e) {
      // 已存在不算错误
      if (e.errCode === -502001) return { name, created: false, reason: 'already exists' }
      throw e
    }
  }))
  return { collections: results }
}
