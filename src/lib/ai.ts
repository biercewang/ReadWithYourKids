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
  const prompt = `Translate the following text to ${targetLang} (Simplified Chinese). Preserve meaning and names. Output only the translated text.\n\n${text}`
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
  const prompt = `Translate the following text to ${targetLang} (Simplified Chinese). Preserve meaning and names. Output only the translated text.\n\n${text}`
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
  const prompt = `Translate the following text to ${targetLang} (Simplified Chinese). Preserve meaning and names. Output only the translated text.\n\n${text}`
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
  const prompt = `Translate the following text to ${targetLang} (Simplified Chinese). Preserve meaning and names. Output only the translated text.\n\n${text}`
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
  'BV700_streaming'
)
const volcLanguage = (
  (import.meta.env.VITE_VOLC_TTS_LANGUAGE as string) ||
  (typeof localStorage !== 'undefined' ? localStorage.getItem('volc_tts_language') || '' : '') ||
  'en'
)

export async function ttsWithDoubaoHttp(text: string, overrides?: {
  voice_type?: string
  language?: string
  rate?: number
  speed_ratio?: number
  volume_ratio?: number
  pitch_ratio?: number
  encoding?: 'mp3' | 'wav' | 'pcm' | 'ogg_opus'
}) {
  try {
    const useWorkers = ((import.meta as any)?.env?.VITE_USE_WORKERS === '1') || (typeof localStorage !== 'undefined' && localStorage.getItem('use_workers') === '1')
    const base = ((import.meta as any)?.env?.VITE_WORKERS_BASE as string) || ''
    if (useWorkers) {
      const res = await fetch(`${base}/api/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, overrides }) })
      if (res.ok) {
        const data = await res.json()
        const audioUrl = data?.audioUrl || ''
        if (audioUrl) return { audioUrl, raw: { provider: 'doubao_workers' } }
      }
      // Workers 优先：不再回退直连，直接抛错，让 UI 显示错误便于定位
      const errText = await res.text().catch(()=> '')
      throw new Error(errText || 'TTS 代理失败')
    }
  } catch {}
  if (!volcAppId || !volcToken) throw new Error('未检测到豆包TTS配置，请设置 VITE_VOLC_TTS_APP_ID 和 VITE_VOLC_TTS_TOKEN 或在 localStorage 中设置 volc_tts_app_id/volc_tts_token')
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
      token: 'access_token',
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
  const v3Url = isDev ? '/openspeech/api/v3/tts/unidirectional' : 'https://openspeech.bytedance.com/api/v3/tts/unidirectional'
  const v1Url = isDev ? '/openspeech/api/v1/tts' : 'https://openspeech.bytedance.com/api/v1/tts'
  const doReq = async (u: string, direct: string) => {
    try {
      const r = await fetch(u, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${volcToken}`,
        },
        body: JSON.stringify(body),
      })
      return { res: r, source: (u.startsWith('/openspeech') ? 'proxy' : 'direct') as 'proxy'|'direct' }
    } catch (err) {
      const r2 = await fetch(direct, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${volcToken}`,
        },
        body: JSON.stringify(body),
      })
      return { res: r2, source: 'direct' as const }
    }
  }
  let { res, source } = await doReq(v3Url, 'https://openspeech.bytedance.com/api/v3/tts/unidirectional')
  if (!res.ok && res.status >= 500) {
    await new Promise(r => setTimeout(r, 500))
    ;({ res, source } = await doReq(v3Url, 'https://openspeech.bytedance.com/api/v3/tts/unidirectional'))
  }
  if (!res.ok && res.status >= 500) {
    await new Promise(r => setTimeout(r, 1000))
    ;({ res, source } = await doReq(v3Url, 'https://openspeech.bytedance.com/api/v3/tts/unidirectional'))
  }
  if (!res.ok) {
    ;({ res, source } = await doReq(v1Url, 'https://openspeech.bytedance.com/api/v1/tts'))
  }
  if (!res.ok) {
    const msg = await res.text()
    throw new Error(`豆包TTS接口错误: ${res.status} ${msg}`)
  }
  const data = await res.json()
  const base64 = data?.data || ''
  if (!base64 || typeof base64 !== 'string') throw new Error('豆包TTS未返回有效音频数据')
  const audioUrl = `data:audio/${body.audio.encoding};base64,${base64}`
  return { audioUrl, raw: { ...data, _source: source } }
}
