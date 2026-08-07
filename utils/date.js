function pad(value) {
  return String(value).padStart(2, '0')
}

function dateString(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function timeString(date = new Date()) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function weekday(date = new Date()) {
  return ['日', '一', '二', '三', '四', '五', '六'][date.getDay()]
}

function isSameDay(first, second) {
  return dateString(first) === dateString(second)
}

function displayTime(iso) {
  return timeString(new Date(iso))
}

function displayDate(date) {
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日 · 星期${weekday(date)}`
}

const WD = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0 }

function parseClipboard(text) {
  const now = new Date()
  const raw = text.replace(/\s+/g, ' ').trim()
  const parsed = new Date(now)
  let matchedDate = false
  let matchedTime = false
  let hour = 9
  let minute = 0
  let endHour = null
  let endMinute = null
  let cleanedTitle = raw

  /* ======== 1. 日期识别 ======== */

  // 大后天 / 后天 / 明天 / 今天
  const relDay = raw.match(/大后天|后天|明天|明日|今天|今日/)
  if (relDay) {
    const map = { '大后天': 3, '后天': 2, '明天': 2, '明日': 2, '今天': 0, '今日': 0 }
    parsed.setDate(parsed.getDate() + (map[relDay[0]] || 0))
    matchedDate = true
    cleanedTitle = cleanedTitle.replace(relDay[0], '')
  }

  // 下周X
  if (!matchedDate) {
    const m = raw.match(/下周([一二三四五六日天])/)
    if (m) {
      const target = WD[m[1]]
      const daysUntil = (7 - now.getDay() + target) % 7 || 7
      parsed.setDate(parsed.getDate() + daysUntil)
      matchedDate = true
      cleanedTitle = cleanedTitle.replace(m[0], '')
    }
  }

  // 周X（本周）
  if (!matchedDate) {
    const m = raw.match(/(?:本|这)?周([一二三四五六日天])/)
    if (m) {
      const target = WD[m[1]]
      let daysUntil = target - now.getDay()
      if (daysUntil <= 0) daysUntil += 7
      parsed.setDate(parsed.getDate() + daysUntil)
      matchedDate = true
      cleanedTitle = cleanedTitle.replace(m[0], '')
    }
  }

  // X天后
  if (!matchedDate) {
    const m = raw.match(/(\d+)天后/)
    if (m) {
      parsed.setDate(parsed.getDate() + Number(m[1]))
      matchedDate = true
      cleanedTitle = cleanedTitle.replace(m[0], '')
    }
  }

  // 下个月X号/日
  if (!matchedDate) {
    const m = raw.match(/下个?月(\d{1,2})[号日]/)
    if (m) {
      parsed.setMonth(parsed.getMonth() + 1, Number(m[1]))
      matchedDate = true
      cleanedTitle = cleanedTitle.replace(m[0], '')
    }
  }

  // X月X日/号
  if (!matchedDate) {
    const m = raw.match(/(\d{1,2})月(\d{1,2})[日号]?/)
    if (m) {
      parsed.setMonth(Number(m[1]) - 1, Number(m[2]))
      matchedDate = true
      cleanedTitle = cleanedTitle.replace(m[0], '')
    }
  }

  // 8.7 / 8/7 格式（不跟在年份后）
  if (!matchedDate) {
    const m = raw.match(/(?<!\d)(\d{1,2})[\.\/](\d{1,2})(?![\.\/\d])/)
    if (m && Number(m[1]) <= 12 && Number(m[2]) <= 31) {
      parsed.setMonth(Number(m[1]) - 1, Number(m[2]))
      matchedDate = true
      cleanedTitle = cleanedTitle.replace(m[0], '')
    }
  }

  /* ======== 2. 时间识别 — 优先匹配时间段 ======== */

  // 14:00-16:00 / 14:00~15:30 / 14:00至14:30
  const rangeMatch = raw.match(/(\d{1,2}):(\d{2})\s*[-~至到]\s*(\d{1,2}):(\d{2})/)
  if (rangeMatch) {
    hour = Number(rangeMatch[1])
    minute = Number(rangeMatch[2])
    endHour = Number(rangeMatch[3])
    endMinute = Number(rangeMatch[4])
    matchedTime = true
    cleanedTitle = cleanedTitle.replace(rangeMatch[0], '')
  }

  // 下午2点到4点 / 14点到16点 / 上午9点到11点半
  if (!matchedTime) {
    const tr = raw.match(/(?:上午|下午|晚上|中午)?\s*(\d{1,2})[点:：]\s*(?:半\s*)?[-~至到]\s*(?:上午|下午|晚上|中午)?\s*(\d{1,2})[点:：]\s*(半)?/)
    if (tr) {
      hour = Number(tr[1])
      endHour = Number(tr[2])
      endMinute = tr[3] ? 30 : 0
      const isPM = /下午|晚上|今晚/.test(raw)
      if (isPM && hour < 12) hour += 12
      if (isPM && endHour < 12) endHour += 12
      matchedTime = true
      cleanedTitle = cleanedTitle.replace(tr[0], '')
    }
  }

  // 单个时间：上午/下午/晚上/中午 X点/X:XX
  if (!matchedTime) {
    const tm = raw.match(/(?:上午|下午|晚上|中午)?\s*(\d{1,2})[点:：](\d{2})?/)
    if (tm) {
      hour = Number(tm[1])
      minute = Number(tm[2] || 0)
      if (/下午|晚上|今晚/.test(raw) && hour < 12) hour += 12
      if (/中午/.test(raw) && hour < 12) hour += 12
      matchedTime = true
      cleanedTitle = cleanedTitle.replace(tm[0], '')
    }
  }

  parsed.setHours(hour, minute, 0, 0)

  /* ======== 3. 结束时间 ======== */
  let endTimeStr = ''
  if (endHour !== null) {
    const endDate = new Date(parsed)
    endDate.setHours(endHour, endMinute, 0, 0)
    endTimeStr = timeString(endDate)
  }

  /* ======== 4. 类型推断 ======== */
  const hasRange = endHour !== null
  const isDeadline = /截止|ddl|deadline|到期|之前$|前完成|前提交|前交付/i.test(raw)

  let suggestedType = 'todo'
  if (hasRange) {
    suggestedType = 'event'
  } else if (matchedDate && matchedTime && !isDeadline) {
    suggestedType = 'event'
  } else if (isDeadline || matchedDate) {
    suggestedType = 'deadline'
  }

  /* ======== 5. 清理标题 ======== */
  cleanedTitle = cleanedTitle
    .replace(/[，,。\.！!；;：:？?\s]+$/, '')
    .replace(/^[，,。\.！!；;：:？?\s]+/, '')
    .trim()

  return {
    title: cleanedTitle || raw,
    date: dateString(parsed),
    time: timeString(parsed),
    endTime: endTimeStr,
    recognized: matchedDate || matchedTime,
    suggestedType
  }
}

function displayTimeRange(startIso, endIso) {
  return `${timeString(new Date(startIso))} - ${timeString(new Date(endIso))}`
}

module.exports = { dateString, timeString, weekday, isSameDay, displayTime, displayTimeRange, displayDate, parseClipboard }
