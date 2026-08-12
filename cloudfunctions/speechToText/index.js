const cloud = require('wx-server-sdk')
const tencentcloud = require('tencentcloud-sdk-nodejs')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const MAX_BASE64_BYTES = 3 * 1024 * 1024
const SUPPORTED_FORMATS = new Set(['mp3', 'wav', 'm4a', 'aac', 'amr', 'ogg-opus'])

function getCredential() {
  const configuredSecretId = process.env.ASR_SECRET_ID
  const configuredSecretKey = process.env.ASR_SECRET_KEY
  if (configuredSecretId && configuredSecretKey) {
    return { secretId: configuredSecretId, secretKey: configuredSecretKey }
  }

  const temporarySecretId = process.env.TENCENTCLOUD_SECRETID
  const temporarySecretKey = process.env.TENCENTCLOUD_SECRETKEY
  const temporaryToken = process.env.TENCENTCLOUD_SESSIONTOKEN
  if (temporarySecretId && temporarySecretKey) {
    return {
      secretId: temporarySecretId,
      secretKey: temporarySecretKey,
      token: temporaryToken
    }
  }

  throw new Error('请为云函数配置 ASR_SECRET_ID 和 ASR_SECRET_KEY')
}

exports.main = async (event) => {
  const { OPENID: userOpenId } = cloud.getWXContext()
  if (!userOpenId) return { error: '无法确认当前用户身份' }

  const audioBase64 = typeof event.audioBase64 === 'string' ? event.audioBase64 : ''
  const voiceFormat = SUPPORTED_FORMATS.has(event.voiceFormat) ? event.voiceFormat : 'mp3'
  if (!audioBase64) return { error: '录音数据为空' }

  const dataLen = Buffer.byteLength(audioBase64, 'base64')
  if (!dataLen || dataLen > MAX_BASE64_BYTES) return { error: '录音大小超出 3MB 限制' }

  try {
    const AsrClient = tencentcloud.asr.v20190614.Client
    const client = new AsrClient({
      credential: getCredential(),
      region: process.env.TENCENTCLOUD_REGION || 'ap-shanghai',
      profile: {
        httpProfile: { endpoint: 'asr.tencentcloudapi.com', reqTimeout: 15 }
      }
    })
    const response = await client.SentenceRecognition({
      EngSerViceType: '16k_zh',
      SourceType: 1,
      VoiceFormat: voiceFormat,
      Data: audioBase64,
      DataLen: dataLen,
      FilterModal: 1,
      FilterPunc: 0,
      ConvertNumMode: 1
    })
    return {
      text: (response.Result || '').trim(),
      duration: response.AudioDuration || 0,
      requestId: response.RequestId || ''
    }
  } catch (error) {
    console.error('[speechToText] 腾讯云语音识别失败:', error)
    return { error: error.message || '语音识别失败' }
  }
}
