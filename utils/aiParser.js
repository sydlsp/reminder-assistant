const { parseClipboard } = require('./date')
const { DEEPSEEK_API_KEY } = require('../config')

const API_URL = 'https://api.deepseek.com/chat/completions'

function buildSystemPrompt() {
  const today = new Date()
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][today.getDay()]

  return `你是一个日程解析助手。根据用户输入的自然语言文本，提取其中的日程信息并返回严格 JSON。

分类定义：
- todo：待办事务，无明确日期和时间
- event：有明确时间段（开始和结束时间）的日程安排
- deadline：有截止日期/时间（含"截止""ddl""deadline""之前""到期"等关键词，或仅给出日期无具体时间点）

解析规则：
1. 日期：今天=${dateStr}（周${weekday}），明天=+1天，后天=+2天，大后天=+3天
   下周X=下周对应星期，X月X日=具体日期，X天后=+X天
2. 时间：24小时制输出。上午X点→X:00，下午X点→X+12:00，晚上X点→X+12:00
3. 识别到"X点到Y点"或"X:00-Y:00"等时间段 → type=event，分别填入time和endTime
4. 识别到含截止含义或仅给出日期无时间段 → type=deadline
5. 无任何日期和时间信息 → type=todo, recognized=false
6. title字段：清理掉日期、时间和地点描述后的纯事项内容
7. location字段：提取地点信息（如"在302会议室"→"302会议室"），没有则返回空字符串

只返回 JSON，格式如下：
{"title":"事项标题","date":"YYYY-MM-DD","time":"HH:mm","endTime":"HH:mm或空","location":"地点或空","suggestedType":"todo|event|deadline","recognized":true|false}`
}

/**
 * 调用 DeepSeek API
 */
function callDeepSeek(text) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: API_URL,
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
      },
      data: {
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user', content: text }
        ],
        temperature: 0,
        max_tokens: 300,
        response_format: { type: 'json_object' }
      },
      timeout: 10000,
      success: (res) => {
        try {
          const content = res.data?.choices?.[0]?.message?.content
          if (content) {
            resolve(JSON.parse(content))
          } else {
            reject(new Error('Empty response'))
          }
        } catch (e) {
          reject(new Error(`Parse failed: ${e.message}`))
        }
      },
      fail: (err) => reject(new Error(err.errMsg || 'Request failed'))
    })
  })
}

/**
 * AI 智能解析：优先调用 DeepSeek，失败时兜底正则解析
 * @param {string} text - 用户输入的自然语言文本
 * @returns {Promise<{title, date, time, endTime, suggestedType, recognized, source}>}
 */
async function aiParse(text) {
  const raw = text.trim()
  if (!raw) {
    return { title: '', date: '', time: '', endTime: '', suggestedType: 'todo', recognized: false, source: 'fallback' }
  }

  // AI 解析
  if (DEEPSEEK_API_KEY) {
    try {
      const parsed = await callDeepSeek(raw)
      console.log('[AI Parser] 🤖 使用 DeepSeek 解析:', raw)
      return {
        title: parsed.title || raw,
        date: parsed.date || '',
        time: parsed.time || '',
        endTime: parsed.endTime || '',
        suggestedType: parsed.suggestedType || 'todo',
        recognized: parsed.recognized ?? true,
        source: 'ai'
      }
    } catch (err) {
      console.warn('[AI Parser] ⚠️ DeepSeek 调用失败，降级为规则匹配:', err.message)
    }
  }

  // 正则兜底（API key 为空或 AI 失败时）
  console.log('[AI Parser] 📋 使用规则匹配解析:', raw)
  const regexResult = parseClipboard(raw)
  return { ...regexResult, source: 'fallback' }
}

module.exports = { aiParse }
