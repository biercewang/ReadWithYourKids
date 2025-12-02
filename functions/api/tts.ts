export async function onRequest(context: any) {
  const req = context.request as Request
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } })
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })
  }
  try {
    const env = context.env || {}
    const json = await req.json()
    const text: string = String(json?.text || '')
    const overrides = json?.overrides || {}
    const appid = String(env.VOLC_TTS_APP_ID || '')
    const token = String(env.VOLC_TTS_TOKEN || '')
    const cluster = String(env.VOLC_TTS_CLUSTER || 'volcano_tts')
    if (!appid || !token) {
      return new Response(JSON.stringify({ error: 'missing_secrets' }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })
    }
    const reqid = crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`
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
      app: { appid, token: 'access_token', cluster },
      user: { uid: `uid-${reqid}` },
      audio: {
        voice_type: overrides?.voice_type || 'BV700_streaming',
        encoding: overrides?.encoding || 'mp3',
        compression_rate: 1,
        rate: overrides?.rate ?? 24000,
        speed_ratio: overrides?.speed_ratio ?? 1.0,
        volume_ratio: overrides?.volume_ratio ?? 1.0,
        pitch_ratio: overrides?.pitch_ratio ?? 1.0,
        emotion: 'neutral',
        language: overrides?.language || (containsChinese ? 'cn' : 'en'),
      },
      request: { reqid, text: reqText, text_type: 'plain', operation: 'query', silence_duration: '125' },
    }
    const v3 = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional'
    const v1 = 'https://openspeech.bytedance.com/api/v1/tts'
    const doCall = async (url: string) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': `Bearer; ${token}` }, body: JSON.stringify(body) })
    let res = await doCall(v3)
    if (!res.ok) res = await doCall(v1)
    if (!res.ok) {
      const msg = await res.text()
      return new Response(JSON.stringify({ error: 'tts_failed', status: res.status, message: msg }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })
    }
    const data = await res.json()
    const base64 = data?.data || ''
    if (!base64 || typeof base64 !== 'string') {
      return new Response(JSON.stringify({ error: 'invalid_audio' }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })
    }
    const audioUrl = `data:audio/${body.audio.encoding};base64,${base64}`
    return new Response(JSON.stringify({ audioUrl, provider: 'doubao' }), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: 'exception', message: e?.message || String(e) }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })
  }
}
