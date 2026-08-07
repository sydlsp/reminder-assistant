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

function parseClipboard(text) {
  const now = new Date()
  const normalized = text.replace(/\s+/g, ' ').trim()
  const parsed = new Date(now)
  let matchedDate = false

  if (/明天|明日/.test(normalized)) {
    parsed.setDate(parsed.getDate() + 1)
    matchedDate = true
  } else if (/后天/.test(normalized)) {
    parsed.setDate(parsed.getDate() + 2)
    matchedDate = true
  } else if (/今天|今日/.test(normalized)) {
    matchedDate = true
  }

  const dateMatch = normalized.match(/(\d{1,2})月(\d{1,2})[日号]?/)
  if (dateMatch) {
    parsed.setMonth(Number(dateMatch[1]) - 1, Number(dateMatch[2]))
    matchedDate = true
  }

  const timeMatch = normalized.match(/(?:上午|下午|晚上|中午)?\s*(\d{1,2})[点:：](\d{2})?/) 
  if (timeMatch) {
    let hour = Number(timeMatch[1])
    const minute = Number(timeMatch[2] || 0)
    if ((/下午|晚上/.test(normalized)) && hour < 12) hour += 12
    if (/中午/.test(normalized) && hour < 11) hour += 12
    parsed.setHours(hour, minute, 0, 0)
  } else {
    parsed.setHours(9, 0, 0, 0)
  }

  let suggestedType = 'todo'
  if (matchedDate && timeMatch) suggestedType = 'event'
  else if (matchedDate) suggestedType = 'deadline'

  return {
    title: normalized,
    date: dateString(parsed),
    time: timeString(parsed),
    recognized: matchedDate || Boolean(timeMatch),
    suggestedType
  }
}

function displayTimeRange(startIso, endIso) {
  return `${timeString(new Date(startIso))} - ${timeString(new Date(endIso))}`
}

module.exports = { dateString, timeString, weekday, isSameDay, displayTime, displayTimeRange, displayDate, parseClipboard }
