const { parseClipboard } = require('./date')

function callParseEvent(text) {
  if (!wx.cloud || !wx.cloud.callFunction) {
    return Promise.reject(new Error('云开发不可用'))
  }

  return wx.cloud.callFunction({
    name: 'parseEvent',
    data: { text }
  }).then(({ result }) => {
    if (!result) throw new Error('云函数没有返回解析结果')
    if (result.error) throw new Error(result.error)
    return result
  })
}

/**
 * 智能解析：优先通过云函数调用 DeepSeek，失败时降级为本地规则解析。
 * API Key 仅保存在云函数环境变量中，不会进入小程序包。
 */
async function aiParse(text) {
  const raw = text.trim()
  if (!raw) {
    return { title: '', date: '', time: '', endTime: '', location: '', suggestedType: 'todo', recognized: false, warnings: [], source: 'fallback' }
  }

  try {
    const parsed = await callParseEvent(raw)
    console.log('[AI Parser] 使用云函数解析:', raw)
    return {
      title: parsed.title || raw,
      date: parsed.date || '',
      time: parsed.time || '',
      endTime: parsed.endTime || '',
      location: parsed.location || '',
      suggestedType: parsed.suggestedType || 'todo',
      recognized: Boolean(parsed.recognized),
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      source: 'ai'
    }
  } catch (err) {
    console.warn('[AI Parser] 云端解析失败，降级为规则匹配:', err.message)
    const regexResult = parseClipboard(raw)
    return { ...regexResult, warnings: ['智能解析不可用，已使用规则解析'], source: 'fallback' }
  }
}

module.exports = { aiParse }
