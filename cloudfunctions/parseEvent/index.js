const cloud = require('wx-server-sdk')
const https = require('https')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const DEEPSEEK_HOST = 'api.deepseek.com'
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || ''

const SYSTEM_PROMPT = `你是一个日程解析助手。根据用户输入的自然语言文本，提取其中的日程信息并返回严格 JSON。

分类定义：
- todo：待办事务，无明确日期和时间
- event：有明确时间段（开始和结束时间）的日程安排
- deadline：有截止日期/时间（含"截止""ddl""deadline""之前""到期"等关键词，或仅给出日期无具体时间点）

解析规则：
1. 日期：今天=当前日期(2026-08-07)，明天=+1天，后天=+2天，大后天=+3天
   下周X=下周对应星期，X月X日=具体日期，X天后=+X天
2. 时间：24小时制输出。上午X点→X:00，下午X点→X+12:00，晚上X点→X+12:00
3. 识别到"X点到Y点"或"X:00-Y:00"等时间段 → type=event，分别填入time和endTime
4. 识别到含截止含义或仅给出日期无时间段 → type=deadline
5. 无任何日期和时间信息 → type=todo, recognized=false
6. title字段：清理掉日期和时间描述后的纯事项内容

只返回 JSON，格式如下：
{"title":"事项标题","date":"YYYY-MM-DD","time":"HH:mm","endTime":"HH:mm或空","suggestedType":"todo|event|deadline","recognized":true|false}`

function deepseekRequest(messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'deepseek-chat',
      messages,
      temperature: 0,
      max_tokens: 300,
      response_format: { type: 'json_object' }
    })

    const req = https.request({
      hostname: DEEPSEEK_HOST,
      path: '/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 10000
    }, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (e) {
          reject(new Error(`JSON parse failed: ${data.slice(0, 200)}`))
        }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')) })
    req.write(body)
    req.end()
  })
}

exports.main = async (event) => {
  const { text } = event
  if (!text || !text.trim()) {
    return { title: text || '', date: '', time: '', endTime: '', suggestedType: 'todo', recognized: false }
  }

  try {
    const response = await deepseekRequest([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: text }
    ])

    const content = response?.choices?.[0]?.message?.content
    if (content) {
      const parsed = JSON.parse(content)
      return {
        title: parsed.title || text,
        date: parsed.date || '',
        time: parsed.time || '',
        endTime: parsed.endTime || '',
        suggestedType: parsed.suggestedType || 'todo',
        recognized: parsed.recognized ?? true
      }
    }
    throw new Error('Empty response from DeepSeek')
  } catch (err) {
    console.error('DeepSeek parse failed:', err.message)
    return {
      title: text,
      date: '',
      time: '',
      endTime: '',
      suggestedType: 'todo',
      recognized: false,
      error: err.message
    }
  }
}
