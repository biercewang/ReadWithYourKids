class AsrPcmProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true
    const ch = input[0]
    const sr = sampleRate
    const target = 16000
    const ratio = sr / target
    const outLen = Math.floor(ch.length / ratio)
    const out = new Int16Array(outLen)
    for (let i = 0; i < outLen; i++) {
      const idx = Math.floor(i * ratio)
      let s = ch[idx]
      if (s > 1) s = 1
      if (s < -1) s = -1
      out[i] = s < 0 ? Math.floor(s * 32768) : Math.floor(s * 32767)
    }
    this.port.postMessage(out.buffer, [out.buffer])
    return true
  }
}
registerProcessor('asr-pcm-processor', AsrPcmProcessor)
