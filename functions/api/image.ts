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
    const prompt: string = String(json?.prompt || '')
    const size: string = String(json?.size || '1024x1024')
    const model = String(json?.model || env.OPENROUTER_IMAGE_MODEL || 'google/gemini-2.5-flash-image')
    const key = String(env.OPENROUTER_API_KEY || '')
    if (!key) {
      return new Response(JSON.stringify({ error: 'missing_openrouter_key' }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })
    }
    const origin = new URL(req.url).origin
    const url = 'https://openrouter.ai/api/v1/chat/completions'
    const body = { model, messages: [{ role: 'user', content: `${prompt}\n\n图像尺寸建议：${size}` }], modalities: ['image', 'text'] }
    let res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': `Bearer ${key}`, 'HTTP-Referer': origin, 'Referer': origin, 'X-Title': 'ReadWithYourKids' }, body: JSON.stringify(body) })
    if (!res.ok) {
      const msg = await res.text()
      return new Response(JSON.stringify({ error: 'openrouter_failed', status: res.status, message: msg }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })
    }
    const data = await res.json()
    const msg = data?.choices?.[0]?.message
    const imageUrl = msg?.images?.[0]?.image_url?.url || ''
    if (!imageUrl) {
      const text = msg?.content || ''
      return new Response(JSON.stringify({ error: 'no_image', message: text }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })
    }
    return new Response(JSON.stringify({ imageUrl, provider: 'openrouter', model }), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: 'exception', message: e?.message || String(e) }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })
  }
}
