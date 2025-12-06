const geminiKey = (
  (import.meta.env.VITE_GOOGLE_API_KEY as string) ||
  (import.meta.env.GOOGLE_API_KEY as string) ||
  (typeof localStorage !== 'undefined' ? localStorage.getItem('gemini_api_key') || '' : '')
)

const geminiModel = (import.meta.env.VITE_GEMINI_MODEL as string) || 'gemini-2.5-flash'

const openrouterKey = (import.meta.env.VITE_OPENROUTER_API_KEY as string) || (typeof localStorage !== 'undefined' ? localStorage.getItem('openrouter_api_key') || '' : '')
const openrouterModel = (import.meta.env.VITE_OPENROUTER_MODEL as string) || 'openrouter/auto'
const openrouterImageModel = (
  (import.meta.env.VITE_OPENROUTER_IMAGE_MODEL as string) ||
  (typeof localStorage !== 'undefined' ? localStorage.getItem('openrouter_image_model') || '' : '') ||
  'google/gemini-2.5-flash-image'
)
const aiProvider = ((import.meta.env.VITE_AI_PROVIDER as string) || '').toLowerCase() // 'openrouter' | 'gemini'

export async function translateWithGemini(text: string, targetLang: string = 'zh') {
  if (!geminiKey) throw new Error('未检测到Google Gemini密钥，请在.env设置VITE_GOOGLE_API_KEY，或使用localStorage设置 gemini_api_key')
  const buildUrl = (version: 'v1beta' | 'v1beta2') => `https://generativelanguage.googleapis.com/${version}/models/${encodeURIComponent(geminiModel)}:generateContent?key=${encodeURIComponent(geminiKey)}`
  let url = buildUrl('v1beta')
  const prompt = `输入文本按句标注了[[S0]]、[[S1]]等标签。请逐句翻译为${targetLang}（简体中文），并保留每句开头的原标签（例如[[S0]]）。不要改变顺序、不要新增或删除标签。仅输出带标签的译文，每句以其原标签开头。\n\n${text}`
  const containsChinese = /[\u4e00-\u9fa5]/.test(text)
  const body = {
    contents: [
      {
        parts: [{ text: prompt }]
      }
    ]
  }
  let res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    if (res.status === 404) {
      url = buildUrl('v1beta2')
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      if (!res.ok) {
        const msg = await res.text()
        throw new Error(`Gemini接口错误: ${res.status} ${msg}`)
      }
    } else {
      const msg = await res.text()
      throw new Error(`Gemini接口错误: ${res.status} ${msg}`)
    }
  }
  const data = await res.json()
  const textPart = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
  if (!textPart) throw new Error('Gemini未返回文本结果')
  return textPart.trim()
}

export async function translateWithGeminiStream(text: string, onDelta: (s: string) => void, targetLang: string = 'zh') {
  if (!geminiKey) throw new Error('未检测到Google Gemini密钥，请在.env设置VITE_GOOGLE_API_KEY，或使用localStorage设置 gemini_api_key')
  const buildUrl = (version: 'v1beta' | 'v1beta2') => `https://generativelanguage.googleapis.com/${version}/models/${encodeURIComponent(geminiModel)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(geminiKey)}`
  const prompt = `输入文本按句标注了[[S0]]、[[S1]]等标签。请逐句翻译为${targetLang}（简体中文），并保留每句开头的原标签（例如[[S0]]）。不要改变顺序、不要新增或删除标签。仅输出带标签的译文，每句以其原标签开头。\n\n${text}`
  const body = {
    contents: [
      {
        parts: [{ text: prompt }]
      }
    ]
  }
  let url = buildUrl('v1beta')
  let res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    url = buildUrl('v1beta2')
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
      body: JSON.stringify(body)
    })
    if (!res.ok) {
      const msg = await res.text()
      throw new Error(`Gemini接口错误: ${res.status} ${msg}`)
    }
  }
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const chunks = buf.split('\n\n')
    buf = chunks.pop() || ''
    for (const chunk of chunks) {
      const line = chunk.split('\n').find(l => l.startsWith('data:')) || ''
      const jsonStr = line.replace(/^data:\s*/, '')
      if (!jsonStr) continue
      try {
        const obj = JSON.parse(jsonStr)
        const part = obj?.candidates?.[0]?.content?.parts?.[0]?.text
        if (typeof part === 'string' && part.length > 0) onDelta(part)
      } catch {}
    }
  }
}

export async function translateWithOpenRouter(text: string, targetLang: string = 'zh', modelOverride?: string) {
  if (!openrouterKey) throw new Error('未检测到OpenRouter密钥，请在.env设置VITE_OPENROUTER_API_KEY，或使用localStorage设置 openrouter_api_key')
  const isDev = typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV
  const url = isDev ? '/openrouter/api/v1/chat/completions' : 'https://openrouter.ai/api/v1/chat/completions'
  const prompt = `输入文本按句标注了[[S0]]、[[S1]]等标签。请逐句翻译为${targetLang}（简体中文），并保留每句开头的原标签（例如[[S0]]）。不要改变顺序、不要新增或删除标签。仅输出带标签的译文，每句以其原标签开头。\n\n${text}`
  const body = {
    model: modelOverride || openrouterModel,
    messages: [
      { role: 'system', content: 'You are a professional translator.' },
      { role: 'user', content: prompt },
    ],
    stream: false,
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openrouterKey}`,
      'HTTP-Referer': (typeof location !== 'undefined' ? encodeURI(location.origin) : 'http://localhost'),
      'Referer': (typeof location !== 'undefined' ? encodeURI(location.origin) : 'http://localhost'),
      'X-Title': 'ReadWithYourKids',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`OpenRouter接口错误: ${res.status} ${await res.text()}`)
  const data = await res.json()
  const textPart = data?.choices?.[0]?.message?.content || ''
  if (!textPart) throw new Error('OpenRouter未返回文本结果')
  return textPart.trim()
}

export async function translateWithOpenRouterStream(text: string, onDelta: (s: string) => void, targetLang: string = 'zh', modelOverride?: string) {
  if (!openrouterKey) throw new Error('未检测到OpenRouter密钥，请在.env设置VITE_OPENROUTER_API_KEY，或使用localStorage设置 openrouter_api_key')
  const isDev = typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV
  const url = isDev ? '/openrouter/api/v1/chat/completions' : 'https://openrouter.ai/api/v1/chat/completions'
  const prompt = `输入文本按句标注了[[S0]]、[[S1]]等标签。请逐句翻译为${targetLang}（简体中文），并保留每句开头的原标签（例如[[S0]]）。不要改变顺序、不要新增或删除标签。仅输出带标签的译文，每句以其原标签开头。\n\n${text}`
  const body = {
    model: modelOverride || openrouterModel,
    messages: [
      { role: 'system', content: 'You are a professional translator.' },
      { role: 'user', content: prompt },
    ],
    stream: true,
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openrouterKey}`,
      'Accept': 'text/event-stream',
      'HTTP-Referer': (typeof location !== 'undefined' ? encodeURI(location.origin) : 'http://localhost'),
      'Referer': (typeof location !== 'undefined' ? encodeURI(location.origin) : 'http://localhost'),
      'X-Title': 'ReadWithYourKids',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`OpenRouter接口错误: ${res.status} ${await res.text()}`)
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const chunks = buf.split('\n\n')
    buf = chunks.pop() || ''
    for (const chunk of chunks) {
      const line = chunk.split('\n').find(l => l.startsWith('data:')) || ''
      const jsonStr = line.replace(/^data:\s*/, '')
      if (!jsonStr || jsonStr === '[DONE]') continue
      try {
        const obj = JSON.parse(jsonStr)
        const part = obj?.choices?.[0]?.delta?.content
        if (typeof part === 'string' && part.length > 0) onDelta(part)
      } catch {}
    }
  }
}

export async function translateStreamAuto(text: string, onDelta: (s: string) => void, targetLang: string = 'zh') {
  const provider = aiProvider || (openrouterKey ? 'openrouter' : (geminiKey ? 'gemini' : ''))
  if (provider === 'openrouter') {
    return translateWithOpenRouterStream(text, onDelta, targetLang)
  }
  if (provider === 'gemini') {
    return translateWithGeminiStream(text, onDelta, targetLang)
  }
  throw new Error('未配置可用的AI提供方，请设置VITE_OPENROUTER_API_KEY或VITE_GOOGLE_API_KEY')
}

export async function translateAuto(text: string, targetLang: string = 'zh') {
  const provider = aiProvider || (openrouterKey ? 'openrouter' : (geminiKey ? 'gemini' : ''))
  if (provider === 'openrouter') {
    return translateWithOpenRouter(text, targetLang)
  }
  if (provider === 'gemini') {
    return translateWithGemini(text, targetLang)
  }
  throw new Error('未配置可用的AI提供方，请设置VITE_OPENROUTER_API_KEY或VITE_GOOGLE_API_KEY')
}

export async function generateImageWithOpenRouter(prompt: string, size: string = '1024x1024') {
  try {
    const useWorkers = ((import.meta as any)?.env?.VITE_USE_WORKERS === '1') || (typeof localStorage !== 'undefined' && localStorage.getItem('use_workers') === '1')
    const base = ((import.meta as any)?.env?.VITE_WORKERS_BASE as string) || ''
    if (useWorkers) {
      const res = await fetch(`${base}/api/image`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, size }) })
      if (res.ok) {
        const data = await res.json()
        const url = data?.imageUrl || ''
        if (url) return url
      }
    }
  } catch {}
  if (!openrouterKey) throw new Error('未检测到OpenRouter密钥，请在.env设置VITE_OPENROUTER_API_KEY，或使用localStorage设置 openrouter_api_key')
  const isDev = typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV
  const url = isDev ? '/openrouter/api/v1/chat/completions' : 'https://openrouter.ai/api/v1/chat/completions'
  const body = {
    model: openrouterImageModel,
    messages: [
      { role: 'user', content: `${prompt}\n\n图像尺寸建议：${size}` }
    ],
    modalities: ['image', 'text']
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${openrouterKey}`,
      'HTTP-Referer': (typeof location !== 'undefined' ? encodeURI(location.origin) : 'http://localhost'),
      'Referer': (typeof location !== 'undefined' ? encodeURI(location.origin) : 'http://localhost'),
      'X-Title': 'ReadWithYourKids',
    },
    body: JSON.stringify(body),
  })
  if (res.status === 405) {
    const fallbackBody = { ...body, model: 'google/gemini-3-pro-image-preview' }
    const res2 = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${openrouterKey}`,
        'HTTP-Referer': (typeof location !== 'undefined' ? encodeURI(location.origin) : 'http://localhost'),
        'Referer': (typeof location !== 'undefined' ? encodeURI(location.origin) : 'http://localhost'),
        'X-Title': 'ReadWithYourKids',
      },
      body: JSON.stringify(fallbackBody),
    })
    if (!res2.ok) throw new Error(`OpenRouter图片生成错误: ${res2.status} ${await res2.text()}`)
    const ct2 = res2.headers.get('content-type') || ''
    if (!/application\/json/i.test(ct2)) {
      const text2 = await res2.text()
      throw new Error(`OpenRouter图片生成错误: 非JSON响应 ${text2.slice(0, 200)}`)
    }
    const data2 = await res2.json()
    const msg2 = data2?.choices?.[0]?.message
    const imgUrl2 = msg2?.images?.[0]?.image_url?.url || ''
    if (!imgUrl2) {
      const text2 = msg2?.content || ''
      if (text2) throw new Error(String(text2))
      throw new Error('未返回图片数据')
    }
    return imgUrl2
  }
  if (!res.ok) throw new Error(`OpenRouter图片生成错误: ${res.status} ${await res.text()}`)
  const ct = res.headers.get('content-type') || ''
  if (!/application\/json/i.test(ct)) {
    const text = await res.text()
    throw new Error(`OpenRouter图片生成错误: 非JSON响应 ${text.slice(0, 200)}`)
  }
  const data = await res.json()
  const msg = data?.choices?.[0]?.message
  const imgUrl = msg?.images?.[0]?.image_url?.url || ''
  if (!imgUrl) {
    const text = msg?.content || ''
    if (text) throw new Error(String(text))
    throw new Error('未返回图片数据')
  }
  return imgUrl
}

const volcAppId = (
  (import.meta.env.VITE_VOLC_TTS_APP_ID as string) ||
  (typeof localStorage !== 'undefined' ? localStorage.getItem('volc_tts_app_id') || '' : '')
)
const volcToken = (
  (import.meta.env.VITE_VOLC_TTS_TOKEN as string) ||
  (typeof localStorage !== 'undefined' ? localStorage.getItem('volc_tts_token') || '' : '')
)
const volcCluster = (
  (import.meta.env.VITE_VOLC_TTS_CLUSTER as string) ||
  (typeof localStorage !== 'undefined' ? localStorage.getItem('volc_tts_cluster') || '' : '') ||
  'volcano_tts'
)
const volcVoiceType = (
  (import.meta.env.VITE_VOLC_TTS_VOICE_TYPE as string) ||
  (typeof localStorage !== 'undefined' ? localStorage.getItem('volc_tts_voice_type') || '' : '') ||
  'BV001_streaming'
)
const volcLanguage = (
  (import.meta.env.VITE_VOLC_TTS_LANGUAGE as string) ||
  (typeof localStorage !== 'undefined' ? localStorage.getItem('volc_tts_language') || '' : '') ||
  'en'
)

const asrAppKey = (
  (import.meta as any)?.env?.VITE_VOLC_ASR_APP_KEY as string ||
  (typeof localStorage !== 'undefined' ? localStorage.getItem('volc_asr_app_key') || '' : '')
)
const asrAccessKey = (
  (import.meta as any)?.env?.VITE_VOLC_ASR_ACCESS_KEY as string ||
  (typeof localStorage !== 'undefined' ? localStorage.getItem('volc_asr_access_key') || '' : '')
)
const asrResourceId = (
  (import.meta as any)?.env?.VITE_VOLC_ASR_RESOURCE_ID as string ||
  (typeof localStorage !== 'undefined' ? localStorage.getItem('volc_asr_resource_id') || '' : '') ||
  'volc.seedasr.auc'
)

import { supabase, isSupabaseConfigured } from './supabase'

export async function ttsWithDoubaoHttp(text: string, overrides?: {
  voice_type?: string
  language?: string
  rate?: number
  speed_ratio?: number
  volume_ratio?: number
  pitch_ratio?: number
  encoding?: 'mp3' | 'wav' | 'pcm' | 'ogg_opus'
}) {
  const useWorkers = ((import.meta as any)?.env?.VITE_USE_WORKERS === '1') || (typeof localStorage !== 'undefined' && localStorage.getItem('use_workers') === '1')
  const base = ((import.meta as any)?.env?.VITE_WORKERS_BASE as string) || ''
  if (useWorkers) {
    const res = await fetch(`${base}/api/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, overrides }) })
    if (res.ok) {
      const data = await res.json()
      const audioUrl = data?.audioUrl || ''
      if (audioUrl) return { audioUrl, raw: { provider: 'doubao_workers' } }
    }
    // 在本地开发环境，代理不可用时回退到直连（通过 vite proxy 规避 CORS）
    const errText = await res.text().catch(()=> '')
    const isDevWorkersFallback = typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV
    if (!isDevWorkersFallback) throw new Error(errText || 'TTS 代理失败')
  }
  if (!volcToken) throw new Error('未检测到豆包TTS配置，请设置 VITE_VOLC_TTS_TOKEN 或在 localStorage 中设置 volc_tts_token')
  const reqid = typeof crypto !== 'undefined' && (crypto as any).randomUUID ? (crypto as any).randomUUID() : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const containsChinese = /[\u4e00-\u9fa5]/.test(text)
  let reqText = text
  try {
    const enc = new TextEncoder()
    const bytes = enc.encode(text)
    if (bytes.length > 1024) {
      const sliced = bytes.slice(0, 1024)
      const dec = new TextDecoder()
      reqText = dec.decode(sliced)
    }
  } catch {}
  const body = {
    app: {
      appid: volcAppId,
      cluster: volcCluster,
    },
    user: {
      uid: `uid-${reqid}`,
    },
    audio: {
      voice_type: overrides?.voice_type || volcVoiceType,
      encoding: overrides?.encoding || 'mp3',
      compression_rate: 1,
      rate: overrides?.rate ?? 24000,
      speed_ratio: overrides?.speed_ratio ?? 1.0,
      volume_ratio: overrides?.volume_ratio ?? 1.0,
      pitch_ratio: overrides?.pitch_ratio ?? 1.0,
      emotion: 'neutral',
      language: overrides?.language || (containsChinese ? 'cn' : volcLanguage),
    },
    request: {
      reqid,
      text: reqText,
      text_type: 'plain',
      operation: 'query',
      silence_duration: '125',
    },
  }
  const isDev = typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV
  const v1Url = isDev ? '/openspeech/api/v1/tts' : 'https://openspeech.bytedance.com/api/v1/tts'
  const buildHeaders = () => ({ 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': `Bearer;${volcToken}` })
  const tryFetch = async (u: string, direct: string) => {
    try {
      const r = await fetch(u, { method: 'POST', headers: buildHeaders(), body: JSON.stringify(body) })
      return { res: r, source: (u.startsWith('/openspeech') ? 'proxy' : 'direct') as 'proxy'|'direct' }
    } catch {
      const r2 = await fetch(direct, { method: 'POST', headers: buildHeaders(), body: JSON.stringify(body) })
      return { res: r2, source: 'direct' as const }
    }
  }
  let endpoint: 'v1' = 'v1'
  let authStyle: 'semicolon' = 'semicolon'
  let { res, source } = await tryFetch(v1Url, 'https://openspeech.bytedance.com/api/v1/tts')
  if (!res.ok) {
    let msg = ''
    try { msg = await res.text() } catch {}
    const needFallback = /requested resource not granted/i.test(msg || '') || /resource_id/i.test(msg || '')
    if (needFallback) {
      const alt = ['BV001_streaming','BV700_streaming','BV800_streaming'].filter(v => v !== (body.audio.voice_type || '') )
      for (const vt of alt) {
        body.audio.voice_type = vt
        const r = await tryFetch(v1Url, 'https://openspeech.bytedance.com/api/v1/tts')
        res = r.res
        source = r.source
        if (res.ok) break
        try { msg = await res.text() } catch {}
      }
    }
    if (!res.ok) {
      const mask = (s: string) => s ? `${s.slice(0,4)}...${s.slice(-4)} (${s.length})` : ''
      throw new Error(JSON.stringify({ error: 'tts_failed', status: res.status, message: msg, reqid, token_mask: mask(volcToken), cluster: volcCluster, endpoint, auth: authStyle, source }))
    }
  }
  const data = await res.json()
  const base64 = data?.data || ''
  if (!base64 || typeof base64 !== 'string') throw new Error('豆包TTS未返回有效音频数据')
  const audioUrl = `data:audio/${body.audio.encoding};base64,${base64}`
  const mask = (s: string) => s ? `${s.slice(0,4)}...${s.slice(-4)} (${s.length})` : ''
  return { audioUrl, raw: { ...data, _source: source, _endpoint: endpoint, _auth: authStyle, _appid: volcAppId, _token_mask: mask(volcToken), _cluster: volcCluster, _reqid: reqid, _voice_type: body.audio.voice_type } }
}

export async function recognizeWithDoubaoFile(dataUrl: string) {
  const appKey = asrAppKey || volcAppId || ''
  const accessKey = asrAccessKey || volcToken || ''
  if (!appKey) throw new Error('未检测到豆包ASR AppKey，请在 .env 设置 VITE_VOLC_ASR_APP_KEY')
  if (!accessKey) throw new Error('未检测到豆包ASR AccessKey，请设置 VITE_VOLC_ASR_ACCESS_KEY 或使用 VITE_VOLC_TTS_TOKEN')
  const isDev = typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV
  const url = isDev ? '/openspeech/api/v3/auc/bigmodel/recognize/flash' : 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash'
  const reqid = typeof crypto !== 'undefined' && (crypto as any).randomUUID ? (crypto as any).randomUUID() : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`
  let base64 = ''
  try {
    const parts = String(dataUrl || '').split(',')
    base64 = parts[1] || ''
  } catch {}
  if (!base64) throw new Error('未获取到录音数据')
  const body = {
    user: { uid: appKey },
    audio: { data: base64 },
    request: { model_name: 'bigmodel' }
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Api-App-Key': appKey,
      'X-Api-Access-Key': accessKey,
      'X-Api-Resource-Id': 'volc.bigasr.auc_turbo',
      'X-Api-Request-Id': reqid,
      'X-Api-Sequence': '-1'
    },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`ASR接口错误: ${res.status} ${await res.text()}`)
  const data = await res.json()
  const text = data?.result?.text || ''
  const appKeySource = asrAppKey ? 'asr_app_key' : (volcAppId ? 'tts_app_id' : 'none')
  const accessKeySource = asrAccessKey ? 'asr_access_key' : 'tts_token'
  if (typeof text === 'string' && text.length > 0) return { text, raw: { _endpoint: 'flash', _reqid: reqid, _resource: asrResourceId, _app_key_source: appKeySource, _access_key_source: accessKeySource } }
  const utt = (data?.result?.utterances || []).map((u: any) => u?.text || '').filter((s: string) => s).join('\n')
  return { text: utt || '', raw: { _endpoint: 'flash', _reqid: reqid, _resource: 'volc.bigasr.auc_turbo', _app_key_source: appKeySource, _access_key_source: accessKeySource } }
}

export async function recognizeWithDoubaoFileStandard(dataUrl: string, language?: string) {
  const appKey = asrAppKey || volcAppId || ''
  const accessKey = asrAccessKey || volcToken || ''
  if (!appKey) throw new Error('未检测到豆包ASR AppKey，请在 .env 设置 VITE_VOLC_ASR_APP_KEY 或 VITE_VOLC_TTS_APP_ID')
  if (!accessKey) throw new Error('未检测到豆包ASR AccessKey，请设置 VITE_VOLC_ASR_ACCESS_KEY 或使用 VITE_VOLC_TTS_TOKEN')
  const isDev = typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV
  const submitUrl = isDev ? '/openspeech/api/v3/auc/bigmodel/submit' : 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit'
  const queryUrl = isDev ? '/openspeech/api/v3/auc/bigmodel/query' : 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/query'
  const reqid = typeof crypto !== 'undefined' && (crypto as any).randomUUID ? (crypto as any).randomUUID() : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`
  let publicUrl = ''
  try {
    const blob = await fetch(dataUrl).then(r => r.blob())
    if (blob && isSupabaseConfigured && supabase) {
      const path = `asr/${reqid}.ogg`
      const { data: up } = await supabase.storage.from('generated').upload(path, blob, { upsert: true })
      const { data: pub } = await supabase.storage.from('generated').getPublicUrl(up?.path || path)
      publicUrl = pub?.publicUrl || ''
    }
  } catch {}
  if (!publicUrl) throw new Error('未获取到可访问的音频URL，请配置 Supabase 或提供公网URL')
  const submitBody = {
    user: { uid: appKey },
    audio: { url: publicUrl, format: 'ogg', codec: 'opus', ...(language ? { language } : {}) },
    request: { model_name: 'bigmodel' }
  }
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-Api-App-Key': appKey,
    'X-Api-Access-Key': accessKey,
    'X-Api-Resource-Id': asrResourceId,
    'X-Api-Request-Id': reqid,
    'X-Api-Sequence': '-1'
  }
  const sRes = await fetch(submitUrl, { method: 'POST', headers, body: JSON.stringify(submitBody) })
  if (!sRes.ok) throw new Error(`ASR提交错误: ${sRes.status} ${await sRes.text()}`)
  const sData = await sRes.json()
  const taskId = sData?.request_id || sData?.task_id || sData?.header?.reqid || reqid
  const qBody = { request_id: taskId }
  let tries = 0
  while (tries < 10) {
    const qRes = await fetch(queryUrl, { method: 'POST', headers, body: JSON.stringify(qBody) })
    if (!qRes.ok) throw new Error(`ASR查询错误: ${qRes.status} ${await qRes.text()}`)
    const qData = await qRes.json()
    const text = qData?.result?.text || ''
    if (typeof text === 'string' && text.length > 0) return { text, raw: { _endpoint: 'standard', _reqid: reqid, _task: taskId, _resource: asrResourceId, _url: publicUrl } }
    const utt = (qData?.result?.utterances || []).map((u: any) => u?.text || '').filter((s: string) => s).join('\n')
    if ((utt || '').length > 0) return { text: utt, raw: { _endpoint: 'standard', _reqid: reqid, _task: taskId, _resource: asrResourceId, _url: publicUrl } }
    tries++
    await new Promise(r => setTimeout(r, 1000))
  }
  return { text: '', raw: { _endpoint: 'standard', _reqid: reqid, _task: taskId, _resource: asrResourceId, _url: publicUrl } }
}
