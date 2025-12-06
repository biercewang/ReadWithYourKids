export function baseMsFromWpm(wpm: number): number {
  const clamped = Math.max(40, Math.min(300, wpm))
  const ms = Math.round(60000 / clamped)
  return Math.max(150, ms)
}

export function sentenceEndPauseMs(baseMs: number, sentence: string, isLastSentence: boolean): number {
  const endChar = (sentence.trim().slice(-1) || '')
  const strong = /[.!?。！？]/.test(endChar)
  const medium = /[,;:，；：]/.test(endChar)
  const factor = isLastSentence ? (strong ? 2.4 : medium ? 2.0 : 1.8) : (strong ? 2.2 : medium ? 1.6 : 1.4)
  return Math.round(baseMs * factor)
}

export function wordDelayMs(baseMs: number, tokenStr: string, idx: number, wordCount: number, sentence: string, isResumeFirst: boolean): number {
  const hasCN = /[\u4e00-\u9fff]/.test(tokenStr)
  const enCore = tokenStr.replace(/[^A-Za-z]/g, '')
  const cnCore = tokenStr.replace(/[^\u4e00-\u9fff]/g, '')
  const syllables = Math.max(1, (enCore.match(/[aeiouy]+/gi) || []).length)
  const cnLen = cnCore.length
  let factor = 1
  if (hasCN) {
    factor += Math.max(-0.10, Math.min(0.40, (cnLen - 2) * 0.08))
  } else {
    factor += Math.max(-0.12, Math.min(0.50, (syllables - 1) * 0.12))
  }
  if (/[.!?。！？]$/.test(tokenStr)) factor += 0.60
  else if (/[,;:，；：]$/.test(tokenStr)) factor += 0.35
  else if (/[-—–]$/.test(tokenStr)) factor += 0.25
  else if (/[)\]”’"']$/.test(tokenStr)) factor += 0.15
  if (idx === wordCount - 1) factor += 0.30
  if (isResumeFirst) factor += 0.40
  const delay = Math.max(120, Math.round(baseMs * factor))
  return delay
}

export interface ProcessedToken {
  text: string
  cleanWord: string
  baseDuration: number
  punctuationDelay: number
  totalDuration: number
  isSentenceEnd: boolean
  isParagraphEnd: boolean
}

export const COMMON_STOP_WORDS: Set<string> = new Set([
  'a','an','the',
  'i','you','he','she','it','we','they','me','him','her','us','them','my','your','his','its','our','their','this','that','these','those',
  'in','on','at','by','for','of','to','with','from','up','down','out','over','under','into',
  'and','but','or','nor','so','yet','if','as','than','because','while','when',
  'be','is','am','are','was','were','been','have','has','had','do','does','did','can','could','will','would','should'
])

export const RHYTHM_CONFIG = {
  delays: {
    comma: 200,
    sentence: 500,
    paragraph: 600,
  },
  factors: {
    stopWord: 0.75,
    shortWord: 0.9,
    longWord: 1.3,
    veryLong: 1.5,
  },
}

export function paragraphStartDelayMs(baseMs: number): number {
  const d = Math.round(baseMs * 1.1)
  return Math.max(220, Math.min(600, d))
}

export function scaledDelay(baseDelay: number, speedFactor: number = 1): number {
  const sf = Math.max(0.5, Math.min(2.5, speedFactor || 1))
  return Math.max(60, Math.floor(baseDelay / sf))
}

export function splitIntoTokens(textRaw: string): Array<{ text: string; hasNewLine?: boolean }>{
  const res: Array<{ text: string; hasNewLine?: boolean }> = []
  let buff = ''
  for (let i = 0; i < textRaw.length; i++) {
    const ch = textRaw[i]
    if (ch === '\n') {
      if (buff.trim().length > 0) { res.push({ text: buff }); buff = '' }
      res.push({ text: '\n', hasNewLine: true })
    } else if (/\s/.test(ch)) {
      if (buff.trim().length > 0) { res.push({ text: buff }); buff = '' }
    } else {
      buff += ch
    }
  }
  if (buff.trim().length > 0) res.push({ text: buff })
  return res
}

export function calculate_word_durations(textRaw: string, baseMs: number, opts?: { isLastSentence?: boolean; isParagraphEnd?: boolean }, speedFactor: number = 1): ProcessedToken[] {
  const tokens = splitIntoTokens(textRaw)
  const isParagraphEnd = !!(opts && opts.isParagraphEnd)
  return tokens.map((token, index) => {
    const cleanWord = token.text.replace(/[^A-Za-z\u4e00-\u9fff]/g, '').toLowerCase()
    const len = cleanWord.length
    let multiplier = 1
    if (COMMON_STOP_WORDS.has(cleanWord)) multiplier = RHYTHM_CONFIG.factors.stopWord
    else if (len <= 4) multiplier = RHYTHM_CONFIG.factors.shortWord
    else if (len > 10) multiplier = RHYTHM_CONFIG.factors.veryLong
    else if (len >= 8) multiplier = RHYTHM_CONFIG.factors.longWord

    let punctDelay = 0
    let isSentEnd = false
    let isParaEnd = false

    if (/[,:;，；：]/.test(token.text)) punctDelay += scaledDelay(RHYTHM_CONFIG.delays.comma, speedFactor)
    if (/[.?!。？！]/.test(token.text)) { punctDelay += scaledDelay(RHYTHM_CONFIG.delays.sentence, speedFactor); isSentEnd = true }
    if (token.hasNewLine || (index === tokens.length - 1 && isParagraphEnd)) { punctDelay += scaledDelay(RHYTHM_CONFIG.delays.paragraph, speedFactor); isParaEnd = true }

    const baseDuration = Math.floor(Math.max(120, baseMs) * multiplier)
    const totalDuration = Math.floor(baseDuration + punctDelay)
    return { text: token.text, cleanWord, baseDuration, punctuationDelay: punctDelay, totalDuration, isSentenceEnd: isSentEnd, isParagraphEnd: isParaEnd }
  })
}
