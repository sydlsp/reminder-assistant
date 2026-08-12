const { getEvents, initializeEvents, upsertEvent, deleteEvent, getScheduleConflicts } = require('../../utils/events')
const { dateString, timeString, displayDate, localDate } = require('../../utils/date')
const { aiParse, aiParseEdit } = require('../../utils/aiParser')
const { registerReminder, cancelReminders } = require('../../utils/reminder')

function timeToMinutes(value) {
  const [hour, minute] = (value || '00:00').split(':').map(Number)
  return hour * 60 + minute
}

function normalizeStartTime(value) {
  return timeToMinutes(value) >= 23 * 60 + 59 ? '23:58' : value
}

function minutesToTime(value) {
  const minutes = Math.min(Math.max(value, 0), 23 * 60 + 59)
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

function minimumEndTime(startTime) {
  return minutesToTime(timeToMinutes(startTime) + 1)
}

function defaultEndTime(startTime) {
  return minutesToTime(timeToMinutes(startTime) + 60)
}

function isEndTimeAfter(startTime, endTime) {
  return timeToMinutes(endTime) > timeToMinutes(startTime)
}

Page({
  data: {
    editId: '',
    isEdit: false,
    isCompleted: false,
    showPreview: false,
    showEditForm: false,
    type: 'todo',
    typeOptions: [
      { label: '待办', value: 'todo', desc: '无明确时间' },
      { label: '日程', value: 'event', desc: '有明确时段' },
      { label: '截止', value: 'deadline', desc: '有截止时间' }
    ],
    typeIndex: 0,
    title: '',
    date: dateString(),
    time: timeString(),
    endTime: timeString(),
    endTimeMin: '00:01',
    remindBefore: 10,
    overdueReminder: true,
    reminderOptions: [0,1,5, 10, 15, 30, 60],
    reminderIndex: 2,
    source: 'manual',
    originalText: '',
    location: '',
    loadingClipboard: false,
    loadingParse: false,
    isRecording: false,
    voiceProcessing: false,
    voiceTranscript: '',
    voiceHint: '点击开始，说出日期、时间和事项',
    voiceChangeSummary: '',
    editorReady: false,
    saving: false,
    showReminderSetup: false,
    savedEventId: '',
    settingReminder: false,
    // 预览摘要
    previewTypeLabel: '',
    previewDateLabel: '',
    previewTimeLabel: ''
  },

  async onLoad(options) {
    const initialTime = this.data.time
    const isEdit = Boolean(options.id)
    this.setData({
      isEdit,
      date: options.date || this.data.date,
      endTime: defaultEndTime(initialTime),
      endTimeMin: minimumEndTime(initialTime),
      voiceHint: isEdit
        ? '说出要修改的内容，未提到的字段会保留'
        : this.data.voiceHint
    })
    this.setupVoiceRecognition()
    try {
      await initializeEvents()
    } catch (err) {
      console.warn('[Events] 云端事项初始化失败:', err.message)
      wx.showToast({ title: '云端数据加载失败，请返回重试', icon: 'none' })
      return
    }
    if (options.id) {
      this.loadEvent(options.id)
    } else if (options.importClipboard === '1') {
      this.setData({ editorReady: true })
      this.readClipboard()
    } else {
      this.setData({ showEditForm: true, editorReady: true })
    }
  },

  setupVoiceRecognition() {
    if (!wx.getRecorderManager) {
      this.setData({ voiceHint: '当前微信版本不支持语音录制' })
      return
    }
    const manager = wx.getRecorderManager()
    manager.onStart(() => {
      this.setData({
        isRecording: true,
        voiceTranscript: '',
        voiceChangeSummary: '',
        voiceHint: '正在聆听，再次点击即可结束'
      })
    })
    manager.onStop(({ tempFilePath, fileSize } = {}) => {
      const shouldDiscard = this.discardVoiceResult
      this.discardVoiceResult = false
      this.setData({ isRecording: false })

      if (shouldDiscard) {
        this.setData({
          voiceProcessing: false,
          voiceTranscript: '',
          voiceHint: '已取消，点击可重新开始'
        })
        return
      }
      if (!tempFilePath || !fileSize) {
        this.setData({ voiceProcessing: false, voiceHint: '录音内容为空，请再试一次' })
        wx.showToast({ title: '没有录到声音', icon: 'none' })
        return
      }
      if (fileSize > 2 * 1024 * 1024) {
        this.setData({ voiceProcessing: false, voiceHint: '录音文件过大，请缩短后重试' })
        wx.showToast({ title: '录音时间过长', icon: 'none' })
        return
      }
      this.recognizeVoiceFile(tempFilePath)
    })
    manager.onError((error) => {
      console.warn('[Voice] 录音失败:', error)
      this.discardVoiceResult = false
      this.setData({
        isRecording: false,
        voiceProcessing: false,
        voiceHint: '录音失败，请检查麦克风权限'
      })
      wx.showToast({ title: '录音失败', icon: 'none' })
    })
    this.voiceRecognitionManager = manager
  },

  toggleVoiceInput() {
    if (this.data.isRecording) {
      this.stopVoiceInput()
      return
    }
    this.startVoiceInput()
  },

  async startVoiceInput() {
    if (!this.voiceRecognitionManager || !this.data.editorReady || this.data.voiceProcessing) {
      if (!this.voiceRecognitionManager) wx.showToast({ title: '语音功能尚未就绪', icon: 'none' })
      else if (!this.data.editorReady) wx.showToast({ title: '正在加载事项，请稍候', icon: 'none' })
      return
    }

    const allowed = await this.ensureRecordPermission()
    if (!allowed) return
    this.discardVoiceResult = false
    try {
      this.voiceRecognitionManager.start({
        duration: 60000,
        sampleRate: 16000,
        numberOfChannels: 1,
        encodeBitRate: 48000,
        format: 'mp3',
        frameSize: 50
      })
    } catch (error) {
      console.warn('[Voice] 无法开始录音:', error)
      this.setData({ isRecording: false, voiceHint: '无法开始录音，请稍后重试' })
      wx.showToast({ title: '无法开始录音', icon: 'none' })
    }
  },

  stopVoiceInput() {
    if (!this.voiceRecognitionManager || !this.data.isRecording) return
    this.setData({ voiceProcessing: true, voiceHint: '正在识别语音…' })
    this.voiceRecognitionManager.stop()
  },

  cancelVoiceInput() {
    if (!this.voiceRecognitionManager || !this.data.isRecording) return
    this.discardVoiceResult = true
    this.voiceRecognitionManager.stop()
  },

  recognizeVoiceFile(tempFilePath) {
    this.setData({ voiceProcessing: true, voiceHint: '正在将语音转成文字…' })
    const fs = wx.getFileSystemManager()
    fs.readFile({
      filePath: tempFilePath,
      encoding: 'base64',
      success: ({ data }) => {
        wx.cloud.callFunction({
          name: 'speechToText',
          data: { audioBase64: data, voiceFormat: 'mp3' }
        }).then(({ result }) => {
          if (!result || result.error) throw new Error(result?.error || '语音识别没有返回结果')
          const text = (result.text || '').trim()
          if (!text) throw new Error('没有识别到语音内容')
          this.setData({ voiceTranscript: text })
          return this.parseVoiceText(text)
        }).catch((error) => {
          console.warn('[Voice] 语音转文字失败:', error)
          this.setData({ voiceProcessing: false, voiceHint: error.message || '语音识别失败，请稍后重试' })
          wx.showToast({ title: '语音识别失败', icon: 'none' })
        })
      },
      fail: (error) => {
        console.warn('[Voice] 无法读取录音文件:', error)
        this.setData({ voiceProcessing: false, voiceHint: '无法读取录音，请重试' })
        wx.showToast({ title: '无法读取录音', icon: 'none' })
      }
    })
  },

  ensureRecordPermission() {
    return new Promise((resolve) => {
      wx.getSetting({
        success: ({ authSetting }) => {
          if (authSetting['scope.record']) {
            resolve(true)
            return
          }
          if (authSetting['scope.record'] === false) {
            wx.showModal({
              title: '需要麦克风权限',
              content: `开启录音权限后，才能使用语音${this.data.isEdit ? '修改' : '添加'}事项。`,
              confirmText: '去设置',
              success: ({ confirm }) => {
                if (!confirm) {
                  resolve(false)
                  return
                }
                wx.openSetting({
                  success: ({ authSetting: nextSetting }) => resolve(Boolean(nextSetting['scope.record'])),
                  fail: () => resolve(false)
                })
              },
              fail: () => resolve(false)
            })
            return
          }
          wx.authorize({
            scope: 'scope.record',
            success: () => resolve(true),
            fail: () => resolve(false)
          })
        },
        fail: () => resolve(false)
      })
    })
  },

  async parseVoiceText(text) {
    if (this.data.isEdit) {
      await this.parseVoiceEditText(text)
      return
    }

    this.setData({
      title: text,
      voiceTranscript: text,
      voiceProcessing: true,
      voiceHint: '已转成文字，正在智能解析…'
    })
    try {
      const parsed = await aiParse(text, this.data.date)
      this.applyParse(parsed, { source: 'voice', originalText: text })
      this.setData({
        voiceHint: parsed.recognized ? '解析完成，请确认后保存' : '未识别到时间，请手动确认'
      })
      wx.showToast({
        title: parsed.recognized ? '语音解析完成' : '已转为待办，请确认',
        icon: parsed.recognized ? 'success' : 'none'
      })
    } catch (error) {
      console.warn('[Voice] 智能解析失败:', error)
      this.setData({ showEditForm: true, voiceHint: '解析失败，已保留识别文字' })
      wx.showToast({ title: '解析失败，请手动填写', icon: 'none' })
    } finally {
      this.setData({ voiceProcessing: false })
    }
  },

  async parseVoiceEditText(text) {
    const currentEvent = {
      title: this.data.title,
      type: this.data.type,
      date: this.data.date,
      time: this.data.time,
      endTime: this.data.endTime,
      location: this.data.location
    }
    this.setData({
      voiceTranscript: text,
      voiceChangeSummary: '',
      voiceProcessing: true,
      voiceHint: '已转成文字，正在分析要修改的内容…'
    })

    try {
      const parsed = await aiParseEdit(text, this.data.date, currentEvent)
      const { changedFields, notes } = this.applyVoiceEditPatch(parsed)

      if (changedFields.length) {
        const summary = `已修改：${changedFields.join('、')}`
        this.setData({
          voiceChangeSummary: summary,
          voiceHint: notes.length ? `${summary}；${notes[0]}` : `${summary}，请确认后更新`
        })
        wx.showToast({ title: '已合并语音修改', icon: 'success' })
      } else {
        const message = parsed.error
          ? '智能修改暂不可用，原事项未改动'
          : (notes[0] || '没有识别到明确修改，原事项未改动')
        this.setData({ voiceHint: message, voiceChangeSummary: '' })
        wx.showToast({ title: message, icon: 'none' })
      }
    } catch (error) {
      console.warn('[Voice] 修改指令解析失败:', error)
      this.setData({
        showEditForm: true,
        voiceChangeSummary: '',
        voiceHint: '解析失败，原事项未改动'
      })
      wx.showToast({ title: '解析失败，未修改原事项', icon: 'none' })
    } finally {
      this.setData({ voiceProcessing: false })
    }
  },

  applyVoiceEditPatch(parsed) {
    const fieldLabels = {
      title: '事项内容',
      type: '事务类型',
      date: '日期',
      time: this.data.type === 'deadline' ? '截止时间' : '开始时间',
      endTime: '结束时间',
      location: '地点'
    }
    const allowedFields = new Set(Object.keys(fieldLabels))
    let fields = Array.isArray(parsed.mentionedFields)
      ? [...new Set(parsed.mentionedFields.filter(field => allowedFields.has(field)))]
      : []
    const changedFields = []
    const notes = Array.isArray(parsed.warnings) ? [...parsed.warnings] : []
    const setData = { showEditForm: true }

    let nextType = this.data.type
    if (fields.includes('type')) {
      const typeIndex = this.data.typeOptions.findIndex(option => option.value === parsed.suggestedType)
      if (typeIndex >= 0) {
        const requestedType = parsed.suggestedType
        const needsScheduleDetails = this.data.type === 'todo' && requestedType !== 'todo'
        const hasRequiredDetails = fields.includes('date') && fields.includes('time') && parsed.date && parsed.time
        const hasInvalidRequestedRange = requestedType === 'event' && fields.includes('time') && fields.includes('endTime') && parsed.time && parsed.endTime && !isEndTimeAfter(normalizeStartTime(parsed.time), parsed.endTime)
        if ((needsScheduleDetails && !hasRequiredDetails) || hasInvalidRequestedRange) {
          notes.push(hasInvalidRequestedRange
            ? '结束时间必须晚于开始时间，事务类型和时间均未修改'
            : '从待办改为日程或截止事项时，请同时说出日期和时间')
          fields = fields.filter(field => !['type', 'date', 'time', 'endTime'].includes(field))
        } else {
          nextType = requestedType
          setData.type = nextType
          setData.typeIndex = typeIndex
          if (nextType !== this.data.type) changedFields.push(fieldLabels.type)
        }
      }
    }

    if (fields.includes('title') && parsed.title && parsed.title !== this.data.title) {
      setData.title = parsed.title
      changedFields.push(fieldLabels.title)
    }
    if (fields.includes('location') && parsed.location !== this.data.location) {
      // 空字符串也是有效补丁，用于“清空地点”。
      setData.location = parsed.location || ''
      changedFields.push(fieldLabels.location)
    }

    const supportsDateTime = nextType === 'event' || nextType === 'deadline'
    if (!supportsDateTime && fields.some(field => ['date', 'time', 'endTime'].includes(field))) {
      notes.push('待办不使用日期时间，如需安排时间请同时说“改为日程”或“改为截止事项”')
    }

    if (supportsDateTime && fields.includes('date') && parsed.date && parsed.date !== this.data.date) {
      setData.date = parsed.date
      changedFields.push(fieldLabels.date)
    }

    if (nextType === 'deadline') {
      if (fields.includes('time') && parsed.time && parsed.time !== this.data.time) {
        setData.time = parsed.time
        changedFields.push('截止时间')
      }
      if (fields.includes('endTime')) {
        notes.push('截止事项没有结束时间，该字段已保留原值')
      }
    } else if (nextType === 'event') {
      const transitioningToEvent = this.data.type !== 'event'
      const wantsTime = fields.includes('time') && Boolean(parsed.time)
      const wantsEndTime = fields.includes('endTime') && Boolean(parsed.endTime)
      const nextTime = wantsTime ? normalizeStartTime(parsed.time) : this.data.time
      const nextEndTime = wantsEndTime
        ? parsed.endTime
        : (transitioningToEvent ? defaultEndTime(nextTime) : this.data.endTime)

      if (transitioningToEvent && !wantsTime && timeToMinutes(nextTime) >= 23 * 60 + 59) {
        delete setData.type
        delete setData.typeIndex
        const typeLabelIndex = changedFields.indexOf(fieldLabels.type)
        if (typeLabelIndex >= 0) changedFields.splice(typeLabelIndex, 1)
        notes.push('当前时间无法形成有效日程，请同时说出新的开始时间')
      } else if (wantsTime && wantsEndTime && !isEndTimeAfter(nextTime, nextEndTime)) {
        notes.push('结束时间必须晚于开始时间，本次时间修改未应用')
      } else {
        if (wantsTime && nextTime !== this.data.time) {
          setData.time = nextTime
          changedFields.push('开始时间')
        }
        if (wantsEndTime) {
          if (isEndTimeAfter(nextTime, nextEndTime)) {
            if (nextEndTime !== this.data.endTime) {
              setData.endTime = nextEndTime
              changedFields.push(fieldLabels.endTime)
            }
          } else {
            notes.push('结束时间必须晚于开始时间，已保留原结束时间')
          }
        } else if (wantsTime && (transitioningToEvent || !isEndTimeAfter(nextTime, this.data.endTime))) {
          setData.endTime = defaultEndTime(nextTime)
          changedFields.push('结束时间（自动设置）')
          notes.push(transitioningToEvent
            ? '已将结束时间设为开始时间 1 小时后'
            : '原结束时间早于新开始时间，已自动顺延 1 小时')
        }
        if (wantsTime) setData.endTimeMin = minimumEndTime(nextTime)
      }
    }

    this.setData(setData, () => this.buildPreview())
    return { changedFields, notes }
  },

  loadEvent(id) {
    const event = getEvents().find(e => e.id === id)
    if (!event) return
    const typeIndex = this.data.typeOptions.findIndex(o => o.value === (event.type || 'event'))
    const start = event.startAt ? new Date(event.startAt) : null
    const end = event.endAt ? new Date(event.endAt) : null
    const dl = event.deadline ? new Date(event.deadline) : null
    const reminderIndex = this.data.reminderOptions.indexOf(event.remindBefore ?? 10)

    const d = event.type === 'event' && start ? dateString(start)
      : event.type === 'deadline' && dl ? dateString(dl) : this.data.date
    const t = start ? normalizeStartTime(timeString(start)) : dl ? timeString(dl) : timeString()

    this.setData({
      editId: id,
      isEdit: true,
      isCompleted: event.status === 'done',
      showReminderSetup: false,
      savedEventId: '',
      showPreview: false,
      showEditForm: true,
      type: event.type || 'event',
      typeIndex: typeIndex >= 0 ? typeIndex : 1,
      title: event.title || '',
      date: d,
      time: t,
      endTime: end && isEndTimeAfter(t, timeString(end)) ? timeString(end) : defaultEndTime(t),
      endTimeMin: minimumEndTime(t),
      remindBefore: event.remindBefore ?? 10,
      overdueReminder: event.overdueReminder !== false,
      reminderIndex: reminderIndex >= 0 ? reminderIndex : 2,
      source: event.source || 'manual',
      originalText: event.originalText || '',
      location: event.location || '',
      voiceTranscript: '',
      voiceChangeSummary: '',
      voiceHint: '说出要修改的内容，未提到的字段会保留',
      editorReady: true
    }, () => this.buildPreview())
  },

  readClipboard() {
    if (!this.data.editorReady || this.data.isRecording || this.data.voiceProcessing) {
      wx.showToast({ title: this.data.editorReady ? '请等待语音解析完成' : '正在加载事项，请稍候', icon: 'none' })
      return
    }
    this.setData({ loadingClipboard: true, loadingParse: true })
    wx.getClipboardData({
      success: async ({ data }) => {
        if (!data || !data.trim()) {
          wx.showToast({ title: '剪贴板没有文字', icon: 'none' })
          return
        }
        const parsed = await aiParse(data, this.data.date)
        this.applyParse(parsed, { source: 'clipboard', originalText: data })
        if (parsed.source === 'fallback') {
          wx.showToast({ title: '智能服务不可用，已规则解析', icon: 'none' })
        } else {
          wx.showToast({ title: parsed.recognized ? '已智能解析，请确认' : '未识别时间，请手动填写', icon: parsed.recognized ? 'success' : 'none' })
        }
      },
      fail: () => wx.showToast({ title: '无法读取剪贴板', icon: 'none' }),
      complete: () => this.setData({ loadingClipboard: false, loadingParse: false })
    })
  },

  async parseTitle() {
    if (!this.data.editorReady || this.data.isRecording || this.data.voiceProcessing) {
      wx.showToast({ title: this.data.editorReady ? '请等待语音解析完成' : '正在加载事项，请稍候', icon: 'none' })
      return
    }
    const text = this.data.title.trim()
    if (!text) {
      wx.showToast({ title: '请先输入事项内容', icon: 'none' })
      return
    }
    this.setData({ loadingParse: true })
    const parsed = await aiParse(text, this.data.date)
    this.setData({ loadingParse: false })
    this.applyParse(parsed, { source: 'manual' })
    if (parsed.source === 'fallback') {
      wx.showToast({ title: '智能服务不可用，已规则解析', icon: 'none' })
    } else if (parsed.recognized) {
      wx.showToast({ title: '已智能解析，请确认', icon: 'success' })
    } else {
      wx.showToast({ title: '未识别到时间，已设为待办', icon: 'none' })
    }
  },

  applyParse(parsed, extra) {
    const typeIndex = this.data.typeOptions.findIndex(o => o.value === parsed.suggestedType)
    const parsedStartTime = normalizeStartTime(parsed.time || this.data.time)
    const parsedEndTime = parsed.endTime || this.data.endTime
    const validParsedEndTime = isEndTimeAfter(parsedStartTime, parsedEndTime)
    const setData = {
      title: parsed.title,
      date: parsed.date,
      time: parsedStartTime,
      type: parsed.suggestedType,
      typeIndex: typeIndex >= 0 ? typeIndex : 0,
      showPreview: true,
      showEditForm: false,
      ...extra
    }
    if (parsed.suggestedType === 'event') {
      setData.endTime = validParsedEndTime ? parsedEndTime : defaultEndTime(parsedStartTime)
      setData.endTimeMin = minimumEndTime(parsedStartTime)
    } else if (parsed.endTime) {
      setData.endTime = parsed.endTime
    }
    if (parsed.location) setData.location = parsed.location
    this.setData(setData, () => this.buildPreview())
  },

  buildPreview() {
    const { type, typeOptions, typeIndex, title, date, time, endTime, remindBefore } = this.data
    const typeLabel = typeOptions[typeIndex].label
    let dateLabel = displayDate(localDate(date, '00:00'))
    let timeLabel = ''

    if (type === 'event') {
      timeLabel = endTime ? `${time} ~ ${endTime}` : time
    } else if (type === 'deadline') {
      timeLabel = `截止 ${time}`
    }

    if (type === 'todo') {
      dateLabel = '无截止时间'
    }

    this.setData({
      previewTypeLabel: typeLabel,
      previewDateLabel: dateLabel,
      previewTimeLabel: timeLabel
    })
  },

  onLocationInput(event) { this.setData({ location: event.detail.value }) },

  toggleEditForm() {
    this.setData({ showEditForm: !this.data.showEditForm })
  },

  onTypeChange(event) {
    const typeIndex = Number(event.detail.value)
    const type = this.data.typeOptions[typeIndex].value
    const setData = {
      typeIndex,
      type
    }
    if (type === 'event') {
      const startTime = normalizeStartTime(this.data.time)
      setData.time = startTime
      setData.endTimeMin = minimumEndTime(startTime)
      if (!isEndTimeAfter(startTime, this.data.endTime)) {
        setData.endTime = defaultEndTime(startTime)
      }
    }
    this.setData(setData, () => this.buildPreview())
  },

  onTitleInput(event) { this.setData({ title: event.detail.value }) },
  onDateChange(event) {
    this.setData({ date: event.detail.value }, () => this.buildPreview())
  },
  onTimeChange(event) {
    const time = normalizeStartTime(event.detail.value)
    const setData = { time }
    if (this.data.type === 'event') {
      setData.endTimeMin = minimumEndTime(time)
      if (!isEndTimeAfter(time, this.data.endTime)) {
        setData.endTime = defaultEndTime(time)
        wx.showToast({ title: '结束时间已自动顺延 1 小时', icon: 'none' })
      }
    }
    this.setData(setData, () => this.buildPreview())
  },
  onEndTimeChange(event) {
    const endTime = event.detail.value
    if (this.data.type === 'event' && !isEndTimeAfter(this.data.time, endTime)) {
      this.setData({ endTime: defaultEndTime(this.data.time) }, () => this.buildPreview())
      wx.showToast({ title: '结束时间已恢复为开始时间 1 小时后', icon: 'none' })
      return
    }
    this.setData({ endTime }, () => this.buildPreview())
  },
  onReminderChange(event) {
    const reminderIndex = Number(event.detail.value)
    this.setData({
      reminderIndex,
      remindBefore: this.data.reminderOptions[reminderIndex]
    })
  },
  onOverdueReminderChange(event) {
    this.setData({ overdueReminder: event.detail.value })
  },

  onHide() {
    if (this.data.isRecording) {
      this.discardVoiceResult = true
      this.voiceRecognitionManager?.stop()
    }
  },

  onUnload() {
    if (this.data.isRecording) {
      this.discardVoiceResult = true
      this.voiceRecognitionManager?.stop()
    }
  },
  onCompletedChange(event) {
    this.setData({ isCompleted: event.detail.value })
  },

  async save() {
    if (!this.data.editorReady || this.data.saving || this.data.isRecording || this.data.voiceProcessing) {
      if (!this.data.editorReady) {
        wx.showToast({ title: '正在加载事项，请稍候', icon: 'none' })
        return
      }
      if (this.data.isRecording || this.data.voiceProcessing) {
        wx.showToast({ title: '请等待语音解析完成', icon: 'none' })
      }
      return
    }
    const { editId, type, title, date, time, endTime, remindBefore, overdueReminder, isCompleted, source, originalText, location } = this.data
    if (!title.trim()) {
      wx.showToast({ title: '请填写事项内容', icon: 'none' })
      return
    }
    if (type === 'event' && localDate(date, endTime) <= localDate(date, time)) {
      wx.showToast({ title: '结束时间必须晚于开始时间', icon: 'none' })
      return
    }

    const previous = editId ? getEvents().find(event => event.id === editId) : null
    const base = {
      id: editId || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title: title.trim(),
      type,
      location,
      remindBefore,
      overdueReminder: type === 'deadline' && overdueReminder,
      source,
      originalText,
      status: isCompleted ? 'done' : 'pending',
      createdAt: previous?.createdAt || new Date().toISOString()
    }

    if (type === 'event') {
      base.startAt = localDate(date, time).toISOString()
      base.endAt = localDate(date, endTime).toISOString()
    } else if (type === 'deadline') {
      base.deadline = localDate(date, time).toISOString()
    }

    const conflicts = getScheduleConflicts(base)
    if (conflicts.length) {
      this.setData({ saving: true })
      const confirmed = await this.confirmScheduleConflicts(conflicts)
      if (!confirmed) {
        this.setData({ saving: false })
        return
      }
    } else {
      this.setData({ saving: true })
    }

    try {
      // 编辑、完成或删除过的旧版本可能存在多条提醒，先统一取消，避免重复或错时提醒。
      if (previous) await cancelReminders(base.id, previous.reminderId, previous.reminderIds || [])
      await upsertEvent(base)

      const reminderPlan = this.getReminderPlan(base)
      if (base.status !== 'done' && reminderPlan.tmplIds.length) {
        this.setData({ showReminderSetup: true, savedEventId: base.id })
        wx.showToast({ title: '已保存，请设置提醒', icon: 'none' })
        return
      }

      wx.showToast({ title: editId ? '已更新事项' : '已加入日程', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 450)
    } finally {
      this.setData({ saving: false })
    }
  },

  confirmScheduleConflicts(conflicts) {
    const summaries = conflicts.slice(0, 2).map((event) => {
      const start = timeString(new Date(event.startAt))
      const end = timeString(new Date(event.endAt))
      return `「${event.title}」 ${start}–${end}`
    })
    const more = conflicts.length > 2 ? `\n另有 ${conflicts.length - 2} 项重叠日程` : ''

    return new Promise((resolve) => wx.showModal({
      title: `发现 ${conflicts.length} 个时间冲突`,
      content: `与以下日程重叠：\n${summaries.join('\n')}${more}`,
      cancelText: '返回修改',
      confirmText: '仍然保存',
      confirmColor: '#176b55',
      success: (res) => resolve(res.confirm),
      fail: () => resolve(false)
    }))
  },

  getReminderPlan(base) {
    const { reminderTmplId, overdueTmplId } = getApp().globalData
    const needsAdvance = base.type !== 'todo' && base.remindBefore > 0 && Boolean(reminderTmplId)
    let needsOverdue = base.type === 'deadline' && base.overdueReminder && Boolean(overdueTmplId)

    if (needsAdvance && needsOverdue && reminderTmplId === overdueTmplId) {
      console.warn('[Reminder] 提前提醒与逾期提醒不能共用同一一次性订阅模板，已跳过逾期提醒')
      needsOverdue = false
    }
    return {
      needsAdvance,
      needsOverdue,
      tmplIds: [needsAdvance && reminderTmplId, needsOverdue && overdueTmplId].filter(Boolean),
      reminderTmplId,
      overdueTmplId
    }
  },

  // 此方法必须由 setupReminder 的直接点击同步调用，不能在 await 之后调用。
  requestReminders(base, plan) {
    if (!plan.tmplIds.length) return Promise.resolve([])
    return new Promise((resolve) => wx.requestSubscribeMessage({
      tmplIds: plan.tmplIds,
      success: async (res) => {
        const ids = await Promise.all([
          plan.needsAdvance && res[plan.reminderTmplId] === 'accept'
            ? registerReminder(base, plan.reminderTmplId, 'advance') : null,
          plan.needsOverdue && res[plan.overdueTmplId] === 'accept'
            ? registerReminder(base, plan.overdueTmplId, 'overdue') : null
        ])
        resolve(ids.filter(Boolean))
      },
      fail: (err) => {
        console.log('[Reminder] 订阅授权失败:', err.errMsg)
        resolve([])
      }
    }))
  },

  setupReminder() {
    if (this.data.settingReminder) return
    const event = getEvents().find(item => item.id === this.data.savedEventId)
    if (!event || event.status === 'done') {
      wx.showToast({ title: '事项状态已变化', icon: 'none' })
      return
    }
    const plan = this.getReminderPlan(event)
    if (!plan.tmplIds.length) {
      wx.showToast({ title: '没有可用的提醒模板', icon: 'none' })
      return
    }

    // requestReminders 在这里立即执行，保持在用户 tap 手势的同步调用链中。
    const reminderRequest = this.requestReminders(event, plan)
    this.setData({ settingReminder: true })
    reminderRequest.then(async (reminderIds) => {
      if (!reminderIds.length) {
        wx.showToast({ title: '未设置提醒，可稍后重试', icon: 'none' })
        return
      }
      await upsertEvent({ ...event, reminderId: reminderIds[0], reminderIds })
      this.setData({ showReminderSetup: false })
      wx.showToast({ title: '已设置提醒', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 450)
    }).catch((err) => {
      console.warn('[Reminder] 设置提醒异常:', err.message)
      wx.showToast({ title: '设置提醒失败', icon: 'none' })
    }).finally(() => this.setData({ settingReminder: false }))
  },

  skipReminder() {
    wx.navigateBack()
  },

  noop() {},

  removeItem() {
    if (!this.data.editorReady || this.data.isRecording || this.data.voiceProcessing) {
      wx.showToast({ title: this.data.editorReady ? '请等待语音解析完成' : '正在加载事项，请稍候', icon: 'none' })
      return
    }
    wx.showModal({
      title: '确认删除',
      content: '删除后无法恢复',
      confirmText: '删除',
      confirmColor: '#d45252',
      success: async (res) => {
        if (!res.confirm) return
        const event = getEvents().find(item => item.id === this.data.editId)
        await deleteEvent(this.data.editId)
        await cancelReminders(this.data.editId, event?.reminderId, event?.reminderIds || [])
        wx.showToast({ title: '已删除', icon: 'success' })
        setTimeout(() => wx.navigateBack(), 350)
      }
    })
  }
})
