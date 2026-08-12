const cloud = require('wx-server-sdk')
const https = require('https')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const DEEPSEEK_HOST = 'api.deepseek.com'
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || ''
const VALID_TYPES = new Set(['todo', 'event', 'deadline'])

function shanghaiDateContext(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short'
  }).formatToParts(now).reduce((result, part) => ({ ...result, [part.type]: part.value }), {})
  const weekdayMap = { Sun: '日', Mon: '一', Tue: '二', Wed: '三', Thu: '四', Fri: '五', Sat: '六' }
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: weekdayMap[parts.weekday] || ''
  }
}

function buildSystemPrompt(baseDate) {
  const currentContext = shanghaiDateContext()
  const selectedContext = /^\d{4}-\d{2}-\d{2}$/.test(baseDate || '')
    ? shanghaiDateContext(new Date(`${baseDate}T00:00:00+08:00`))
    : currentContext
  const { date, weekday } = selectedContext
  return `你是一个日程解析助手。根据用户输入的自然语言文本，提取事项信息并只返回严格 JSON。

当前计划基准日：${date}（星期${weekday}）。相对日期必须基于此日期计算，即使真实今天不同也不能使用真实今天。

分类定义：
- todo：没有明确日期和时间的待办
- event：有明确日期和开始时间的日程；有时间段时填 endTime
- deadline：截止日期或截止时间；只有日期、没有具体时间也属于 deadline

规则：
1. 日期输出 YYYY-MM-DD；时间输出 24 小时制 HH:mm。
2. “明天/后天/下周X/X天后”按当前北京时间计算。
3. “X点到Y点”“X:00-Y:00”等时间段为 event，并填写 time 与 endTime。
4. “截止/ddl/deadline/之前/到期”等表达为 deadline。
5. 没有日期和时间时为 todo，recognized=false。
6. title 仅保留事项内容，删除日期、时间和地点描述。
7. location 提取地点（如“在302会议室”返回“302会议室”），没有则为空字符串。

只返回 JSON：
{"title":"事项标题","date":"YYYY-MM-DD或空","time":"HH:mm或空","endTime":"HH:mm或空","location":"地点或空","suggestedType":"todo|event|deadline","recognized":true|false}`
}

function deepseekRequest(messages) {
  if (!DEEPSEEK_API_KEY) return Promise.reject(new Error('未配置 DEEPSEEK_API_KEY'))

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
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 10000
    }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`DeepSeek 请求失败（HTTP ${res.statusCode}）`))
          return
        }
        try {
          resolve(JSON.parse(data))
        } catch (err) {
          reject(new Error('DeepSeek 返回了无效 JSON'))
        }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('DeepSeek 请求超时')) })
    req.write(body)
    req.end()
  })
}

function normalizeDate(value, warnings) {
  if (typeof value !== 'string' || !value) return ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    warnings.push('AI 返回的日期格式无效，已忽略')
    return ''
  }
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    warnings.push('AI 返回的日期无效，已忽略')
    return ''
  }
  return value
}

function normalizeTime(value, warnings, fieldName) {
  if (typeof value !== 'string' || !value) return ''
  if (!/^\d{2}:\d{2}$/.test(value)) {
    warnings.push(`AI 返回的${fieldName}格式无效，已忽略`)
    return ''
  }
  const [hour, minute] = value.split(':').map(Number)
  if (hour > 23 || minute > 59) {
    warnings.push(`AI 返回的${fieldName}无效，已忽略`)
    return ''
  }
  return value
}

function normalizeResult(raw, fallbackTitle) {
  const warnings = []
  let date = normalizeDate(raw.date, warnings)
  let time = normalizeTime(raw.time, warnings, '时间')
  let endTime = normalizeTime(raw.endTime, warnings, '结束时间')
  let suggestedType = VALID_TYPES.has(raw.suggestedType) ? raw.suggestedType : 'todo'

  if (endTime && (!time || endTime <= time)) {
    warnings.push('结束时间必须晚于开始时间，已忽略')
    endTime = ''
  }
  if (suggestedType === 'event' && (!date || !time)) {
    warnings.push('日程缺少日期或开始时间，已调整类型')
    suggestedType = date ? 'deadline' : 'todo'
    endTime = ''
  }
  if (suggestedType === 'deadline' && !date) {
    warnings.push('截止事项缺少日期，已调整为待办')
    suggestedType = 'todo'
    time = ''
    endTime = ''
  }
  if (suggestedType === 'todo') {
    date = ''
    time = ''
    endTime = ''
  }

  return {
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 180) : fallbackTitle,
    date,
    time,
    endTime,
    location: typeof raw.location === 'string' ? raw.location.trim().slice(0, 50) : '',
    suggestedType,
    recognized: suggestedType !== 'todo' && Boolean(date || time),
    warnings
  }
}

function parseModelContent(content) {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const parsed = JSON.parse(cleaned)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('DeepSeek 返回格式不正确')
  }
  return parsed
}

exports.main = async (event) => {
  const text = typeof event.text === 'string' ? event.text.trim() : ''
  const baseDate = typeof event.baseDate === 'string' ? event.baseDate : ''
  if (!text) {
    return { title: '', date: '', time: '', endTime: '', location: '', suggestedType: 'todo', recognized: false, warnings: [] }
  }

  try {
    const response = await deepseekRequest([
      { role: 'system', content: buildSystemPrompt(baseDate) },
      { role: 'user', content: text }
    ])
    const content = response?.choices?.[0]?.message?.content
    if (!content) throw new Error('DeepSeek 没有返回解析结果')
    return normalizeResult(parseModelContent(content), text)
  } catch (err) {
    console.error('[parseEvent] DeepSeek 解析失败:', err.message)
    return {
      title: text,
      date: '',
      time: '',
      endTime: '',
      location: '',
      suggestedType: 'todo',
      recognized: false,
      warnings: [],
      error: err.message
    }
  }
}
