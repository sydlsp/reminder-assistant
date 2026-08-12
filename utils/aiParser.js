const { parseClipboard } = require('./date')

// 相对日期必须以用户在月历中选中的日期为准。即使云函数仍是旧版本，
// 也在客户端兜底覆盖模型按“真实今天”计算出的日期。
function hasRelativeDate(text) {
  return /大后天|后天|明天|明日|今天|今日|下周[一二三四五六日天]|(?:本|这)?周[一二三四五六日天]|\d+天后|下个?月\d{1,2}[号日]/.test(text)
}

function callParseEvent(text, baseDate) {
  if (!wx.cloud || !wx.cloud.callFunction) {
    return Promise.reject(new Error('云开发不可用'))
  }

  return wx.cloud.callFunction({
    name: 'parseEvent',
    data: { text, baseDate }
  }).then(({ result }) => {
    if (!result) throw new Error('云函数没有返回解析结果')
    if (result.error) throw new Error(result.error)
    return result
  })
}

function callParseEventEdit(text, baseDate, currentEvent) {
  if (!wx.cloud || !wx.cloud.callFunction) {
    return Promise.reject(new Error('云开发不可用'))
  }

  return wx.cloud.callFunction({
    name: 'parseEvent',
    data: { text, baseDate, mode: 'edit', currentEvent }
  }).then(({ result }) => {
    if (!result) throw new Error('云函数没有返回解析结果')
    if (result.error) throw new Error(result.error)
    return result
  })
}

const EDIT_FIELDS = new Set(['title', 'type', 'date', 'time', 'endTime', 'location'])

function hasDateExpression(text) {
  return hasRelativeDate(text) || /(?:今年|明年)?\d{1,2}月\d{1,2}[号日]?|\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?|\d{1,2}[/.]\d{1,2}|\d{1,2}[号日](?!\s*(?:会议室|楼|楼房|房间|教室|厅|馆))|(?:这|本|下|下下)?周[一二三四五六日天]|(?:星期|礼拜)[一二三四五六日天]/.test(text)
}

function hasTimeExpression(text) {
  return /(?:上午|下午|晚上|今晚|中午|早上|早晨|凌晨)?\s*(?:\d{1,2}|[零〇一二两三四五六七八九十]{1,3})\s*(?:点|时|[:：])(?:\s*(?:\d{1,2}分?|半))?/.test(text)
}

function relevantClauses(text, keywords) {
  return text
    .split(/[，,。；;]|然后|只把/)
    .map(clause => clause.trim())
    .filter(clause => clause && keywords.some(keyword => clause.includes(keyword)))
}

function isFieldNegated(text, keywords) {
  return relevantClauses(text, keywords).some(clause => /不改|别改|不要改|保持(?:原样|不变)?|不变/.test(clause))
}

function filterEditFields(fields, text) {
  const result = fields.filter(field => EDIT_FIELDS.has(field))
  const hasTitleInstruction = /(?:标题|事项内容|事项名称|名称).{0,10}(?:改|换|设|修改|更改|更新)|(?:改|换|设|修改|更改|更新).{0,10}(?:标题|事项内容|事项名称)/.test(text)
  const hasTypeInstruction = /(?:改|换|设|调整|变).{0,10}(?:待办|日程|截止)|(?:待办|日程|截止).{0,10}(?:类型|事项)/.test(text)
  const hasLocationInstruction = /(?:地点|位置|地址).{0,10}(?:改|换|设|清空|删除|去掉|取消)|(?:改|换|设|清空|删除|去掉|取消).{0,10}(?:地点|位置|地址)/.test(text)
  const pointTimeRange = /(?:上午|下午|晚上|今晚|中午|早上|凌晨)?\s*(?:\d{1,2}|[零〇一二两三四五六七八九十]{1,3})\s*(?:点|时)(?:\s*(?:\d{1,2}分?|半))?\s*(?:到|至|[-~])\s*(?:上午|下午|晚上|今晚|中午|早上|凌晨)?\s*(?:\d{1,2}|[零〇一二两三四五六七八九十]{1,3})\s*(?:点|时)(?:\s*(?:\d{1,2}分?|半))?/.test(text)
  const colonTimeRange = /\d{1,2}[:：]\d{2}\s*(?:到|至|[-~])\s*\d{1,2}[:：]\d{2}/.test(text)
  const hasTimeRange = pointTimeRange || colonTimeRange
  const hasEndInstruction = /结束(?:时间)?/.test(text) || hasTimeRange
  const hasDeadlineTimeInstruction = /截止(?:时间)?|截止到/.test(text)
  const hasStartInstruction = /开始(?:时间)?/.test(text)
  const hasPositiveStartInstruction = /(?:开始时间|开始).{0,8}(?:改|换|设|调整|变)|(?:改|换|设|调整|变).{0,8}(?:开始时间|开始)/.test(text)
  const hasPositiveEndInstruction = relevantClauses(text, ['结束时间', '结束']).some(clause => /(?:结束时间|结束).{0,8}(?:改|换|设|调整|变)|(?:改|换|设|调整|变).{0,8}(?:结束时间|结束)/.test(clause))
  const onlyEndTimeInstruction = /结束(?:时间)?/.test(text) && !hasStartInstruction && !hasTimeRange
  const hasGenericTimeNegation = isFieldNegated(text, ['时间'])
  const hasTypeNegation = isFieldNegated(text, ['类型', '待办', '日程', '截止事项']) || /(?:不要|别).{0,5}(?:改|换|设).{0,5}(?:待办|日程|截止事项)/.test(text)
  return result.filter((field) => {
    if (field === 'title') return hasTitleInstruction && !isFieldNegated(text, ['标题', '事项内容', '事项名称', '名称'])
    if (field === 'type') return hasTypeInstruction && !hasTypeNegation
    if (field === 'location') return hasLocationInstruction && !isFieldNegated(text, ['地点', '位置', '地址'])
    if (field === 'date') return hasDateExpression(text) && !isFieldNegated(text, ['日期', '日子'])
    if (field === 'time') {
      const timeNegated = isFieldNegated(text, ['开始时间', '开始', '截止时间']) || (hasGenericTimeNegation && !hasPositiveStartInstruction && !hasDeadlineTimeInstruction)
      return hasTimeExpression(text) && (!onlyEndTimeInstruction || hasDeadlineTimeInstruction) && !timeNegated
    }
    if (field === 'endTime') {
      const endTimeNegated = isFieldNegated(text, ['结束时间', '结束']) || (hasGenericTimeNegation && !hasPositiveEndInstruction)
      return hasTimeExpression(text) && hasEndInstruction && !hasDeadlineTimeInstruction && !endTimeNegated && (hasTimeRange || hasPositiveEndInstruction)
    }
    return false
  })
}

/**
 * 智能解析：优先通过云函数调用 DeepSeek，失败时降级为本地规则解析。
 * API Key 仅保存在云函数环境变量中，不会进入小程序包。
 */
async function aiParse(text, baseDate) {
  const raw = text.trim()
  if (!raw) {
    return { title: '', date: '', time: '', endTime: '', location: '', suggestedType: 'todo', recognized: false, warnings: [], source: 'fallback' }
  }

  try {
    const parsed = await callParseEvent(raw, baseDate)
    const ruleResult = hasRelativeDate(raw) ? parseClipboard(raw, baseDate) : null
    console.log('[AI Parser] 使用云函数解析:', raw)
    return {
      title: parsed.title || raw,
      date: ruleResult?.date || parsed.date || '',
      time: parsed.time || '',
      endTime: parsed.endTime || '',
      location: parsed.location || '',
      suggestedType: parsed.suggestedType || 'todo',
      recognized: Boolean(parsed.recognized || ruleResult?.recognized),
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      source: 'ai'
    }
  } catch (err) {
    console.warn('[AI Parser] 云端解析失败，降级为规则匹配:', err.message)
    const regexResult = parseClipboard(raw, baseDate)
    return { ...regexResult, warnings: ['智能解析不可用，已使用规则解析'], source: 'fallback' }
  }
}

/**
 * 编辑页语音修改：只返回本次指令明确提到的字段补丁。
 * 与 aiParse 的全量创建解析完全分离，调用失败时不会改动现有事项。
 */
async function aiParseEdit(text, baseDate, currentEvent) {
  const raw = text.trim()
  if (!raw) {
    return { title: '', date: '', time: '', endTime: '', location: '', suggestedType: '', mentionedFields: [], recognized: false, warnings: [], source: 'fallback' }
  }

  try {
    const parsed = await callParseEventEdit(raw, baseDate, currentEvent)
    let mentionedFields = filterEditFields(Array.isArray(parsed.mentionedFields) ? parsed.mentionedFields : [], raw)
    const explicitlyClearsLocation = /(?:清空|删除|去掉|取消).{0,8}(?:地点|位置|地址)|(?:地点|位置|地址).{0,8}(?:清空|删除|去掉|取消)/.test(raw)
    if (mentionedFields.includes('location') && !parsed.location && !explicitlyClearsLocation) {
      mentionedFields = mentionedFields.filter(field => field !== 'location')
    }
    const ruleResult = mentionedFields.includes('date') && hasRelativeDate(raw)
      ? parseClipboard(raw, baseDate)
      : null
    console.log('[AI Parser] 使用云函数解析修改指令:', raw, mentionedFields)
    return {
      title: mentionedFields.includes('title') ? (parsed.title || '') : '',
      date: mentionedFields.includes('date') ? (ruleResult?.date || parsed.date || '') : '',
      time: mentionedFields.includes('time') ? (parsed.time || '') : '',
      endTime: mentionedFields.includes('endTime') ? (parsed.endTime || '') : '',
      location: mentionedFields.includes('location') ? (parsed.location || '') : '',
      suggestedType: mentionedFields.includes('type') ? (parsed.suggestedType || '') : '',
      mentionedFields,
      recognized: mentionedFields.length > 0,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      source: 'ai'
    }
  } catch (err) {
    console.warn('[AI Parser] 修改指令解析失败，保留原事项:', err.message)
    return {
      title: '',
      date: '',
      time: '',
      endTime: '',
      location: '',
      suggestedType: '',
      mentionedFields: [],
      recognized: false,
      warnings: ['智能修改不可用，未改动原事项'],
      error: err.message,
      source: 'fallback'
    }
  }
}

module.exports = { aiParse, aiParseEdit }
