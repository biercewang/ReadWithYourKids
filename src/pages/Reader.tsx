import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import { useBooksStore } from '../store/books'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { translateAuto, translateStreamAuto, translateWithOpenRouter, translateWithOpenRouterStream, translateWithGemini, translateWithGeminiStream, generateImageWithOpenRouter, ttsWithDoubaoHttp, recognizeWithDoubaoFileStandard, recognizeWithDoubaoFile } from '../lib/ai'
import { useImagesStore } from '../store/images'
import { useAudiosStore } from '../store/audios'
import { Volume2, Mic, Languages, Image, MessageSquare, BookOpen, ArrowLeft, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Trash2, MoreVertical, Info, Play, Square, Settings, RefreshCw, Brush, Type } from 'lucide-react'
import { Paragraph, Image as ImgType } from '../types/database'
import { useNotesStore } from '../store/notes'
import { useTranslationsStore } from '../store/translations'
import { Note } from '../types/notes'
import { baseMsFromWpm, calculate_word_durations, RHYTHM_CONFIG, paragraphStartDelayMs } from '../utils/rhythm'

export default function Reader() {
  const { bookId } = useParams<{ bookId: string }>()
  const navigate = useNavigate()
  const routerLocation = useLocation()
  const { user } = useAuthStore()
  const { currentBook, currentChapter, chapters, paragraphs, fetchParagraphs, fetchChapters, setCurrentBook, setCurrentChapter, setParagraphs } = useBooksStore()

  const [currentParagraphIndex, setCurrentParagraphIndex] = useState(0)
  const [showTranslation, setShowTranslation] = useState(false)
  const [showDiscussion, setShowDiscussion] = useState(false)
  const [discussionText, setDiscussionText] = useState('')
  const [isPlaying, setIsPlaying] = useState(false)
  const [isTranslating, setIsTranslating] = useState(false)
  const [translationText, setTranslationText] = useState('')
  const [isGeneratingImage, setIsGeneratingImage] = useState(false)
  const { images, loadImages, addImage, deleteImage } = useImagesStore()
  const { audios, loadAudios, addAudio, deleteAudio } = useAudiosStore()
  const [showImagePanel, setShowImagePanel] = useState(false)
  const [showVoicePanel, setShowVoicePanel] = useState(false)
  const [hoverVoice, setHoverVoice] = useState(false)
  const [hoverTranslation, setHoverTranslation] = useState(false)
  const [hoverImage, setHoverImage] = useState(false)
  const [hoverDiscussion, setHoverDiscussion] = useState(false)
  const [showSettingsPanel, setShowSettingsPanel] = useState(false)
  const [hoverSettings, setHoverSettings] = useState(false)
  const [readerFontSize, setReaderFontSize] = useState<number>(() => { try { const v = parseInt(localStorage.getItem('reader_font_size') || '18', 10); return isNaN(v) ? 18 : v } catch { return 18 } })
  const [readerFontFamily, setReaderFontFamily] = useState<string>(() => { try { return localStorage.getItem('reader_font_family') || 'system-ui' } catch { return 'system-ui' } })
  const [readerTheme, setReaderTheme] = useState<string>(() => { try { return localStorage.getItem('reader_theme') || 'white' } catch { return 'white' } })
  const [translationProvider, setTranslationProvider] = useState<string>(() => {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('translation_provider') || '' : ''
      return raw || 'gemini'
    } catch { return 'gemini' }
  })
  const [translationOpenRouterModel, setTranslationOpenRouterModel] = useState<string>(() => {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('translation_openrouter_model') || '' : ''
      return raw || 'x-ai/grok-4.1-fast:free'
    } catch { return 'x-ai/grok-4.1-fast:free' }
  })
  const [needsRetranslate, setNeedsRetranslate] = useState(false)
  const [imagePromptTemplate, setImagePromptTemplate] = useState<string>(() => {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('image_prompt_template') : ''
      return raw && raw.length > 0 ? raw : '为儿童绘制一幅高质量插画，内容来自以下段落。风格友好、色彩明亮、清晰构图、无文字，适合 6-10 岁儿童观看。段落内容：\n{paragraph}'
    } catch {
      return '为儿童绘制一幅高质量插画，内容来自以下段落。风格友好、色彩明亮、清晰构图、无文字，适合 6-10 岁儿童观看。段落内容：\n{paragraph}'
    }
  })
  const [imagePromptText, setImagePromptText] = useState<string>('')
  const [imageModel, setImageModel] = useState<string>(() => {
    try {
      const env = (import.meta as any)?.env?.VITE_OPENROUTER_IMAGE_MODEL || ''
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('openrouter_image_model') || '' : ''
      return raw || env || 'google/gemini-2.5-flash-image'
    } catch {
      return 'google/gemini-2.5-flash-image'
    }
  })
  const [imageStatus, setImageStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [imageDebug, setImageDebug] = useState<any>(null)
  const [lastImageUrl, setLastImageUrl] = useState<string>('')
  const { notes, currentRole, loadNotes, loadNotesSmart, addNote, deleteNote, setRole } = useNotesStore()
  const { translations, loadTranslation, addTranslation } = useTranslationsStore()
  const [noteInput, setNoteInput] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [recordTranscript, setRecordTranscript] = useState('')
  const [isSavingRecording, setIsSavingRecording] = useState(false)
  const recChunksRef = useRef<Blob[]>([])
  const recMediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recStreamRef = useRef<MediaStream | null>(null)
  const recRecognitionRef = useRef<any>(null)
  const recAudioCtxRef = useRef<AudioContext | null>(null)
  const recAnalyserRef = useRef<AnalyserNode | null>(null)
  const recAudioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const recRafRef = useRef<number | null>(null)
  const recCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [asrStatus, setAsrStatus] = useState<'idle' | 'saving' | 'recognizing' | 'success' | 'error'>('idle')
  const [asrDebug, setAsrDebug] = useState<any>(null)
  const [showAsrDebug, setShowAsrDebug] = useState(false)
  const asrWsRef = useRef<WebSocket | null>(null)
  const asrSeqRef = useRef<number>(1)
  const asrReqIdRef = useRef<string>('')
  const asrStreamingRef = useRef<boolean>(false)
  const asrPacketsRef = useRef<number>(0)
  const asrLastPacketSizeRef = useRef<number>(0)
  const asrStopClickAtRef = useRef<number | null>(null)
  const ASR_RATE = 16000
  const ASR_PACKET_MS = 200
  const ASR_SAMPLES_PER_PACKET = Math.floor(ASR_RATE * ASR_PACKET_MS / 1000)
  const asrSampleChunksRef = useRef<Int16Array[]>([])
  const asrSampleTotalRef = useRef<number>(0)

  const [mergedStart, setMergedStart] = useState<number>(0)
  const [mergedEnd, setMergedEnd] = useState<number>(0)
  const [mergedImagesMap, setMergedImagesMap] = useState<Record<string, ImgType[]>>({})
  const [mergedTranslationsMap, setMergedTranslationsMap] = useState<Record<string, string>>({})
  const [mergedNotesMap, setMergedNotesMap] = useState<Record<string, Note[]>>({})
  const [mergedAudiosMap, setMergedAudiosMap] = useState<Record<string, { id: string, audio_url: string }[]>>({})
  const [hiddenMergedIds, setHiddenMergedIds] = useState<string[]>([])
  const [deleteMenuPid, setDeleteMenuPid] = useState<string | null>(null)
  const [isTtsPending, setIsTtsPending] = useState(false)
  const [ttsStatus, setTtsStatus] = useState<'idle' | 'success' | 'fallback' | 'error'>('idle')
  const [ttsSource, setTtsSource] = useState<'doubao' | 'browser' | ''>('')
  const [ttsDebug, setTtsDebug] = useState<any>(null)
  const [showTtsDebug, setShowTtsDebug] = useState(false)
  const [showTtsConfig, setShowTtsConfig] = useState(false)
  const [ttsVoiceType, setTtsVoiceType] = useState<string>(() => {
    try { return localStorage.getItem('volc_tts_voice_type') || 'BV511_streaming' } catch { return 'BV511_streaming' }
  })
  const [ttsLanguage, setTtsLanguage] = useState<string>(() => {
    try { return localStorage.getItem('volc_tts_language') || '' } catch { return '' }
  })
  const [ttsSpeed, setTtsSpeed] = useState<number>(() => {
    try { const v = parseFloat(localStorage.getItem('volc_tts_speed_ratio') || '1'); return isNaN(v) ? 1 : v } catch { return 1 }
  })
  const [ttsVolume, setTtsVolume] = useState<number>(() => {
    try { const v = parseFloat(localStorage.getItem('volc_tts_volume_ratio') || '1'); return isNaN(v) ? 1 : v } catch { return 1 }
  })
  const [ttsPitch, setTtsPitch] = useState<number>(() => {
    try { const v = parseFloat(localStorage.getItem('volc_tts_pitch_ratio') || '1'); return isNaN(v) ? 1 : v } catch { return 1 }
  })
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [autoSelectedOnce, setAutoSelectedOnce] = useState(false)
  const listBottomRef = useRef<HTMLDivElement | null>(null)

  const [currentAudio, setCurrentAudio] = useState<HTMLAudioElement | null>(null)
  const [lastTtsModel, setLastTtsModel] = useState<string>('')
  const [showVoiceCustom, setShowVoiceCustom] = useState(false)
  const [showTranslationConfig, setShowTranslationConfig] = useState(false)
  const [showImageConfig, setShowImageConfig] = useState(false)
  const [isParagraphsLoading, setIsParagraphsLoading] = useState(false)
  const [loadingProgress, setLoadingProgress] = useState<number>(0)
  const [preloadedParas, setPreloadedParas] = useState<Record<string, any[]>>({})
  const ttsPreloadingRef = useRef<Set<string>>(new Set())
  const transPreloadingRef = useRef<Set<string>>(new Set())
  const prefetchEnabled = (() => { try { const env = ((import.meta as any)?.env?.VITE_PREFETCH_ENABLED === '1'); const ls = typeof localStorage !== 'undefined' && localStorage.getItem('prefetch_enabled') === '1'; return env || ls } catch { return true } })()
  const pageSizeDefault = (() => { try { const env = parseInt(((import.meta as any)?.env?.VITE_PAGE_SIZE as string) || '') || 50; const ls = parseInt((typeof localStorage !== 'undefined' ? localStorage.getItem('page_size') || '' : '')) || 0; return Math.max(10, ls || env || 50) } catch { return 50 } })()
  const [pageSize] = useState<number>(pageSizeDefault)
  const [currentPage, setCurrentPage] = useState<number>(1)
  const visibleLimit = Math.min(paragraphs.length, pageSize * currentPage)

  const [readerVersion, setReaderVersion] = useState<string>(() => {
    try { return localStorage.getItem('reader_version') || 'v2' } catch { return 'v2' }
  })
  const [expandedTranslations, setExpandedTranslations] = useState<Set<string>>(new Set())
  const [imageDrawerOpen, setImageDrawerOpen] = useState<boolean>(false)
  const [imageDrawerPid, setImageDrawerPid] = useState<string>('')
  const [spotlightMode, setSpotlightMode] = useState<boolean>(false)
  const [spotlightSentenceMap, setSpotlightSentenceMap] = useState<Record<string, number>>({})
  const [spotlightCompleted, setSpotlightCompleted] = useState<Set<string>>(new Set())
  const [spotlightTokenIndex, setSpotlightTokenIndex] = useState<number>(-1)
  const spotlightTimerRef = useRef<number | null>(null)
  const resumeFirstRef = useRef<boolean>(false)
  const cursorHideTimerRef = useRef<number | null>(null)
  const [spotlightWpm, setSpotlightWpm] = useState<number>(() => { try { const v = parseInt((typeof localStorage !== 'undefined' ? localStorage.getItem('spotlight_wpm') || '' : ''), 10); const d = !isNaN(v) && v > 0 ? v : 120; return Math.max(40, Math.min(300, d)) } catch { return 120 } })
  const paragraphJustSwitchedRef = useRef<boolean>(false)

  const formatChapterTitle = (t: string) => {
    const s = (t || '').trim()
    const onlyParen = /^\(\s*[^)]*\s*\)$/.test(s)
    if (onlyParen) return s
    const replaced = s.replace(/\(\s*[^)]*\s*\)/g, '').replace(/\s+/g, ' ').trim()
    return replaced || s
  }

  const splitSentences = (text: string): string[] => {
    try {
      const src = text || ''
      const matches = Array.from(src.matchAll(/\s*[^。\.！？!?…．.]+(?:[。\.！？!?…．.]+(?:[”’』」》】])*)?/g))
      const arr = matches.map(m => m[0]).filter(s => s && s.length > 0)
      return arr
    } catch {
      const s = (text || '')
      return s.length > 0 ? [s] : []
    }
  }

  const advanceSpotlight = () => {
    if (paragraphs.length === 0) return
    const idx = currentParagraphIndex
    const pid = getParagraphId(paragraphs[idx])
    const text = paragraphs[idx]?.content || ''
    const sentences = splitSentences(text)
    const curr = typeof spotlightSentenceMap[pid] === 'number' ? spotlightSentenceMap[pid] : -1
    if (!spotlightMode || curr < 0) {
      setSpotlightMode(true)
      setSpotlightSentenceMap(prev => ({ ...prev, [pid]: 0 }))
      setSpotlightTokenIndex(-1)
      return
    }
    const next = curr + 1
    if (next < sentences.length) {
      setSpotlightSentenceMap(prev => ({ ...prev, [pid]: next }))
      setSpotlightTokenIndex(-1)
      return
    }
    const nextSet = new Set(spotlightCompleted)
    nextSet.add(pid)
    setSpotlightCompleted(nextSet)
    let ni = idx + 1
    while (ni < paragraphs.length) {
      const npid = getParagraphId(paragraphs[ni])
      if (!nextSet.has(npid)) break
      ni += 1
    }
    if (ni < paragraphs.length) {
      setCurrentParagraphIndex(ni)
      setMergedStart(ni)
      setMergedEnd(ni)
      const npid = getParagraphId(paragraphs[ni])
      setSpotlightSentenceMap(prev => ({ ...prev, [npid]: 0 }))
      setSpotlightTokenIndex(-1)
    }
  }

  const retreatSpotlight = () => {
    if (paragraphs.length === 0) return
    const idx = currentParagraphIndex
    const pid = getParagraphId(paragraphs[idx])
    const text = paragraphs[idx]?.content || ''
    const sentences = splitSentences(text)
    const curr = typeof spotlightSentenceMap[pid] === 'number' ? spotlightSentenceMap[pid] : -1
    if (!spotlightMode || curr < 0) {
      setSpotlightMode(true)
      setSpotlightSentenceMap(prev => ({ ...prev, [pid]: 0 }))
      setSpotlightTokenIndex(-1)
      return
    }
    const prev = curr - 1
    if (prev >= 0) {
      setSpotlightSentenceMap(prevMap => ({ ...prevMap, [pid]: prev }))
      setSpotlightTokenIndex(-1)
      return
    }
  }

  useEffect(() => {
    if (!spotlightMode) {
      if (spotlightTimerRef.current) { clearTimeout(spotlightTimerRef.current); spotlightTimerRef.current = null }
      return
    }
    const pid = getCurrentParagraphId()
    const curr = typeof spotlightSentenceMap[pid] === 'number' ? spotlightSentenceMap[pid] : -1
    if (curr < 0) {
      setSpotlightTokenIndex(-1)
      if (spotlightTimerRef.current) { clearTimeout(spotlightTimerRef.current); spotlightTimerRef.current = null }
      return
    }
    const sents = splitSentences(paragraphs[currentParagraphIndex]?.content || '')
    const sentence = sents[curr] || ''
    const tokens = Array.from(sentence.matchAll(/\S+/g))
    const wordTokens = tokens.filter(t => /[A-Za-z0-9\u4e00-\u9fff]/.test(t[0]))
    if (wordTokens.length === 0) {
      setSpotlightTokenIndex(-1)
      if (spotlightTimerRef.current) { clearTimeout(spotlightTimerRef.current); spotlightTimerRef.current = null }
      return
    }
    if (spotlightTimerRef.current) { clearTimeout(spotlightTimerRef.current) }
    const step = (idx: number, firstTick: boolean) => {
      const baseMs = baseMsFromWpm(spotlightWpm)
      const isLastSentence = curr === sents.length - 1
      const processed = calculate_word_durations(sentence, baseMs, { isLastSentence, isParagraphEnd: isLastSentence })
      if (idx >= processed.length) {
        const last = processed[processed.length - 1]
        const pauseMs = Math.max(120, (last?.punctuationDelay || 0) + (isLastSentence ? RHYTHM_CONFIG.delays.paragraph : 0))
        setSpotlightTokenIndex(processed.length - 1)
        spotlightTimerRef.current = window.setTimeout(() => { advanceSpotlight() }, pauseMs)
        return
      }
      const extraResume = firstTick && resumeFirstRef.current
      const delay = processed[idx].totalDuration + (extraResume ? Math.round(baseMs * 0.4) : 0)
      if (extraResume) resumeFirstRef.current = false
      setSpotlightTokenIndex(idx)
      spotlightTimerRef.current = window.setTimeout(() => step(idx + 1, false), delay)
    }
    const startIdx = Math.max(0, spotlightTokenIndex >= 0 ? spotlightTokenIndex : 0)
    if (paragraphJustSwitchedRef.current && startIdx === 0) {
      const baseMs = baseMsFromWpm(spotlightWpm)
      const d = paragraphStartDelayMs(baseMs)
      paragraphJustSwitchedRef.current = false
      spotlightTimerRef.current = window.setTimeout(() => step(startIdx, true), d)
    } else {
      step(startIdx, true)
    }
    return () => { if (spotlightTimerRef.current) { clearTimeout(spotlightTimerRef.current); spotlightTimerRef.current = null } }
  }, [spotlightMode, currentParagraphIndex, spotlightSentenceMap, spotlightWpm])


  useEffect(() => {
    const pid = getCurrentParagraphId()
    if (pid) {
      setSpotlightSentenceMap(prev => ({ ...prev, [pid]: 0 }))
      setSpotlightCompleted(prev => { const s = new Set(prev); s.delete(pid); return s })
      setSpotlightTokenIndex(-1)
      paragraphJustSwitchedRef.current = true
    }
  }, [currentParagraphIndex])

  useEffect(() => {
    const clearTimer = () => { if (cursorHideTimerRef.current) { clearTimeout(cursorHideTimerRef.current); cursorHideTimerRef.current = null } }
    const showCursor = () => { try { document.body.style.cursor = '' } catch {} }
    const hideCursor = () => { try { document.body.style.cursor = 'none' } catch {} }
    const scheduleHide = () => { clearTimer(); cursorHideTimerRef.current = window.setTimeout(() => { if (spotlightMode) hideCursor() }, 2000) }
    if (spotlightMode) {
      showCursor()
      scheduleHide()
      const onMove = () => { showCursor(); scheduleHide() }
      window.addEventListener('mousemove', onMove)
      return () => { window.removeEventListener('mousemove', onMove); clearTimer(); showCursor() }
    } else {
      clearTimer()
      showCursor()
    }
  }, [spotlightMode])

  const preloadNextParagraphContent = async () => {
    try {
      if (!currentBook || !currentChapter || paragraphs.length === 0) return
      if (!prefetchEnabled) return
      const nextIndex = Math.min(visibleLimit - 1, currentParagraphIndex + 1)
      if (nextIndex === currentParagraphIndex) return
      const nextPid = getParagraphId(paragraphs[nextIndex])
      const nextText = paragraphs[nextIndex]?.content || ''
      const bid = getBookKey()
      // Pre-generate TTS audio for next paragraph
      if (showVoicePanel && !isTtsPending) {
        const existing = (mergedAudiosMap[nextPid] || [])
        if ((!existing || existing.length === 0) && !ttsPreloadingRef.current.has(nextPid)) {
          ttsPreloadingRef.current.add(nextPid)
          try {
            const { audioUrl, raw } = await ttsWithDoubaoHttp(nextText, {
              voice_type: ttsVoiceType,
              language: ttsLanguage || undefined,
              speed_ratio: ttsSpeed,
              volume_ratio: ttsVolume,
              pitch_ratio: ttsPitch,
              encoding: 'mp3'
            })
            addAudio(bid, currentChapter.id, nextPid, audioUrl, 'doubao', (raw as any)?._voice_type || ttsVoiceType)
            setMergedAudiosMap(prev => ({ ...prev, [nextPid]: [ { id: `local-${Date.now()}`, audio_url: audioUrl }, ...((prev[nextPid] || [])) ] }))
          } catch { } finally { ttsPreloadingRef.current.delete(nextPid) }
        }
      }
      // Pre-translate next paragraph
      if (showTranslation && !isTranslating) {
        const storeText = (translations || []).find(t => t.paragraph_id === nextPid)?.translated_text || ''
        const existingT = mergedTranslationsMap[nextPid] || storeText
        if ((!existingT || existingT.length === 0) && !transPreloadingRef.current.has(nextPid)) {
          transPreloadingRef.current.add(nextPid)
          try {
            const full = translationProvider === 'openrouter'
              ? await translateWithOpenRouter(nextText, 'zh', translationOpenRouterModel)
              : await translateWithGemini(nextText, 'zh')
            if (full && full.length > 0) {
              setMergedTranslationsMap(prev => ({ ...prev, [nextPid]: full }))
              addTranslation(bid, nextPid, full, 'zh')
            }
          } catch { } finally { transPreloadingRef.current.delete(nextPid) }
        }
      }
    } catch { }
  }

  const tryPlayPreloaded = async (pid?: string) => {
    try {
      const targetId = pid || getCurrentParagraphId()
      if (!targetId) { await handleTextToSpeech(); return }
      const list = mergedAudiosMap[targetId] || []
      const url = list[0]?.audio_url || ''
      if (url) {
        stopPlaying()
        const audio = new Audio(url)
        audio.onended = () => { try { setCurrentAudio(null); setIsPlaying(false) } catch { } }
        setCurrentAudio(audio)
        setIsPlaying(true)
        setTtsStatus('success')
        setTtsSource('doubao')
        setLastTtsModel(ttsVoiceType)
        await audio.play()
        return
      }
      await handleTextToSpeech([targetId])
    } catch { await handleTextToSpeech(pid ? [pid] : undefined) }
  }
  
  const disableAudios = (() => {
    try {
      const env = (import.meta as any).env
      const byEnv = String(env.VITE_DISABLE_AUDIOS || '') === '1'
      const byLs = typeof localStorage !== 'undefined' && localStorage.getItem('disable_audios_table') === '1'
      return byEnv || byLs
    } catch { return false }
  })()
  const [appliedSavedIndex, setAppliedSavedIndex] = useState(false)
  const [appliedSavedMerge, setAppliedSavedMerge] = useState(false)
  const [pendingChapterId, setPendingChapterId] = useState<string | null>(null)
  const VOICES = [
    { label: '美式英语 慵懒女声-Ava', value: 'BV511_streaming' },
    { label: '美式英语 议论女声-Alicia', value: 'BV505_streaming' },
    { label: '美式英语 情感女声-Lawrence', value: 'BV138_streaming' },
    { label: '美式英语 美式女声-Amelia', value: 'BV027_streaming' },
    { label: '美式英语 讲述女声-Amanda', value: 'BV502_streaming' },
    { label: '美式英语 活力女声-Ariana', value: 'BV503_streaming' },
    { label: '美式英语 活力男声-Jackson', value: 'BV504_streaming' },
    { label: '美式英语 天才少女', value: 'BV421_streaming' },
    { label: '美式英语 Stefan', value: 'BV702_streaming' },
    { label: '美式英语 天真萌娃-Lily', value: 'BV506_streaming' },
    { label: '英式英语 亲切女声-Anna', value: 'BV040_streaming' },
    { label: '澳洲英语 澳洲男声-Henry', value: 'BV516_streaming' }
  ]
  const VOICE_OPTIONS = VOICES.map(v => v.value)

  useEffect(() => {
    try { localStorage.setItem('volc_tts_voice_type', ttsVoiceType) } catch { }
    setShowVoiceCustom(!VOICE_OPTIONS.includes(ttsVoiceType))
  }, [ttsVoiceType])

  const getCurrentParagraphId = () => {
    const p = paragraphs[currentParagraphIndex]
    if (p?.id) return p.id as string
    const text = p?.content || ''
    let h = 0
    for (let i = 0; i < text.length; i++) {
      h = (h << 5) - h + text.charCodeAt(i)
      h |= 0
    }
    return `p-${Math.abs(h)}`
  }

  const getParagraphId = (p: Paragraph) => {
    if (p?.id) return p.id as string
    const text = p?.content || ''
    let h = 0
    for (let i = 0; i < text.length; i++) {
      h = (h << 5) - h + text.charCodeAt(i)
      h |= 0
    }
    return `p-${Math.abs(h)}`
  }

  const getBookKey = () => {
    if (currentBook?.id) return currentBook.id as string
    const base = String((currentBook as any)?.metadata?.fileName || currentBook?.title || '')
    let h = 0
    for (let i = 0; i < base.length; i++) {
      h = (h << 5) - h + base.charCodeAt(i)
      h |= 0
    }
    return `b-${Math.abs(h)}`
  }



  const computePrevStart = (startIndex: number) => Math.max(0, startIndex - 1)

  

  const loadReadingStateRemote = async (): Promise<any> => {
    try {
      if (!(isSupabaseConfigured && supabase) || !currentBook || !user) return null
      const { data } = await supabase
        .from('reading_progress')
        .select('*')
        .eq('user_id', user.id)
        .eq('book_id', currentBook.id)
        .single()
      if (!data) return null
      return { chapterId: data.chapter_id, paragraphIndex: data.paragraph_index || 0, mergedStart: data.merged_start, mergedEnd: data.merged_end }
    } catch { return null }
  }

  const saveReadingStateRemote = async (): Promise<void> => {
    try {
      if (!(isSupabaseConfigured && supabase) || !currentBook || !currentChapter || !user) return
      await supabase
        .from('reading_progress')
        .upsert({
          user_id: user.id,
          book_id: currentBook.id,
          chapter_id: currentChapter.id,
          paragraph_index: currentParagraphIndex,
          merged_start: mergedStart,
          merged_end: mergedEnd,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,book_id' })
    } catch { }
  }

  const getSavedState = async () => {
    return await loadReadingStateRemote()
  }

  const getOrderedSelectedIds = () => {
    const ids = paragraphs
      .slice(mergedStart, Math.min(mergedEnd + 1, visibleLimit))
      .filter(p => !hiddenMergedIds.includes(getParagraphId(p)))
      .map(p => getParagraphId(p))
    return ids.length > 0 ? ids : [getCurrentParagraphId()].filter(Boolean) as string[]
  }

  const getVisibleRange = () => {
    const s = mergedStart
    const e = Math.min(mergedEnd, Math.max(0, visibleLimit - 1))
    const idxs: number[] = []
    for (let i = s; i <= e; i++) {
      const p = paragraphs[i]
      if (!p) continue
      const pid = getParagraphId(p)
      if (!hiddenMergedIds.includes(pid)) idxs.push(i)
    }
    if (idxs.length === 0) return { start: currentParagraphIndex, end: currentParagraphIndex }
    return { start: idxs[0], end: idxs[idxs.length - 1] }
  }

  const hasNextChapter = () => {
    if (!currentChapter || !chapters || chapters.length === 0) return false
    const idx = (chapters || []).findIndex(c => c.id === currentChapter.id)
    return idx >= 0 && idx < (chapters || []).length - 1
  }

  const getCombinedText = (ids: string[]) => {
    const parts = ids.map(pid => {
      const p = paragraphs.find(pp => getParagraphId(pp) === pid)
      return p?.content || ''
    }).filter(s => s && s.length > 0)
    return parts.join('\n\n')
  }

  const ensureMergedData = async (startIdx: number, endIdx: number) => {
    if (!currentBook || paragraphs.length === 0) return
    setLoadingProgress(v => (v <= 0 ? 10 : v))
    const bid = getBookKey()
    const slice = paragraphs.slice(startIdx, Math.min(endIdx + 1, visibleLimit))
    const newImages: Record<string, ImgType[]> = { ...mergedImagesMap }
    const newTrans: Record<string, string> = { ...mergedTranslationsMap }
    const newNotes: Record<string, Note[]> = { ...mergedNotesMap }
    const newAud: Record<string, { id: string, audio_url: string }[]> = { ...mergedAudiosMap }
    if (isSupabaseConfigured && supabase) {
      const pidList = slice.map(p => getParagraphId(p))
      setLoadingProgress(v => (v < 60 ? 60 : v))
      const [imgRes, tRes, nRes, aRes] = await Promise.all([
        supabase.from('images').select('*').in('paragraph_id', pidList).order('created_at', { ascending: false }),
        supabase.from('translations').select('*').in('paragraph_id', pidList).order('created_at', { ascending: false }),
        supabase.from('discussions').select('*').in('paragraph_id', pidList).order('created_at', { ascending: false }),
        disableAudios ? Promise.resolve({ data: [] }) : supabase.from('audios').select('*').in('paragraph_id', pidList).order('created_at', { ascending: false })
      ])
      try {
        const imgData = (imgRes as any)?.data || []
        for (const pid of pidList) { newImages[pid] = [] }
        imgData.forEach((row: any) => {
          const pid = row.paragraph_id
          const arr = newImages[pid] || []
          arr.push({ id: row.id, paragraph_id: row.paragraph_id, image_url: row.image_url, prompt: row.prompt, created_at: row.created_at })
          newImages[pid] = arr
        })
        setLoadingProgress(v => Math.max(v, 75))
      } catch {}
      try {
        const tData = (tRes as any)?.data || []
        for (const pid of pidList) { if (typeof newTrans[pid] !== 'string') newTrans[pid] = '' }
        tData.forEach((row: any) => { const pid = row.paragraph_id; if (!newTrans[pid]) newTrans[pid] = row.translated_text || '' })
        setLoadingProgress(v => Math.max(v, 85))
      } catch {}
      try {
        const nData = (nRes as any)?.data || []
        for (const pid of pidList) { newNotes[pid] = newNotes[pid] || [] }
        nData.forEach((d: any) => {
          const pid = d.paragraph_id
          const arr = newNotes[pid] || []
          arr.push({ id: d.id, book_id: bid, chapter_id: currentChapter?.id || '', paragraph_id: d.paragraph_id, user_type: d.user_type, content: d.content, created_at: d.created_at })
          newNotes[pid] = arr
        })
        setLoadingProgress(v => Math.max(v, 93))
      } catch {}
      try {
        const aData = (aRes as any)?.data || []
        for (const pid of pidList) { newAud[pid] = newAud[pid] || [] }
        aData.forEach((a: any) => { const pid = a.paragraph_id; const arr = newAud[pid] || []; arr.push({ id: a.id, audio_url: a.audio_url }); newAud[pid] = arr })
      } catch {}
    }
    setMergedImagesMap(newImages)
    setMergedTranslationsMap(newTrans)
    setMergedNotesMap(newNotes)
    setMergedAudiosMap(newAud)
    setLoadingProgress(100)
  }

  const shrinkTop = () => {
    if (paragraphs.length === 0) return
    if (mergedEnd > mergedStart) {
      const ne = Math.max(mergedStart, mergedEnd - 1)
      setMergedEnd(ne)
      ensureMergedData(mergedStart, ne)
    }
  }

  const extendDown = () => {
    if (paragraphs.length === 0) return
    if (mergedEnd < paragraphs.length - 1) {
      const ne = mergedEnd + 1
      setMergedEnd(ne)
      ensureMergedData(mergedStart, ne)
      try { listBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) } catch { }
    }
  }

  useEffect(() => {
    if (showImagePanel) {
      try {
        const ids = getOrderedSelectedIds()
        const text = getCombinedText(ids)
        const v = imagePromptTemplate.includes('{paragraph}')
          ? imagePromptTemplate.replace('{paragraph}', text)
          : `${imagePromptTemplate}\n\n${text}`
        setImagePromptText(v)
      } catch { }
    }
  }, [showImagePanel, selectedIds, paragraphs, imagePromptTemplate])

  useEffect(() => {
    try {
      const el = listBottomRef.current
      if (!el) return
      const io = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            if (visibleLimit < paragraphs.length) {
              setCurrentPage(p => p + 1)
            }
          }
        }
      }, { root: null, threshold: 0.5 })
      io.observe(el)
      return () => { try { io.disconnect() } catch {} }
    } catch {}
  }, [listBottomRef, paragraphs, visibleLimit])

  const handlePrevChapter = () => {
    if (!chapters || chapters.length === 0 || !currentChapter) return
    const idx = chapters.findIndex(c => c.id === currentChapter.id)
    if (idx > 0) {
      const ch = chapters[idx - 1]
      setCurrentChapter(ch)
      setCurrentParagraphIndex(0)
      setMergedStart(0)
      setMergedEnd(0)
      setSelectedIds([])
      setHiddenMergedIds([])
      setDeleteMenuPid(null)
      setMergedImagesMap({})
      setMergedTranslationsMap({})
      setMergedNotesMap({})
      setMergedAudiosMap({})
      setAutoSelectedOnce(false)
      setLoadingProgress(0)
      setShowTranslation(false)
      if (isSupabaseConfigured && currentBook) {
        setIsParagraphsLoading(true)
        setParagraphs([])
        fetchParagraphs(ch.id).finally(() => setIsParagraphsLoading(false))
      }
    }
  }

  const handleNextChapter = () => {
    if (!chapters || chapters.length === 0 || !currentChapter) return
    const idx = chapters.findIndex(c => c.id === currentChapter.id)
    if (idx >= 0 && idx < chapters.length - 1) {
      const ch = chapters[idx + 1]
      setCurrentChapter(ch)
      setCurrentParagraphIndex(0)
      setMergedStart(0)
      setMergedEnd(0)
      setSelectedIds([])
      setHiddenMergedIds([])
      setDeleteMenuPid(null)
      setMergedImagesMap({})
      setMergedTranslationsMap({})
      setMergedNotesMap({})
      setMergedAudiosMap({})
      setAutoSelectedOnce(false)
      setLoadingProgress(0)
      setShowTranslation(false)
      if (isSupabaseConfigured && currentBook) {
        const cached = preloadedParas[ch.id]
        if (cached && Array.isArray(cached) && cached.length > 0) {
          setIsParagraphsLoading(true)
          setParagraphs(cached)
          setIsParagraphsLoading(false)
        } else {
          setIsParagraphsLoading(true)
          setParagraphs([])
          fetchParagraphs(ch.id).finally(() => setIsParagraphsLoading(false))
        }
      }
    }
  }

  const preloadNextChapter = async () => {
    if (!chapters || chapters.length === 0 || !currentChapter) return
    const idx = chapters.findIndex(c => c.id === currentChapter.id)
    if (idx >= 0 && idx < chapters.length - 1) {
      const next = chapters[idx + 1]
      if (preloadedParas[next.id] && Array.isArray(preloadedParas[next.id]) && preloadedParas[next.id].length > 0) return
      if (isSupabaseConfigured && supabase && currentBook) {
        try {
          const { data } = await supabase
            .from('paragraphs')
            .select('*')
            .eq('chapter_id', next.id)
            .order('order_index', { ascending: true })
          if (data && Array.isArray(data) && data.length > 0) {
            setPreloadedParas(prev => ({ ...prev, [next.id]: data }))
          }
        } catch { }
      }
    }
  }

  useEffect(() => {
    if (currentChapter && paragraphs.length > 0 && !isParagraphsLoading) {
      preloadNextChapter()
    }
  }, [currentChapter, paragraphs, isParagraphsLoading])

  useEffect(() => {
    preloadNextParagraphContent()
  }, [showVoicePanel, showTranslation, currentParagraphIndex, paragraphs])

  useEffect(() => {
    if (!user) {
      navigate('/login')
      return
    }

    if ((bookId && (!currentBook || currentBook.id !== bookId))) {
      const storeBook = (useBooksStore.getState().books || []).find(b => b.id === bookId)
      if (storeBook) {
        setCurrentBook(storeBook)
      }
      try {
        setParagraphs([])
        useBooksStore.getState().setChapters([])
        setCurrentChapter(null as any)
        setCurrentParagraphIndex(0)
        setMergedStart(0)
        setMergedEnd(0)
        setSelectedIds([])
        setAppliedSavedIndex(false)
        setAppliedSavedMerge(false)
        setMergedImagesMap({})
        setMergedTranslationsMap({})
        setMergedNotesMap({})
        setMergedAudiosMap({})
        setHiddenMergedIds([])
        setDeleteMenuPid(null)
        setIsParagraphsLoading(true)
      } catch { }
    }

    if (currentBook && !currentChapter) {
      if (isSupabaseConfigured) {
        fetchChapters(currentBook.id)
      }
    }
  }, [user, navigate, currentBook, bookId, setCurrentBook, setCurrentChapter, setParagraphs])

  useEffect(() => {
    if (!bookId) return
    setCurrentParagraphIndex(0)
    setMergedStart(0)
    setMergedEnd(0)
    setSelectedIds([])
    setAppliedSavedIndex(false)
    setAppliedSavedMerge(false)
    setPendingChapterId(null)
    setMergedImagesMap({})
    setMergedTranslationsMap({})
    setMergedNotesMap({})
    setMergedAudiosMap({})
    setHiddenMergedIds([])
    setDeleteMenuPid(null)
    setIsParagraphsLoading(true)
    const params = new URLSearchParams(routerLocation.search || '')
    const fresh = params.get('fresh') === '1'
    ;(async () => {
      try {
        if (!fresh) {
          const saved = await getSavedState()
          if (saved) {
            if (typeof saved.paragraphIndex === 'number') setCurrentParagraphIndex(Math.max(0, saved.paragraphIndex))
            if (typeof saved.mergedStart === 'number') setMergedStart(Math.max(0, saved.mergedStart))
            if (typeof saved.mergedEnd === 'number') setMergedEnd(Math.max(0, saved.mergedEnd))
            if (saved.chapterId) setPendingChapterId(saved.chapterId)
          }
        }
      } catch {}
    })()
  }, [bookId, routerLocation.search])

  useEffect(() => {
    if (isSupabaseConfigured && !currentChapter && chapters.length > 0) {
      (async () => {
        const params = new URLSearchParams(routerLocation.search || '')
        const fresh = params.get('fresh') === '1'
        if (fresh) {
          const ch = chapters[0]
          setCurrentChapter(ch)
          setCurrentParagraphIndex(0)
          setIsParagraphsLoading(true)
          fetchParagraphs(ch.id).finally(() => setIsParagraphsLoading(false))
          return
        }
        let saved = await loadReadingStateRemote()
        const targetId = pendingChapterId || saved?.chapterId || null
        const ch = targetId ? (chapters.find(c => c.id === targetId) || chapters[0]) : chapters[0]
        setCurrentChapter(ch)
        const idx = Math.max(0, saved?.paragraphIndex ?? 0)
        setCurrentParagraphIndex(idx)
        setIsParagraphsLoading(true)
        fetchParagraphs(ch.id).finally(() => setIsParagraphsLoading(false))
        setPendingChapterId(null)
      })()
    }
  }, [chapters, currentChapter, routerLocation.search])

  useEffect(() => {
    (async () => {
      if (currentBook && currentChapter && paragraphs.length > 0 && !appliedSavedIndex) {
        const saved = await getSavedState()
        if (saved?.chapterId && saved.chapterId !== currentChapter.id) {
          const target = (useBooksStore.getState().chapters || []).find(c => c.id === saved.chapterId)
          if (target) {
            setCurrentChapter(target)
            if (isSupabaseConfigured) {
              setIsParagraphsLoading(true)
              fetchParagraphs(target.id).finally(() => setIsParagraphsLoading(false))
            }
            return
          }
        }
        if (typeof saved?.paragraphIndex === 'number') {
          const idx = Math.max(0, Math.min(saved.paragraphIndex, paragraphs.length - 1))
          setCurrentParagraphIndex(idx)
          try {
            const pid = getParagraphId(paragraphs[idx])
            const el = document.getElementById(`para-${pid}`)
            if (el) { el.scrollIntoView({ behavior: 'auto', block: 'center' }) }
          } catch {}
        }
        setAppliedSavedIndex(true)
      }
    })()
  }, [currentBook, currentChapter, paragraphs])

  const handleTextToSpeech = async (idsOverride?: string[]) => {
    if (paragraphs.length === 0) return
    const ids = (idsOverride && idsOverride.length > 0) ? idsOverride : getOrderedSelectedIds()
    const targetId = ids[0]
    const text = getCombinedText(ids)
    try {
      setIsTtsPending(true)
      setShowTtsDebug(false)
      stopPlaying()
      const { audioUrl, raw } = await ttsWithDoubaoHttp(text, {
        voice_type: ttsVoiceType,
        language: ttsLanguage || undefined,
        speed_ratio: ttsSpeed,
        volume_ratio: ttsVolume,
        pitch_ratio: ttsPitch,
        encoding: 'mp3'
      })
      const audio = new Audio(audioUrl)
      audio.onplay = () => setIsPlaying(true)
      audio.onended = () => { try { setCurrentAudio(null); setIsPlaying(false) } catch { } }
      setTtsStatus('success')
      setTtsSource('doubao')
      setTtsDebug(raw)
      setLastTtsModel((raw as any)?._voice_type || ttsVoiceType)
      setIsTtsPending(false)
      setCurrentAudio(audio)
      await audio.play()
      try { preloadNextParagraphContent() } catch { }
    } catch (e) {
      setIsTtsPending(false)
      setTtsDebug({ error: e instanceof Error ? e.message : String(e) })
      if ('speechSynthesis' in window) {
        stopPlaying()
        const utterance = new SpeechSynthesisUtterance(paragraphs[currentParagraphIndex]?.content || '')
        utterance.lang = 'en-US'
        utterance.rate = 0.8
        utterance.onstart = () => setIsPlaying(true)
        utterance.onend = () => setIsPlaying(false)
        speechSynthesis.speak(utterance)
        setTtsStatus('fallback')
        setTtsSource('browser')
        try { preloadNextParagraphContent() } catch { }
      } else {
        alert(e instanceof Error ? e.message : '朗读失败')
        setTtsStatus('error')
        setTtsSource('')
      }
    }
  }

  const playLatestAudio = async () => {
    try {
      stopPlaying()
      if (currentAudio) {
        try { currentAudio.pause(); currentAudio.currentTime = 0 } catch { }
        setCurrentAudio(null)
        setIsPlaying(false)
        return
      }
      const url = (audios || [])[0]?.audio_url || ''
      if (url) {
        const audio = new Audio(url)
        audio.onended = () => { try { setCurrentAudio(null); setIsPlaying(false) } catch { } }
        audio.play()
        setCurrentAudio(audio)
        setIsPlaying(true)
        setTtsStatus('success')
        setTtsSource('doubao')
        setLastTtsModel(ttsVoiceType)
        return
      }
      if (paragraphs.length === 0 || isTtsPending) return
      setIsTtsPending(true)
      const ids = getOrderedSelectedIds()
      const targetId = ids[ids.length - 1]
      const text = getCombinedText(ids)
      const { audioUrl, raw } = await ttsWithDoubaoHttp(text, { voice_type: ttsVoiceType, language: ttsLanguage || undefined, speed_ratio: ttsSpeed, volume_ratio: ttsVolume, pitch_ratio: ttsPitch, encoding: 'mp3' })
      setTtsStatus('success')
      setTtsSource('doubao')
      setTtsDebug(raw)
      setLastTtsModel((raw as any)?._voice_type || ttsVoiceType)
      const audio = new Audio(audioUrl)
      audio.onended = () => { try { setCurrentAudio(null); setIsPlaying(false) } catch { } }
      audio.play()
      setCurrentAudio(audio)
      setIsPlaying(true)
    } catch (e) {
      setTtsStatus('error')
      setTtsSource('')
      setTtsDebug({ error: e instanceof Error ? e.message : String(e) })
    } finally {
      setIsTtsPending(false)
    }
  }

  const stopPlaying = () => {
    try {
      if (currentAudio) {
        try { currentAudio.pause(); currentAudio.currentTime = 0 } catch { }
        setCurrentAudio(null)
        setIsPlaying(false)
      }
    } catch { }
    try {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        speechSynthesis.cancel()
      }
    } catch { }
  }

  const handleVoiceMenuClick = async () => {
    const next = !showVoicePanel
    setShowVoicePanel(next)
    if (next) {
      setShowImagePanel(false)
      setShowDiscussion(false)
      await tryPlayPreloaded(getCurrentParagraphId())
      try { preloadNextParagraphContent() } catch { }
    }
  }

  const handleTranslation = async (idsOverride?: string[]) => {
    if (paragraphs.length === 0) return
    try {
      const bid = getBookKey()
      const ids = (idsOverride && idsOverride.length > 0) ? idsOverride : getOrderedSelectedIds()
      const targetId = ids[0]
      const text = getCombinedText(ids)
      setIsTranslating(true)
      setMergedTranslationsMap(prev => ({ ...prev, [targetId]: '' }))
      let appended = false
      let accum = ''
      let buf = ''
      let flushing = false
      const flush = () => {
        if (buf.length === 0) { flushing = false; return }
        const take = Math.min(3, buf.length)
        const piece = buf.slice(0, take)
        buf = buf.slice(take)
        setMergedTranslationsMap(prev => ({ ...prev, [targetId]: (prev[targetId] || '') + piece }))
        setTimeout(flush, 30)
      }
      if (translationProvider === 'openrouter') {
        await translateWithOpenRouterStream(text, (s) => {
          appended = true
          accum += s
          buf += s
          if (!flushing) { flushing = true; flush() }
        }, 'zh', translationOpenRouterModel)
      } else {
        await translateWithGeminiStream(text, (s) => {
          appended = true
          accum += s
          buf += s
          if (!flushing) { flushing = true; flush() }
        }, 'zh')
      }
      if (!appended) {
        const full = translationProvider === 'openrouter'
          ? await translateWithOpenRouter(text, 'zh', translationOpenRouterModel)
          : await translateWithGemini(text, 'zh')
        buf += full
        if (!flushing) { flushing = true; flush() }
        if (full && full.length > 0) addTranslation(bid, targetId, full, 'zh')
      } else {
        if (accum && accum.length > 0) addTranslation(bid, targetId, accum, 'zh')
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : '翻译失败')
    } finally {
      setIsTranslating(false)
    }
  }

  const retranslateNow = async () => {
    if (paragraphs.length === 0) return
    try {
      setIsTranslating(true)
      const text = paragraphs[currentParagraphIndex]?.content || ''
      const bid = getBookKey()
      const pid = getCurrentParagraphId()
      setMergedTranslationsMap(prev => ({ ...prev, [pid]: '' }))
      let appended = false
      let accum = ''
      if (translationProvider === 'openrouter') {
        await translateWithOpenRouterStream(text, (s) => {
          appended = true
          accum += s
          setMergedTranslationsMap(prev => ({ ...prev, [pid]: (prev[pid] || '') + s }))
        }, 'zh', translationOpenRouterModel)
      } else {
        await translateWithGeminiStream(text, (s) => {
          appended = true
          accum += s
          setMergedTranslationsMap(prev => ({ ...prev, [pid]: (prev[pid] || '') + s }))
        }, 'zh')
      }
      if (!appended) {
        const full = translationProvider === 'openrouter'
          ? await translateWithOpenRouter(text, 'zh', translationOpenRouterModel)
          : await translateWithGemini(text, 'zh')
        setMergedTranslationsMap(prev => ({ ...prev, [pid]: full }))
        if (full && full.length > 0) addTranslation(bid, pid, full, 'zh')
      } else {
        if (accum && accum.length > 0) addTranslation(bid, pid, accum, 'zh')
      }
      setNeedsRetranslate(false)
    } catch (e) {
      alert(e instanceof Error ? e.message : '翻译失败')
    } finally {
      setIsTranslating(false)
    }
  }

  const handleImageGeneration = async () => {
    if (paragraphs.length === 0 || isGeneratingImage) return
    try {
      setIsGeneratingImage(true)
      setImageStatus('idle')
      setImageDebug(null)
      const bid = getBookKey()
      const ids = getOrderedSelectedIds()
      const targetId = ids[0]
      const text = getCombinedText(ids)
      const prompt = (imagePromptText && imagePromptText.length > 0)
        ? imagePromptText
        : (imagePromptTemplate.includes('{paragraph}') ? imagePromptTemplate.replace('{paragraph}', text) : `${imagePromptTemplate}\n\n${text}`)
      const img = await generateImageWithOpenRouter(prompt, '1024x1024')
      if (currentBook && currentChapter) {
        addImage(bid, currentChapter.id, targetId, img, prompt)
        ensureMergedData(mergedStart, mergedEnd)
      }
      setLastImageUrl(typeof img === 'string' ? img : (img?.url || ''))
      setImageStatus('success')
      setImageDebug({ prompt, model: imageModel })
    } catch (e) {
      const msg = e instanceof Error ? e.message : '生成图片失败'
      alert(msg)
      setImageStatus('error')
      setImageDebug({ error: msg })
    } finally {
      setIsGeneratingImage(false)
    }
  }

  const startRecording = async () => {
    try {
      if (isRecording) return
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      recStreamRef.current = stream
      let mime = 'audio/ogg;codecs=opus'
      if (typeof MediaRecorder !== 'undefined' && !MediaRecorder.isTypeSupported(mime)) {
        mime = 'audio/webm;codecs=opus'
      }
      const mr = (typeof MediaRecorder !== 'undefined' && (MediaRecorder as any).isTypeSupported && (MediaRecorder as any).isTypeSupported(mime))
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream)
      recMediaRecorderRef.current = mr
      recChunksRef.current = []
      mr.ondataavailable = (e) => { if (e.data && e.data.size > 0) recChunksRef.current.push(e.data) }
      mr.start(200)
      setIsRecording(true)
      try { setAsrDebug((d: any) => ({ ...(d || {}), record_mime: mime })) } catch { }
      try {
        const AC = (window as any).AudioContext || (window as any).webkitAudioContext
        if (AC) {
          const ac = new AC()
          recAudioCtxRef.current = ac
          const src = ac.createMediaStreamSource(stream)
          recAudioSourceRef.current = src
          const an = ac.createAnalyser()
          recAnalyserRef.current = an
          an.fftSize = 2048
          src.connect(an)
          const ensureCanvasSize = () => {
            const c = recCanvasRef.current
            if (!c) return
            const dpr = (window.devicePixelRatio || 1)
            const w = c.clientWidth || 300
            const h = c.clientHeight || 64
            c.width = Math.max(1, Math.floor(w * dpr))
            c.height = Math.max(1, Math.floor(h * dpr))
          }
          const draw = () => {
            const a = recAnalyserRef.current
            const c = recCanvasRef.current
            if (!a || !c) { recRafRef.current = requestAnimationFrame(draw); return }
            const ctx2d = c.getContext('2d')
            if (!ctx2d) { recRafRef.current = requestAnimationFrame(draw); return }
            const len = a.fftSize
            const data = new Uint8Array(len)
            a.getByteTimeDomainData(data)
            ctx2d.clearRect(0, 0, c.width, c.height)
            ctx2d.strokeStyle = '#2563eb'
            ctx2d.lineWidth = 2
            ctx2d.beginPath()
            const sliceW = c.width / len
            let x = 0
            for (let i = 0; i < len; i++) {
              const v = data[i] / 128.0
              const y = (v * c.height) / 2
              if (i === 0) ctx2d.moveTo(x, y)
              else ctx2d.lineTo(x, y)
              x += sliceW
            }
            ctx2d.lineTo(c.width, c.height / 2)
            ctx2d.stroke()
            recRafRef.current = requestAnimationFrame(draw)
          }
          ensureCanvasSize()
          draw()
        }
      } catch { }
      try {
        const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition
        if (SR) {
          const recog = new SR()
          recRecognitionRef.current = recog
          recog.lang = (ttsLanguage && ttsLanguage.length > 0) ? (ttsLanguage === 'cn' ? 'zh-CN' : ttsLanguage) : 'zh-CN'
          recog.interimResults = true
          recog.continuous = true
          recog.onresult = (evt: any) => {
            let text = ''
            for (let i = evt.resultIndex; i < evt.results.length; i++) {
              const res = evt.results[i]
              text += res[0].transcript
            }
            setRecordTranscript(text)
          }
          try { recog.start() } catch { }
        }
      } catch { }
    } catch { }
  }

  const constructFrame = (msgType: number, payload: Uint8Array, serialization: number = 1, flags: number = 0) => {
    const header = new Uint8Array(4)
    const version = 0x1
    const headerSize = 0x1
    header[0] = ((version & 0xF) << 4) | (headerSize & 0xF)
    header[1] = ((msgType & 0xF) << 4) | (flags & 0xF)
    header[2] = ((serialization & 0xF) << 4) | 0x1
    header[3] = 0x0

    const len = payload.length
    const size = new Uint8Array(4)
    size[0] = (len >>> 24) & 0xff
    size[1] = (len >>> 16) & 0xff
    size[2] = (len >>> 8) & 0xff
    size[3] = (len) & 0xff

    const buf = new Uint8Array(4 + 4 + len)
    buf.set(header, 0)
    buf.set(size, 4)
    buf.set(payload, 8)
    return buf
  }

  const gzipBytes = async (input: Uint8Array) => {
    const cs = new CompressionStream('gzip')
    const rawAb = new Uint8Array(input).buffer
    const blob = new Blob([rawAb])
    const stream = blob.stream().pipeThrough(cs)
    const ab = await new Response(stream).arrayBuffer()
    return new Uint8Array(ab)
  }

  const constructFrameGzip = async (msgType: number, payload: Uint8Array, serialization: number = 1, flags: number = 0) => {
    const gz = await gzipBytes(payload)
    return constructFrame(msgType, gz, serialization, flags)
  }

  const startStreamingAsr = async () => {
    try {
      if (asrStreamingRef.current) return
      const lang = (ttsLanguage && ttsLanguage.length > 0) ? (ttsLanguage === 'cn' ? 'zh-CN' : ttsLanguage) : undefined
      const connectId = crypto.randomUUID ? crypto.randomUUID() : `cid-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const reqId = crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`
      asrReqIdRef.current = reqId
      const proto = (typeof location !== 'undefined' && location.protocol === 'https:') ? 'wss' : 'ws'
      const wsUrl = `${proto}://${location.host}/asr/api/v2/asr`
      setAsrDebug((d: any) => ({ ...(d || {}), ws_url: wsUrl }))
      const ws = new WebSocket(wsUrl)
      asrWsRef.current = ws
      asrStreamingRef.current = true
      ws.binaryType = 'arraybuffer'
      asrSeqRef.current = 1
      asrPacketsRef.current = 0
      asrLastPacketSizeRef.current = 0
      asrStopClickAtRef.current = null
      setAsrDebug((d: any) => ({ ...(d || {}), ws_url: wsUrl }))

      ws.onopen = async () => {
        setAsrDebug((d: any) => ({
          ...(d || {}),
          ws_url: wsUrl,
          connect_id: connectId,
          req_id: reqId,
          ws_ready_state: ws.readyState,
          audio_packets_sent: asrPacketsRef.current,
          last_packet_size: asrLastPacketSizeRef.current
        }))
        setAsrStatus('recognizing')

        const env2 = (import.meta as any).env
        const appid2 = env2.VITE_VOLC_ASR_APP_KEY || env2.VITE_VOLC_TTS_APP_ID || ''
        const cluster = env2.VITE_VOLC_ASR_CLUSTER || 'volcengine_streaming_common'

        // Send Full Client Request (binary frame, JSON + gzip)
        const req = {
          app: {
            appid: appid2,
            cluster: cluster
          },
          user: {
            uid: connectId
          },
          request: {
            reqid: reqId,
            sequence: 1,
            nbest: 1,
            workflow: 'audio_in,resample,partition,vad,fe,decode,itn,nlu_punctuate',
            result_type: 'full'
          },
          audio: {
            format: 'wav',
            codec: 'raw',
            rate: 16000,
            bits: 16,
            channels: 1
          }
        }
        try {
          const jsonBytes = new TextEncoder().encode(JSON.stringify(req))
          const frame = await constructFrameGzip(1, jsonBytes, 1, 0)
          ws.send(frame)
          setAsrDebug((d: any) => ({ ...(d || {}), cluster, client_request_len: jsonBytes.length }))
        } catch { }
      }

      ws.onmessage = async (ev) => {
        try {
          let payloadBytes: Uint8Array | null = null

          if (ev.data instanceof ArrayBuffer) {
            const buf = new Uint8Array(ev.data)
            if (buf.length >= 8) {
              const hdrLen = (((buf[0] & 0xF) || 1) * 4) >>> 0
              const msgType = (buf[1] >> 4) & 0xF
              const compress = (buf[2] & 0xF)
              const sizeIdx = hdrLen
              const sizeVal = (buf[sizeIdx] << 24) | (buf[sizeIdx + 1] << 16) | (buf[sizeIdx + 2] << 8) | buf[sizeIdx + 3]
              const payloadIdx = sizeIdx + 4
              if (buf.length >= payloadIdx + sizeVal) {
                payloadBytes = buf.slice(payloadIdx, payloadIdx + sizeVal)
                // MsgType 9 = Full Server Response, 15 = Error
                if (msgType === 0xF) { // Error
                  setAsrStatus('error')
                  try {
                    let p = payloadBytes
                    if (compress === 0x1) {
                      const ds = new DecompressionStream('gzip')
                      const rawAb = new Uint8Array(p).buffer
                      const blob = new Blob([rawAb])
                      const stream = blob.stream().pipeThrough(ds)
                      const ab = await new Response(stream).arrayBuffer()
                      p = new Uint8Array(ab)
                    }
                    const errJson = JSON.parse(new TextDecoder().decode(p))
                    setAsrDebug((d: any) => ({ ...(d || {}), ws_error_frame: errJson, last_msg_type: msgType, last_payload_len: sizeVal }))
                  } catch { }
                  return
                }
                setAsrDebug((d: any) => ({ ...(d || {}), last_msg_type: msgType, last_payload_len: sizeVal }))
              }
            }
          } else if (typeof ev.data === 'string') {
            // Fallback if server sends text frame (unlikely for this protocol but possible for errors)
            try {
              const obj = JSON.parse(ev.data)
              if (obj) payloadBytes = new TextEncoder().encode(ev.data)
            } catch { }
          }

          if (payloadBytes) {
            let p = payloadBytes
            try {
              const ds = new DecompressionStream('gzip')
              const rawAb = new Uint8Array(p).buffer
              const blob = new Blob([rawAb])
              const stream = blob.stream().pipeThrough(ds)
              const ab = await new Response(stream).arrayBuffer()
              p = new Uint8Array(ab)
            } catch {}
            const textDecoded = new TextDecoder().decode(p)
            const obj = JSON.parse(textDecoded)
            const text = obj?.result?.text || ''
            if (typeof text === 'string' && text.length > 0) setRecordTranscript(text)
            const utts = (obj?.result?.utterances || []).map((u: any) => u?.text || '').filter((s: string) => s).join('\n')
            if (utts && utts.length > 0) setRecordTranscript(utts)
          }
        } catch { }
      }

      ws.onerror = (e) => { setAsrStatus('error'); setAsrDebug((d: any) => ({ ...(d || {}), ws_error: String(e), ws_ready_state: ws.readyState })) }
      ws.onclose = (ev) => {
        asrStreamingRef.current = false
        if (ev.code !== 1000) {
          setAsrStatus('error')
          setAsrDebug((d: any) => ({ ...(d || {}), ws_close: { code: ev.code, reason: ev.reason }, ws_ready_state: ws.readyState }))
        } else {
          setAsrStatus('idle')
        }
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      recStreamRef.current = stream
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext
      const ac = new AC()
      recAudioCtxRef.current = ac
      const src = ac.createMediaStreamSource(stream)
      const an = ac.createAnalyser()
      recAnalyserRef.current = an
      an.fftSize = 2048
      src.connect(an)

      const ensureCanvasSize = () => {
        const c = recCanvasRef.current
        if (!c) return
        const dpr = (window.devicePixelRatio || 1)
        const w = c.clientWidth || 300
        const h = c.clientHeight || 64
        c.width = Math.max(1, Math.floor(w * dpr))
        c.height = Math.max(1, Math.floor(h * dpr))
      }
      const draw = () => {
        const a = recAnalyserRef.current
        const c = recCanvasRef.current
        if (!a || !c) { recRafRef.current = requestAnimationFrame(draw); return }
        const ctx2d = c.getContext('2d')
        if (!ctx2d) { recRafRef.current = requestAnimationFrame(draw); return }
        const len = a.fftSize
        const data = new Uint8Array(len)
        a.getByteTimeDomainData(data)
        ctx2d.clearRect(0, 0, c.width, c.height)
        ctx2d.strokeStyle = '#2563eb'
        ctx2d.lineWidth = 2
        ctx2d.beginPath()
        const sliceW = c.width / len
        let x = 0
        for (let i = 0; i < len; i++) {
          const v = data[i] / 128.0
          const y = (v * c.height) / 2
          if (i === 0) ctx2d.moveTo(x, y)
          else ctx2d.lineTo(x, y)
          x += sliceW
        }
        ctx2d.lineTo(c.width, c.height / 2)
        ctx2d.stroke()
        recRafRef.current = requestAnimationFrame(draw)
      }
      ensureCanvasSize()
      draw()

      await ac.audioWorklet.addModule(new URL('../lib/asrWorklet.js', import.meta.url))
      const node = new AudioWorkletNode(ac, 'asr-pcm-processor', { numberOfInputs: 1, numberOfOutputs: 0 })
      src.connect(node)

      node.port.onmessage = async (ev: MessageEvent) => {
        if (!asrStreamingRef.current || !asrWsRef.current) return
        const samples = new Int16Array(ev.data as ArrayBuffer)
        asrSampleChunksRef.current.push(samples)
        asrSampleTotalRef.current += samples.length
        try {
          while (asrSampleTotalRef.current >= ASR_SAMPLES_PER_PACKET) {
            let need = ASR_SAMPLES_PER_PACKET
            const out = new Int16Array(ASR_SAMPLES_PER_PACKET)
            let offset = 0
            while (need > 0 && asrSampleChunksRef.current.length > 0) {
              const head = asrSampleChunksRef.current[0]
              if (head.length <= need) {
                out.set(head, offset)
                offset += head.length
                need -= head.length
                asrSampleChunksRef.current.shift()
              } else {
                out.set(head.subarray(0, need), offset)
                const remain = head.subarray(need)
                asrSampleChunksRef.current[0] = remain
                offset += need
                need = 0
              }
            }
            asrSampleTotalRef.current -= ASR_SAMPLES_PER_PACKET
            const bytes = new Uint8Array(out.buffer)
            const frame = await constructFrameGzip(2, bytes, 1, 0)
            asrWsRef.current.send(frame)
            asrSeqRef.current += 1
            asrPacketsRef.current += 1
            asrLastPacketSizeRef.current = bytes.length
            setAsrDebug((d: any) => ({ ...(d || {}), audio_packets_sent: asrPacketsRef.current, last_packet_size: asrLastPacketSizeRef.current }))
          }
        } catch { }
      }
      setIsRecording(true)
    } catch { }
  }

  const stopStreamingAsr = async () => {
    try {
      asrStreamingRef.current = false
      asrStopClickAtRef.current = Date.now()
      setAsrDebug((d: any) => ({ ...(d || {}), stop_click_at: asrStopClickAtRef.current, ws_ready_state: asrWsRef.current?.readyState }))
      try { (recStreamRef.current?.getTracks() || []).forEach(t => t.stop()) } catch { }
      try { recAudioCtxRef.current?.close() } catch { }
      try {
        if (asrWsRef.current && asrWsRef.current.readyState === WebSocket.OPEN) {
          try {
            if (asrSampleTotalRef.current > 0) {
              let remain = asrSampleTotalRef.current
              const out = new Int16Array(remain)
              let offset = 0
              while (remain > 0 && asrSampleChunksRef.current.length > 0) {
                const head = asrSampleChunksRef.current.shift()!
                out.set(head, offset)
                offset += head.length
                remain -= head.length
              }
              asrSampleTotalRef.current = 0
              const bytes = new Uint8Array(out.buffer)
              try {
                const frameFlush = await constructFrameGzip(2, bytes, 1, 0)
                asrWsRef.current.send(frameFlush)
              } catch { }
              asrPacketsRef.current += 1
              asrLastPacketSizeRef.current = bytes.length
              setAsrDebug((d: any) => ({ ...(d || {}), audio_packets_sent: asrPacketsRef.current, last_packet_size: asrLastPacketSizeRef.current, final_flush_samples: out.length }))
            }
          } catch { }
          try {
            const empty = new Uint8Array(0)
            const finalFrame = await constructFrameGzip(2, empty, 1, 0x2)
            asrWsRef.current.send(finalFrame)
            setAsrDebug((d: any) => ({ ...(d || {}), final_packet_sent: true }))
          } catch { }
        } else {
          setAsrDebug((d: any) => ({ ...(d || {}), final_packet_sent: false, ws_ready_state: asrWsRef.current?.readyState }))
        }
      } catch { }
      try { asrWsRef.current?.close() } catch { }
      asrWsRef.current = null
      setIsRecording(false)
    } catch { }
  }

  const stopRecording = async () => {
    try {
      if (!isRecording) return
      setIsRecording(false)
      try { recMediaRecorderRef.current?.stop() } catch { }
      try { (recStreamRef.current?.getTracks() || []).forEach(t => t.stop()) } catch { }
      recMediaRecorderRef.current = null
      recStreamRef.current = null
      try { recRecognitionRef.current && recRecognitionRef.current.stop && recRecognitionRef.current.stop() } catch { }
      try { if (recRafRef.current) { cancelAnimationFrame(recRafRef.current); recRafRef.current = null } } catch { }
      try {
        if (recAudioSourceRef.current) { recAudioSourceRef.current.disconnect() }
        recAudioSourceRef.current = null
        if (recAnalyserRef.current) { recAnalyserRef.current.disconnect() }
        recAnalyserRef.current = null
        if (recAudioCtxRef.current) { recAudioCtxRef.current.close(); recAudioCtxRef.current = null }
      } catch { }
    } catch { }
  }

  const saveRecordingAsNote = async () => {
    try {
      if (isSavingRecording) return
      setIsSavingRecording(true)
      setAsrStatus('saving')
      if (isRecording) {
        await stopRecording()
        await new Promise(r => setTimeout(r, 250))
      }
      const bid = getBookKey()
      const pid = getCurrentParagraphId()
      if (recChunksRef.current.length > 0) {
        const blob = new Blob(recChunksRef.current, { type: 'audio/webm' })
        const reader = new FileReader()
        reader.onloadend = async () => {
          const dataUrl = String(reader.result || '')
          if (dataUrl) {
            try { setAsrDebug((d: any) => ({ ...(d || {}), dataUrl_len: dataUrl.length })) } catch { }
            try { const audio = new Audio(dataUrl); audio.play() } catch { }
            try {
              setAsrStatus('recognizing')
              const lang = (ttsLanguage && ttsLanguage.length > 0) ? (ttsLanguage === 'cn' ? 'zh-CN' : ttsLanguage) : undefined
              let res: any
              try {
                res = await recognizeWithDoubaoFileStandard(dataUrl, lang)
              } catch (e) {
                res = await recognizeWithDoubaoFile(dataUrl)
              }
              const recognized = res?.text || ''
              setAsrDebug((d: any) => ({ ...(d || {}), response: res?.raw }))
              if (recognized && recognized.trim().length > 0) {
                setRecordTranscript(recognized)
                if (currentBook && currentChapter) {
                  addNote(bid, currentChapter.id, pid, recognized.trim())
                  ensureMergedData(mergedStart, mergedEnd)
                }
                setAsrStatus('success')
              }
            } catch (e: any) {
              setAsrStatus('error')
              setAsrDebug((d: any) => ({ ...(d || {}), error: e?.message || String(e) }))
            }
          }
        }
        reader.readAsDataURL(blob)
      }
      const content = recordTranscript || ''
      if (content.trim().length > 0 && currentBook && currentChapter) {
        addNote(bid, currentChapter.id, pid, content.trim())
        ensureMergedData(mergedStart, mergedEnd)
      }
      setRecordTranscript('')
      recChunksRef.current = []
      setIsSavingRecording(false)
      if (asrStatus === 'saving') setAsrStatus('idle')
    } catch { }
  }

  const handlePreviousParagraph = async () => {
    if (mergedEnd > mergedStart) {
      const win = mergedEnd - mergedStart + 1
      const ns = Math.max(0, mergedStart - 1)
      const ne = Math.min(paragraphs.length - 1, ns + win - 1)
      setMergedStart(ns)
      setMergedEnd(ne)
      setCurrentParagraphIndex(ns)

      ensureMergedData(ns, ne)
      let vis: string[] = []
      try {
        vis = paragraphs
          .slice(ns, Math.min(ne + 1, paragraphs.length))
          .filter(pp => !hiddenMergedIds.includes(getParagraphId(pp)))
          .map(pp => getParagraphId(pp))
        setSelectedIds(vis)
      } catch { }
      try { if (showVoicePanel && !isTtsPending) { await tryPlayPreloaded(vis[0]) } } catch { }
      try { if (showTranslation && !isTranslating) await handleTranslation(vis) } catch { }
      return
    }
    if (currentParagraphIndex > 0) {
      const prevStart = computePrevStart(currentParagraphIndex)
      setCurrentParagraphIndex(prevStart)
      setMergedStart(prevStart)
      setMergedEnd(prevStart)

      ensureMergedData(prevStart, prevStart)
      let vis: string[] = []
      try {
        vis = paragraphs
          .slice(prevStart, Math.min(prevStart + 1, paragraphs.length))
          .filter(pp => !hiddenMergedIds.includes(getParagraphId(pp)))
          .map(pp => getParagraphId(pp))
        setSelectedIds(vis)
      } catch { }
      try { if (showVoicePanel && !isTtsPending) { await tryPlayPreloaded(vis[0]) } } catch { }
      try { if (showTranslation && !isTranslating) await handleTranslation(vis) } catch { }
    } else if (paragraphs.length <= 1) {
      handlePrevChapter()
    }
  }

  const handleNextParagraph = async () => {
    if (spotlightMode) {
      let nextIndex = currentParagraphIndex + 1
      const done = new Set(spotlightCompleted)
      while (nextIndex < paragraphs.length) {
        const npid = getParagraphId(paragraphs[nextIndex])
        if (!done.has(npid)) break
        nextIndex += 1
      }
      if (nextIndex < paragraphs.length) {
        setCurrentParagraphIndex(nextIndex)
        setMergedStart(nextIndex)
        setMergedEnd(nextIndex)
        ensureMergedData(nextIndex, nextIndex)
        let vis: string[] = []
        try {
          vis = paragraphs
            .slice(nextIndex, Math.min(nextIndex + 1, paragraphs.length))
            .filter(pp => !hiddenMergedIds.includes(getParagraphId(pp)))
            .map(pp => getParagraphId(pp))
          setSelectedIds(vis)
        } catch { }
        try { if (showVoicePanel && !isTtsPending) { await tryPlayPreloaded(vis[0]) } } catch { }
        try { if (showTranslation && !isTranslating) await handleTranslation(vis) } catch { }
        return
      }
    }
    if (mergedEnd > mergedStart) {
      const win = mergedEnd - mergedStart + 1
      const ne = Math.min(paragraphs.length - 1, mergedEnd + 1)
      const ns = Math.max(0, ne - win + 1)
      setMergedStart(ns)
      setMergedEnd(ne)
      setCurrentParagraphIndex(ns)

      ensureMergedData(ns, ne)
      let vis: string[] = []
      try {
        vis = paragraphs
          .slice(ns, Math.min(ne + 1, paragraphs.length))
          .filter(pp => !hiddenMergedIds.includes(getParagraphId(pp)))
          .map(pp => getParagraphId(pp))
        setSelectedIds(vis)
      } catch { }
      try { if (showVoicePanel && !isTtsPending) { await tryPlayPreloaded(vis[0]) } } catch { }
      try { if (showTranslation && !isTranslating) await handleTranslation(vis) } catch { }
      return
    }
    if (currentParagraphIndex < paragraphs.length - 1) {
      const nextIndex = currentParagraphIndex + 1
      setCurrentParagraphIndex(nextIndex)
      setMergedStart(nextIndex)
      setMergedEnd(nextIndex)

      ensureMergedData(nextIndex, nextIndex)
      let vis: string[] = []
      try {
        vis = paragraphs
          .slice(nextIndex, Math.min(nextIndex + 1, paragraphs.length))
          .filter(pp => !hiddenMergedIds.includes(getParagraphId(pp)))
          .map(pp => getParagraphId(pp))
        setSelectedIds(vis)
      } catch { }
      try { if (showVoicePanel && !isTtsPending) { await tryPlayPreloaded(vis[0]) } } catch { }
      try { if (showTranslation && !isTranslating) await handleTranslation(vis) } catch { }
    } else {
      const hasNextChapter = !!currentChapter && !!chapters && chapters.length > 0 && (chapters.findIndex(c => c.id === currentChapter.id) < chapters.length - 1)
      if (hasNextChapter) {
        const go = window.confirm('已到本章最后一段，是否进入下一章？')
        if (go) handleNextChapter()
      }
    }
  }

  useEffect(() => {
    if (currentBook && paragraphs.length > 0) {
      loadNotes(getBookKey(), getCurrentParagraphId())
    }
  }, [currentBook, currentParagraphIndex, paragraphs])

  useEffect(() => {
    if (currentBook && paragraphs.length > 0) {
      const pid = getCurrentParagraphId()
      const bids = [getBookKey(), currentBook.id]
      loadNotesSmart(bids, pid)
      loadImages(getBookKey(), pid)
      loadTranslation(getBookKey(), pid)
      try {
        const disabled = (() => { try { const env = (import.meta as any)?.env?.VITE_DISABLE_AUDIOS === '1'; const ls = typeof localStorage !== 'undefined' && localStorage.getItem('disable_audios_table') === '1'; return env || ls } catch { return false } })()
        if (!disabled) loadAudios(getBookKey(), pid)
      } catch { }
    }
  }, [currentBook, currentParagraphIndex, paragraphs])

  useEffect(() => {
    if (paragraphs.length > 0) {
      ensureMergedData(mergedStart, mergedEnd)
    }
  }, [paragraphs, mergedStart, mergedEnd])

  useEffect(() => {
    if (paragraphs.length > 0 && selectedIds.length === 0 && !autoSelectedOnce) {
      try {
        const pid = getCurrentParagraphId()
        if (pid) { setSelectedIds([pid]); setAutoSelectedOnce(true) }
      } catch { }
    }
  }, [paragraphs, currentParagraphIndex, autoSelectedOnce])

  useEffect(() => {
    try {
      const vis = paragraphs
        .slice(mergedStart, Math.min(mergedEnd + 1, visibleLimit))
        .filter(pp => !hiddenMergedIds.includes(getParagraphId(pp)))
        .map(pp => getParagraphId(pp))
      setSelectedIds(prev => prev.filter(id => vis.includes(id)))
    } catch { }
  }, [paragraphs, mergedStart, mergedEnd, hiddenMergedIds])

  useEffect(() => {
    saveReadingStateRemote()
  }, [currentBook, currentChapter, currentParagraphIndex, mergedStart, mergedEnd])

  useEffect(() => {
    return () => {}
  }, [currentBook, currentChapter, currentParagraphIndex, mergedStart, mergedEnd])

  useEffect(() => {
    return () => { try { saveReadingStateRemote() } catch { } }
  }, [])

  useEffect(() => {
    if (currentBook && currentChapter && paragraphs.length > 0) {
      try {
        const raw = localStorage.getItem('demo_notes')
        const map = raw ? JSON.parse(raw) : {}
        const bookMap = map[getBookKey()] || map[currentBook.id] || {}
        let exist = false
        for (const p of paragraphs) {
          const pid = getParagraphId(p)
          const list = bookMap[pid] || []
          if (Array.isArray(list) && list.length > 0) { exist = true; break }
        }
        setShowDiscussion(exist)
      } catch { }
    }
  }, [currentBook, currentChapter, paragraphs])

  if (!currentBook) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">加载中...</p>
        </div>
      </div>
    )
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = (target && target.tagName) || ''
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target && target.getAttribute('contenteditable') === 'true')) {
        return
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        if (spotlightMode) {
          retreatSpotlight()
        } else {
          handlePreviousParagraph()
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        if (spotlightMode) {
          advanceSpotlight()
        } else {
          handleNextParagraph()
        }
      } else if (e.key === 'Enter') {
        e.preventDefault()
        advanceSpotlight()
      } else if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault()
        try {
          const pid = getCurrentParagraphId()
          const curr = typeof spotlightSentenceMap[pid] === 'number' ? spotlightSentenceMap[pid] : -1
          if (!spotlightMode) {
            setSpotlightMode(true)
            resumeFirstRef.current = (curr >= 0 && spotlightTokenIndex >= 0)
            if (curr < 0) setSpotlightSentenceMap(prev => ({ ...prev, [pid]: 0 }))
            return
          }
          if (spotlightTimerRef.current) { clearTimeout(spotlightTimerRef.current); spotlightTimerRef.current = null }
          setSpotlightMode(false)
        } catch { }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        extendDown()
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        shrinkTop()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [handlePreviousParagraph, handleNextParagraph, mergedStart, mergedEnd, paragraphs, spotlightMode])

  useEffect(() => {
    try {
      const sp = new URLSearchParams(routerLocation.search)
      const ver = sp.get('ver') || sp.get('v') || ''
      if (ver === 'v2' || ver === '2') {
        setReaderVersion('v2')
        localStorage.setItem('reader_version', 'v2')
      } else if (ver === 'v1' || ver === '1') {
        setReaderVersion('v1')
        localStorage.setItem('reader_version', 'v1')
      }
    } catch {}
  }, [routerLocation.search])

  useEffect(() => {
    const onVerKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const tag = (t && t.tagName) || ''
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.getAttribute('contenteditable') === 'true')) return
      if (e.key === 'F2') {
        e.preventDefault()
        const next = readerVersion === 'v1' ? 'v2' : 'v1'
        setReaderVersion(next)
        try { localStorage.setItem('reader_version', next) } catch {}
      }
    }
    window.addEventListener('keydown', onVerKey)
    return () => { window.removeEventListener('keydown', onVerKey) }
  }, [readerVersion])

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      const inside = !!t && (
        !!t.closest('.v2-settings-menu') ||
        !!t.closest('.v2-settings-trigger')
      )
      if (!inside) { setShowSettingsPanel(false) }
    }
    document.addEventListener('click', onDocClick)
    return () => { document.removeEventListener('click', onDocClick) }
  }, [])



  if (readerVersion === 'v2') {
    const v2BgColor = readerTheme === 'yellow' ? '#FFFBEB' : readerTheme === 'green' ? '#DCFCE7' : readerTheme === 'blackWhite' ? '#000000' : '#FFFFFF'
    const v2TextColor = readerTheme === 'blackWhite' ? '#FFFFFF' : '#374151'
    return (
      <div className={`min-h-screen`} style={{ backgroundColor: v2BgColor }}>
        <style>{`
          .v2-range { appearance: none; -webkit-appearance: none; outline: none; border: none; background-color: transparent; width: 100%; height: 6px; border-radius: 9999px; }
          .v2-range::-webkit-slider-runnable-track { height: 6px; border-radius: 9999px; background: transparent; }
          .v2-range::-moz-range-track { height: 6px; border-radius: 9999px; background: #E5E7EB; }
          .v2-range.blackWhite::-moz-range-track { background: #4B5563; }
          .v2-range.white::-moz-range-progress { background: #374151; }
          .v2-range.yellow::-moz-range-progress { background: #F59E0B; }
          .v2-range.green::-moz-range-progress { background: #22C55E; }
          .v2-range.blackWhite::-moz-range-progress { background: #FFFFFF; }
          .v2-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 14px; height: 14px; border-radius: 9999px; border: none; margin-top: -4px; }
          .v2-range.white::-webkit-slider-thumb { background: #374151; }
          .v2-range.yellow::-webkit-slider-thumb { background: #F59E0B; }
          .v2-range.green::-webkit-slider-thumb { background: #22C55E; }
          .v2-range.blackWhite::-webkit-slider-thumb { background: #FFFFFF; }
          .v2-range::-moz-range-thumb { width: 14px; height: 14px; border-radius: 9999px; border: none; }
          .v2-range.white::-moz-range-thumb { background: #374151; }
          .v2-range.yellow::-moz-range-thumb { background: #F59E0B; }
          .v2-range.green::-moz-range-thumb { background: #22C55E; }
          .v2-range.blackWhite::-moz-range-thumb { background: #FFFFFF; }

          @keyframes v2-indeterminate {
            0% { left: -30%; }
            100% { left: 100%; }
          }
          .v2-progress-track { position: relative; overflow: hidden; }
          .v2-indeterminate { position: absolute; top: 0; bottom: 0; width: 30%; left: -30%; animation: v2-indeterminate 2.4s linear infinite; }
        `}</style>
        <header className="bg-transparent">
          <div className="max-w-3xl mx-auto px-6">
            <div className="flex justify-between items-center py-4">
              <div className="relative flex items-center">
                <button onClick={() => { try { localStorage.setItem('home_refresh', '1') } catch {} ; navigate('/') }} className="p-2 text-[#374151] hover:scale-105 active:scale-95">
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <select
                  value={currentChapter?.id || ''}
                  onChange={(e) => {
                    const ch = (useBooksStore.getState().chapters || []).find(c => c.id === e.target.value)
                    if (ch) {
                      setCurrentChapter(ch)
                      setIsParagraphsLoading(true)
                      const cached = preloadedParas[ch.id]
                      if (cached && Array.isArray(cached) && cached.length > 0) {
                        setParagraphs(cached)
                        setIsParagraphsLoading(false)
                      } else {
                        setParagraphs([])
                        fetchParagraphs(ch.id).finally(() => setIsParagraphsLoading(false))
                      }
                      setCurrentParagraphIndex(0)
                      setMergedStart(0)
                      setMergedEnd(0)
                      setSelectedIds([])
                      setHiddenMergedIds([])
                      setDeleteMenuPid(null)
                      setMergedImagesMap({})
                      setMergedTranslationsMap({})
                      setMergedNotesMap({})
                      setMergedAudiosMap({})
                      setShowTranslation(false)
                    }
                  }}
                  className="v2-chapter-trigger ml-3 text-xl font-semibold truncate w-[32rem] text-left bg-transparent border-none outline-none appearance-none hover:opacity-80"
                  style={{ color: v2TextColor }}
                  title={formatChapterTitle(currentChapter?.title || currentBook.title)}
                >
                  {(useBooksStore.getState().chapters || []).map(c => (
                    <option key={c.id} value={c.id}>{formatChapterTitle(c.title)}</option>
                  ))}
                </select>
              </div>
              <div className="relative">
                <button
                  onClick={() => setShowSettingsPanel(v => !v)}
                  className="v2-settings-trigger w-9 h-9 rounded-full backdrop-blur-lg shadow-sm inline-flex items-center justify-center hover:scale-105 active:scale-95"
                  style={{ backgroundColor: readerTheme === 'blackWhite' ? 'rgba(75,85,99,0.8)' : 'rgba(255,255,255,0.8)', color: readerTheme === 'blackWhite' ? '#F3F4F6' : '#374151' }}
                >
                  <Type className="h-5 w-5" />
                </button>
                {showSettingsPanel && (
                  <div className="v2-settings-menu absolute right-0 mt-2 w-64 rounded-xl shadow-lg ring-1 ring-black/5 p-3 z-50" style={{ boxShadow: '0 8px 30px rgba(0,0,0,0.12)', backgroundColor: readerTheme === 'blackWhite' ? '#1F2937' : '#FFFFFF', color: readerTheme === 'blackWhite' ? '#F3F4F6' : '#374151' }}>
                    <div className="space-y-3">
                      <div>
                        <div className="text-sm" style={{ color: (readerTheme === 'blackWhite' ? '#F3F4F6' : '#374151') }}>字号</div>
                        <input
                          type="range"
                          min={14}
                          max={24}
                          value={readerFontSize}
                          onChange={(e)=>setReaderFontSize(parseInt(e.target.value,10))}
                          className={`w-full v2-range ${readerTheme}`}
                          style={{
                            appearance: 'none',
                            WebkitAppearance: 'none',
                            outline: 'none',
                            border: 'none',
                            backgroundColor: 'transparent',
                            height: 6,
                            borderRadius: 9999,
                            backgroundImage: `linear-gradient(${readerTheme === 'yellow' ? '#F59E0B' : readerTheme === 'green' ? '#22C55E' : readerTheme === 'blackWhite' ? '#FFFFFF' : '#374151'}, ${readerTheme === 'yellow' ? '#F59E0B' : readerTheme === 'green' ? '#22C55E' : readerTheme === 'blackWhite' ? '#FFFFFF' : '#374151'}), linear-gradient(${readerTheme === 'blackWhite' ? '#4B5563' : '#E5E7EB'}, ${readerTheme === 'blackWhite' ? '#4B5563' : '#E5E7EB'})`,
                            backgroundRepeat: 'no-repeat',
                            backgroundSize: `${Math.round(((readerFontSize - 14) / (24 - 14)) * 100)}% 100%, 100% 100%`
                          }}
                        />
                      </div>
                      <div>
                        <div className="text-sm" style={{ color: (readerTheme === 'blackWhite' ? '#F3F4F6' : '#374151') }}>逐词速度</div>
                        <input
                          type="range"
                          min={40}
                          max={300}
                          value={spotlightWpm}
                          onChange={(e)=>{ const v = Math.max(40, Math.min(300, parseInt(e.target.value,10))); setSpotlightWpm(v); try { localStorage.setItem('spotlight_wpm', String(v)) } catch { void 0 } }}
                          className={`w-full v2-range ${readerTheme}`}
                          style={{
                            appearance: 'none',
                            WebkitAppearance: 'none',
                            outline: 'none',
                            border: 'none',
                            backgroundColor: 'transparent',
                            height: 6,
                            borderRadius: 9999,
                            backgroundImage: `linear-gradient(${readerTheme === 'yellow' ? '#F59E0B' : readerTheme === 'green' ? '#22C55E' : readerTheme === 'blackWhite' ? '#FFFFFF' : '#374151'}, ${readerTheme === 'yellow' ? '#F59E0B' : readerTheme === 'green' ? '#22C55E' : readerTheme === 'blackWhite' ? '#FFFFFF' : '#374151'}), linear-gradient(${readerTheme === 'blackWhite' ? '#4B5563' : '#E5E7EB'}, ${readerTheme === 'blackWhite' ? '#4B5563' : '#E5E7EB'})`,
                            backgroundRepeat: 'no-repeat',
                            backgroundSize: `${Math.round(((spotlightWpm - 40) / (300 - 40)) * 100)}% 100%, 100% 100%`
                          }}
                        />
                        <div className="mt-1 text-xs" style={{ color: (readerTheme === 'blackWhite' ? '#F3F4F6' : '#374151') }}>{spotlightWpm} 词/分钟</div>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="text-sm" style={{ color: (readerTheme === 'blackWhite' ? '#F3F4F6' : '#374151') }}>字体</div>
                        <div className="space-x-2">
                          <button onClick={()=>setReaderFontFamily('serif')} className={`px-3 py-1 rounded-full ${readerFontFamily==='serif'?'bg-amber-100 text-amber-700':'bg-gray-100 text-gray-700'} hover:scale-105 active:scale-95`}>Serif</button>
                          <button onClick={()=>setReaderFontFamily('sans-serif')} className={`px-3 py-1 rounded-full ${readerFontFamily==='sans-serif'?'bg-amber-100 text-amber-700':'bg-gray-100 text-gray-700'} hover:scale-105 active:scale-95`}>Sans</button>
                        </div>
                      </div>
                      <div>
                        <div className="text-sm" style={{ color: (readerTheme === 'blackWhite' ? '#F3F4F6' : '#374151') }}>主题</div>
                        <div className="flex items-center space-x-2 mt-1">
                          <button onClick={()=>{ setReaderTheme('white'); try { localStorage.setItem('reader_theme', 'white') } catch { void 0 } }} className="w-7 h-7 rounded-full bg-white border border-gray-300 hover:scale-105 active:scale-95" />
                          <button onClick={()=>{ setReaderTheme('yellow'); try { localStorage.setItem('reader_theme', 'yellow') } catch { void 0 } }} className="w-7 h-7 rounded-full bg-amber-100 hover:scale-105 active:scale-95" />
                          <button onClick={()=>{ setReaderTheme('green'); try { localStorage.setItem('reader_theme', 'green') } catch { void 0 } }} className="w-7 h-7 rounded-full bg-green-100 hover:scale-105 active:scale-95" />
                          <button onClick={()=>{ setReaderTheme('blackWhite'); try { localStorage.setItem('reader_theme', 'blackWhite') } catch { void 0 } }} className="w-7 h-7 rounded-full bg-black hover:scale-105 active:scale-95" />
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="text-sm" style={{ color: (readerTheme === 'blackWhite' ? '#F3F4F6' : '#374151') }}>双语模式</div>
                        <label className="inline-flex items-center cursor-pointer">
                          <input type="checkbox" checked={showTranslation} onChange={(e)=>setShowTranslation(e.target.checked)} />
                        </label>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>
        <main className="max-w-3xl mx-auto px-6 pb-32 pt-6">
          {paragraphs.length === 0 ? (
            <div className="py-12" />
          ) : (
            <div className="space-y-8">
              {paragraphs.slice(mergedStart, Math.min(mergedEnd + 1, visibleLimit)).filter(pp => !hiddenMergedIds.includes(getParagraphId(pp))).map((p)=>{
                const pid = getParagraphId(p)
                const tStore = (translations || []).find(t => t.paragraph_id === pid)?.translated_text || ''
                const tText = mergedTranslationsMap[pid] || tStore
                const imgUrl = (mergedImagesMap[pid] || [])[0]?.image_url || ''
                const showT = showTranslation || expandedTranslations.has(pid)
                return (
                  <div key={pid} className="group relative">
                    <div className="absolute -right-2 -bottom-3 opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="flex items-center space-x-1 bg-white/20 backdrop-blur-sm rounded-full px-1.5 py-0.5">
                        <button
                          onClick={async ()=>{ const has = expandedTranslations.has(pid); const next = new Set(expandedTranslations); if (has) { next.delete(pid) } else { next.add(pid); if (!tText || tText.length === 0) { setSelectedIds([pid]); await handleTranslation([pid]) } } setExpandedTranslations(next) }}
                          className="w-7 h-7 inline-flex items-center justify-center text-[#374151] hover:scale-105 active:scale-95"
                          title="翻译"
                        >
                          <Languages className="h-4 w-4" />
                        </button>
                        <button
                          onClick={()=>{ setSelectedIds([pid]); setImageDrawerPid(pid); setImagePromptText(''); setImageDrawerOpen(true) }}
                          className="w-7 h-7 inline-flex items-center justify-center text-[#374151] hover:scale-105 active:scale-95"
                          title="插图"
                        >
                          <Brush className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    <div className="whitespace-pre-wrap break-words" style={{ fontSize: readerFontSize, lineHeight: 1.8, color: v2TextColor, fontFamily: readerFontFamily }}>
                      {spotlightMode ? (
                        (() => {
                          const isCompleted = spotlightCompleted.has(pid)
                          const isCurrent = pid === getCurrentParagraphId()
                          const dim = readerTheme === 'blackWhite' ? 'rgba(255,255,255,0.35)' : 'rgba(55,65,81,0.35)'
                          const highlightBg = readerTheme === 'yellow' ? 'rgba(245,158,11,0.25)' : readerTheme === 'green' ? 'rgba(34,197,94,0.25)' : readerTheme === 'blackWhite' ? 'rgba(255,255,255,0.25)' : 'rgba(55,65,81,0.12)'
                          if (isCompleted) return p.content
                          const currIdx = typeof spotlightSentenceMap[pid] === 'number' ? spotlightSentenceMap[pid] : -1
                          if (!isCurrent && currIdx < 0) return <span style={{ color: dim }}>{p.content}</span>
                          const sents = splitSentences(p.content || '')
                          return sents.map((s, i) => {
                            const tokens = Array.from(s.matchAll(/\S+/g))
                            if (tokens.length === 0) return <span key={i} style={{ color: i !== currIdx ? dim : undefined }}>{s}</span>
                            const nodes: any[] = []
                            let last = 0
                            let wordIdx = 0
                            tokens.forEach((m, idx2) => {
                              const start = m.index || 0
                              const end = start + m[0].length
                              if (start > last) nodes.push(<span key={`${i}-pre-${idx2}`}>{s.slice(last, start)}</span>)
                              const isWord = /[A-Za-z0-9\u4e00-\u9fff]/.test(m[0])
                              const isCurrTok = (i === currIdx) && isWord && (wordIdx === spotlightTokenIndex)
                              nodes.push(<span key={`${i}-tok-${idx2}`} style={{ backgroundColor: isCurrTok ? highlightBg : 'transparent' }}>{m[0]}</span>)
                              if (isWord) wordIdx += 1
                              last = end
                            })
                            if (last < s.length) nodes.push(<span key={`${i}-tail`}>{s.slice(last)}</span>)
                            return <span key={i} style={{ color: i !== currIdx ? dim : undefined }}>{nodes}</span>
                          })
                        })()
                      ) : p.content}
                    </div>
                    {showT && tText && (
                      <div className="mt-3 whitespace-pre-wrap break-words" style={{ fontSize: Math.round(readerFontSize*0.95), lineHeight: 1.6, color: '#71717A', fontFamily: 'sans-serif' }}>
                        {tText}
                      </div>
                    )}
                    {imgUrl && (
                      <div className="mt-3 rounded-xl shadow-md overflow-hidden">
                        <img src={imgUrl} className="w-full object-contain" />
                      </div>
                    )}
                  </div>
                )
              })}
              <div ref={listBottomRef} />
            </div>
          )}
        </main>
        {imageDrawerOpen && (
          <div className="fixed top-0 right-0 h-full w-[320px] z-50">
            <div className="h-full bg-white/80 backdrop-blur-lg shadow-lg ring-1 ring-black/5 p-4 flex flex-col" style={{ boxShadow: '0 8px 30px rgba(0,0,0,0.12)' }}>
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-medium" style={{ color: '#374151' }}>插图提示词</div>
                <button onClick={()=>setImageDrawerOpen(false)} className="w-8 h-8 inline-flex items-center justify-center rounded-full bg-white/70 text-[#374151] hover:scale-105 active:scale-95"><ChevronRight className="h-4 w-4" /></button>
              </div>
              <textarea value={imagePromptText} onChange={(e)=>setImagePromptText(e.target.value)} className={`flex-1 rounded-lg border border-gray-300 p-2 bg-white/90 focus:outline-none focus:ring-2 ${readerTheme === 'yellow' ? 'focus:ring-amber-500 focus:border-amber-500' : readerTheme === 'green' ? 'focus:ring-green-500 focus:border-green-500' : readerTheme === 'blackWhite' ? 'focus:ring-white focus:border-white' : 'focus:ring-gray-300 focus:border-gray-300'}`} placeholder="描述插图要点" />
              <button onClick={async ()=>{ setSelectedIds([imageDrawerPid]); await handleImageGeneration(); setImageDrawerOpen(false) }} className="mt-3 w-full h-10 rounded-full bg-amber-500 text-white hover:scale-105 active:scale-95">生成插图</button>
            </div>
          </div>
        )}
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <div
            className="px-4 py-2 rounded-full backdrop-blur-lg shadow-lg ring-1 ring-black/5 flex items-center space-x-3"
            style={{ boxShadow: '0 8px 30px rgba(0,0,0,0.12)', backgroundColor: readerTheme === 'blackWhite' ? 'rgba(75,85,99,0.8)' : 'rgba(255,255,255,0.8)' }}
          >
            <button onClick={()=>{ if (spotlightMode) { setSpotlightMode(false); setSpotlightTokenIndex(-1); if (spotlightTimerRef.current) { clearTimeout(spotlightTimerRef.current); spotlightTimerRef.current = null } } else { const pid = getCurrentParagraphId(); if (pid) { setSpotlightMode(true); setSpotlightSentenceMap(prev => ({ ...prev, [pid]: typeof prev[pid] === 'number' && prev[pid] >= 0 ? prev[pid] : 0 })); setSpotlightCompleted(prev => { const s = new Set(prev); s.delete(pid); return s }); setSpotlightTokenIndex(-1) } } }} className="w-10 h-10 rounded-full inline-flex items-center justify-center hover:scale-105 active:scale-95 focus:outline-none" style={{ backgroundColor: spotlightMode ? (readerTheme === 'yellow' ? '#F59E0B' : readerTheme === 'green' ? '#22C55E' : readerTheme === 'blackWhite' ? '#FFFFFF' : '#374151') : (readerTheme === 'blackWhite' ? '#FFFFFF' : '#FFFFFF'), color: spotlightMode ? (readerTheme === 'blackWhite' ? '#374151' : '#FFFFFF') : (readerTheme === 'blackWhite' ? '#374151' : '#374151') }}>
              {spotlightMode ? (<Square className="h-5 w-5" />) : (<Play className="h-5 w-5" />)}
            </button>
            <div
              className="w-40 h-1.5 rounded-full v2-progress-track"
              style={{ backgroundColor: (readerTheme === 'blackWhite' ? '#4B5563' : '#E5E7EB') }}
            >
              {paragraphs.length === 0 ? (
                <div
                  className="v2-indeterminate rounded-full"
                  style={{ backgroundColor: (readerTheme === 'yellow' ? '#F59E0B' : readerTheme === 'green' ? '#22C55E' : readerTheme === 'blackWhite' ? '#FFFFFF' : '#374151') }}
                />
              ) : (
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${paragraphs.length > 0 ? Math.round(((currentParagraphIndex + 1) / paragraphs.length) * 100) : 0}%`,
                    backgroundColor: (readerTheme === 'yellow' ? '#F59E0B' : readerTheme === 'green' ? '#22C55E' : readerTheme === 'blackWhite' ? '#FFFFFF' : '#374151')
                  }}
                />
              )}
            </div>
            <button
              onClick={async ()=>{ if (isPlaying) { stopPlaying() } else { await tryPlayPreloaded(getCurrentParagraphId()); const a = currentAudio; if (a) { try { a.onended = async () => { setCurrentAudio(null); setIsPlaying(false); await handleNextParagraph(); await tryPlayPreloaded(getCurrentParagraphId()) } } catch {} } } }}
              className="w-9 h-9 rounded-full inline-flex items-center justify-center hover:scale-105 active:scale-95 focus:outline-none"
              style={{ backgroundColor: (isPlaying || isTtsPending) ? (readerTheme === 'yellow' ? '#F59E0B' : readerTheme === 'green' ? '#22C55E' : readerTheme === 'blackWhite' ? '#FFFFFF' : '#374151') : (readerTheme === 'blackWhite' ? 'rgba(75,85,99,0.9)' : '#FFFFFF'), color: (isPlaying || isTtsPending) ? (readerTheme === 'blackWhite' ? '#374151' : '#FFFFFF') : (readerTheme === 'blackWhite' ? '#F3F4F6' : '#374151' ) }}
            >
              {isPlaying ? (
                <Mic className="h-5 w-5 animate-pulse" />
              ) : (
                <Volume2 className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-screen-2xl mx-auto px-6 lg:px-10">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center">
              <button
                onClick={() => { try { localStorage.setItem('home_refresh', '1') } catch { } ; navigate('/') }}
                className="mr-4 p-2 text-gray-600 hover:text-gray-900"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div>
                <h1 className="text-xl font-bold text-gray-900">{currentBook.title}</h1>
                {(() => {
                  const r = getVisibleRange()
                  const ci = currentChapter ? ((chapters || []).findIndex(c => c.id === currentChapter.id) + 1) : 0
                  const ct = (chapters || []).length
                  const p = r.start === r.end ? (r.start + 1) : `${r.start + 1}-${r.end + 1}`
                  const loading = (isParagraphsLoading || loadingProgress < 100) ? ' 加载中…' : ''
                  const paraPart = (paragraphs.length > 0) ? ` 段落 ${p} / ${paragraphs.length}` : ''
                  return (<p className="text-sm text-gray-600">章节 {ci} / {ct}{paraPart}{loading}</p>)
                })()}
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <select
                value={currentChapter?.id || ''}
                onChange={(e) => {
                  const ch = (useBooksStore.getState().chapters || []).find(c => c.id === e.target.value)
                  if (ch) {
                    setCurrentChapter(ch)
                    setIsParagraphsLoading(true)
                    const cached = preloadedParas[ch.id]
                    if (cached && Array.isArray(cached) && cached.length > 0) {
                      setParagraphs(cached)
                    } else {
                      setParagraphs([])
                    }
                    setCurrentParagraphIndex(0)
                    setMergedStart(0)
                    setMergedEnd(0)
                    setSelectedIds([])
                    setHiddenMergedIds([])
                    setDeleteMenuPid(null)
                    setMergedImagesMap({})
                    setMergedTranslationsMap({})
                    setMergedNotesMap({})
                    setMergedAudiosMap({})
                    setShowTranslation(false)
                if (isSupabaseConfigured && currentBook) {
                  fetchParagraphs(ch.id).finally(() => setIsParagraphsLoading(false))
                } else {
                  setIsParagraphsLoading(false)
                }
                  }
                }}
                title={currentChapter?.title || ''}
                className={`px-3 py-2 rounded-md border border-slate-300 bg-white text-sm text-slate-800 shadow-sm focus:outline-none focus:ring-2 w-64 truncate ${readerTheme === 'yellow' ? 'focus:ring-amber-500 focus:border-amber-500' : readerTheme === 'green' ? 'focus:ring-green-500 focus:border-green-500' : readerTheme === 'blackWhite' ? 'focus:ring-white focus:border-white' : 'focus:ring-slate-300 focus:border-slate-300'}`}
              >
                {(useBooksStore.getState().chapters || []).map(c => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
              {/* 章切换按钮已移除 */}
              <select
                value={String(currentParagraphIndex + 1)}
                onChange={async (e) => {
                  const v = parseInt(e.target.value, 10)
                  if (!isNaN(v)) {
                    const idx = Math.max(0, Math.min(v - 1, paragraphs.length - 1))
                    setCurrentParagraphIndex(idx)
                    setMergedStart(idx)
                    setMergedEnd(idx)
                    ensureMergedData(idx, idx)
                    try {
                      const vis = paragraphs
                        .slice(idx, Math.min(idx + 1, paragraphs.length))
                        .filter(pp => !hiddenMergedIds.includes(getParagraphId(pp)))
                        .map(pp => getParagraphId(pp))
                      setSelectedIds(vis)
                      if (showVoicePanel && !isTtsPending) { await tryPlayPreloaded(vis[0]) }
                      if (showTranslation && !isTranslating) { await handleTranslation(vis) }
                    } catch { }
                  }
                }}
                className={`w-16 px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 bg-white text-center focus:outline-none focus:ring-2 ${readerTheme === 'yellow' ? 'focus:ring-amber-500 focus:border-amber-500' : readerTheme === 'green' ? 'focus:ring-green-500 focus:border-green-500' : readerTheme === 'blackWhite' ? 'focus:ring-white focus:border-white' : 'focus:ring-gray-300 focus:border-gray-300'}`}
              >
                {Array.from({ length: Math.max(paragraphs.length, 1) }, (_, i) => (
                  <option key={i} value={String(i + 1)}>{i + 1}</option>
                ))}
              </select>
              {/* 段落切换按钮移至阅读区右侧 */}

              {/* 操作按钮已移至内容区域上方的独立容器 */}
            </div>
            {/* 移除此处按钮，改为放入阅读窗口容器内部 */}
          </div>
        </div>
      </header>

      <div className="max-w-screen-2xl mx-auto px-6 lg:px-10 py-8">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Main Reading Area */}
        <div className="lg:col-span-3">
          <div className={`${readerTheme === 'yellow' ? 'bg-amber-50' : readerTheme === 'green' ? 'bg-green-50' : readerTheme === 'grayWhite' ? 'bg-gray-700' : readerTheme === 'lightGrayWhite' ? 'bg-gray-600' : readerTheme === 'blackWhite' ? 'bg-black' : 'bg-white'} rounded-lg shadow-md p-8 mb-6 w-full relative`}>
            <div className="w-full">
                {isParagraphsLoading && paragraphs.length === 0 ? (
                  <div className="py-12" />
                ) : paragraphs.length === 0 ? (
                  <div className="py-12" />
                ) : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-2">
                      <div className="lg:col-span-12 relative space-y-2 px-6">
                        {(() => {
                          const list = paragraphs
                            .slice(mergedStart, Math.min(mergedEnd + 1, visibleLimit))
                            .filter(pp => !hiddenMergedIds.includes(getParagraphId(pp)))
                          const visibleCount = list.length
                          return list.map((p) => {
                            const pid = getParagraphId(p)
                            const imgUrl = (mergedImagesMap[pid] || [])[0]?.image_url || ''
                            const storeText = (translations || []).find(t => t.paragraph_id === pid)?.translated_text || ''
                            const tText = mergedTranslationsMap[pid] || storeText
                            const nList = mergedNotesMap[pid] || []
                            const aList = mergedAudiosMap[pid] || []
                            return (
                              <div id={`para-${pid}`} key={pid} className={`group w-full rounded-md p-3 relative`}>
                            <div className="flex items-start">
                              <div className="flex-1 pr-2">
                                <p className={`leading-relaxed ${readerTheme === 'grayWhite' || readerTheme === 'blackWhite' || readerTheme === 'lightGrayWhite' ? 'text-white' : (readerTheme === 'whiteBlack' ? 'text-black' : 'text-gray-800')} w-full whitespace-pre-wrap break-words`} style={{ fontSize: readerFontSize, fontFamily: readerFontFamily }}>{p.content}</p>
                                {tText && (
                                  <div className={`mt-4 rounded-md p-2 whitespace-pre-wrap break-words border ${readerTheme === 'grayWhite' || readerTheme === 'blackWhite' || readerTheme === 'lightGrayWhite' ? 'bg-white/10 text-white border-white/20' : 'bg-blue-50 text-blue-900 border-blue-200'}`} style={{ fontSize: Math.max(10, readerFontSize - 2), fontFamily: readerFontFamily }}>{tText}</div>
                                )}
                                {imgUrl && (
                                  <div className="mt-2 border border-slate-200 rounded-lg overflow-hidden bg-slate-50">
                                    <img src={imgUrl} alt="插画" className="w-full object-contain" />
                                  </div>
                                )}
                                {nList.length > 0 && (
                                  <div className="mt-2 space-y-1">
                                    {nList.map(n => (
                                      <div key={n.id} className="border border-slate-200 rounded-md p-2">
                                        <div className="flex items-center justify-between mb-1">
                                          <span className={`text-xs font-medium ${n.user_type === 'parent' ? 'text-blue-600' : 'text-green-600'}`}>{n.user_type === 'parent' ? '家长' : '孩子'}</span>
                                          <span className="text-xs text-slate-500">{new Date(n.created_at).toLocaleString()}</span>
                                        </div>
                                        <p className="text-sm text-slate-800 whitespace-pre-wrap break-words">{n.content}</p>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {aList.length > 0 && (
                                  <div className="mt-2">
                                    <button onClick={() => { const url = aList[0]?.audio_url || ''; if (url) { const audio = new Audio(url); audio.play() } }} className="px-3 py-2 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700">播放语音</button>
                                  </div>
                                )}
                              </div>
                              {/* 卡片不再内置左右按钮 */}
                            </div>
                          </div>
                            )
                          })
                        })()}
                        <div ref={listBottomRef} />
                        { (currentParagraphIndex > 0 || mergedStart > 0) && (
                          <button onClick={handlePreviousParagraph} aria-label="上一段" className="group absolute left-0 top-0 bottom-0 w-6 bg-transparent text-slate-400 hover:bg-slate-100 hover:rounded-md flex items-center justify-center">
                            <span className="block group-hover:hidden text-sm font-bold -rotate-90">⌃</span>
                            <span style={{ writingMode: 'vertical-rl' }} className="hidden group-hover:block text-xs font-bold">上 一 段</span>
                          </button>
                        )}
                        { (currentParagraphIndex < paragraphs.length - 1 || mergedEnd < paragraphs.length - 1 || hasNextChapter()) && (
                          <button onClick={handleNextParagraph} aria-label="下一段" className="group absolute right-0 top-0 bottom-0 w-6 bg-transparent text-slate-400 hover:bg-slate-100 hover:rounded-md flex items-center justify-center">
                            <span className="block group-hover:hidden text-sm font-bold rotate-90">⌃</span>
                            <span style={{ writingMode: 'vertical-rl' }} className="hidden group-hover:block text-xs font-bold">下 一 段</span>
                          </button>
                        )}
                      </div>
                    </div>
                    {mergedEnd < paragraphs.length - 1 && (
                      <div className="w-full">
                        {mergedEnd > mergedStart ? (
                          <div className="grid grid-cols-3 gap-1">
                            <button
                              onClick={() => { const ne = Math.max(mergedStart, mergedEnd - 1); setMergedEnd(ne); ensureMergedData(mergedStart, ne) }}
                              className="group col-span-1 h-6 bg-transparent text-slate-400 text-xs rounded-md flex items-center justify-center hover:bg-slate-100"
                              aria-label="缩小下方"
                              title="缩小下方"
                            >
                              <span className="block group-hover:hidden text-sm font-bold">⌃</span>
                              <span className="hidden group-hover:block text-xs font-bold">收缩阅读窗口</span>
                            </button>
                            <button
                              onClick={extendDown}
                              className="group col-span-2 h-6 bg-transparent text-slate-400 text-xs rounded-md flex items-center justify-center hover:bg-slate-100"
                              aria-label="向下扩展"
                              title="向下扩展"
                            >
                              <span className="block group-hover:hidden text-sm font-bold rotate-180">⌃</span>
                              <span className="hidden group-hover:block text-xs font-bold">拓展阅读窗口</span>
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={extendDown}
                            className="group w-full h-6 bg-transparent text-slate-400 text-xs rounded-md flex items-center justify-center hover:bg-slate-100"
                            aria-label="向下扩展"
                            title="向下扩展"
                          >
                            <span className="block group-hover:hidden text-sm font-bold rotate-180">⌃</span>
                            <span className="hidden group-hover:block text-xs font-bold">拓展阅读窗口</span>
                          </button>
                        )}
                      </div>
                    )}
                    {(paragraphs.length > 0) && (isParagraphsLoading || loadingProgress < 100) && (
                      <div className="mt-3 text-xs text-slate-600 text-center" />
                    )}
                  </div>
                )}
              </div>

              {/* 阅读窗口右侧按钮改为贴在当前段落蓝框右侧的卡片内 */}
            </div>
          </div>

          <div className="lg:col-span-1 space-y-6">
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 px-4 py-2 flex items-center justify-evenly w-full">
              <button
                onClick={async () => { const next = !showVoicePanel; setShowVoicePanel(next); if (next) { stopPlaying(); await handleTextToSpeech() } else { stopPlaying() } }}
                onMouseEnter={() => setHoverVoice(true)}
                onMouseLeave={() => setHoverVoice(false)}
                className={`w-9 h-9 inline-flex items-center justify-center rounded-md ${isPlaying ? 'bg-blue-100 text-blue-600 animate-pulse' : (showVoicePanel ? 'bg-blue-100 text-blue-600' : (hoverVoice ? 'bg-gray-100 text-gray-700' : 'text-gray-600'))}`}
                title="语音"
              >
                <Volume2 className="h-5 w-5" />
              </button>
              <button
                onClick={() => { const next = !showTranslation; setShowTranslation(next); if (next) { if (!isTranslating) { const ids = getOrderedSelectedIds(); const targetId = ids[0]; const storeText = (translations || []).find(t => t.paragraph_id === targetId)?.translated_text || ''; const tText = mergedTranslationsMap[targetId] || storeText; if (!tText || tText.length === 0 || needsRetranslate) { handleTranslation(); setNeedsRetranslate(false) } } } }}
                onMouseEnter={() => setHoverTranslation(true)}
                onMouseLeave={() => setHoverTranslation(false)}
                className={`w-9 h-9 inline-flex items-center justify-center rounded-md ${showTranslation ? 'bg-blue-100 text-blue-600' : (hoverTranslation ? 'bg-gray-100 text-gray-700' : 'text-gray-600')}`}
                title="翻译"
              >
                <Languages className="h-5 w-5" />
              </button>
              <button
                onClick={() => { const next = !showImagePanel; setShowImagePanel(next) }}
                onMouseEnter={() => setHoverImage(true)}
                onMouseLeave={() => setHoverImage(false)}
                className={`w-9 h-9 inline-flex items-center justify-center rounded-md ${isGeneratingImage ? 'bg-blue-100 text-blue-600 animate-pulse' : (showImagePanel ? 'bg-blue-100 text-blue-600' : (hoverImage ? 'bg-gray-100 text-gray-700' : 'text-gray-600'))}`}
                title="图片"
              >
                <Image className="h-5 w-5" />
              </button>
              <button
                onClick={() => { const next = !showDiscussion; setShowDiscussion(next) }}
                onMouseEnter={() => setHoverDiscussion(true)}
                onMouseLeave={() => setHoverDiscussion(false)}
                className={`w-9 h-9 inline-flex items-center justify-center rounded-md ${showDiscussion ? 'bg-blue-100 text-blue-600' : (hoverDiscussion ? 'bg-gray-100 text-gray-700' : 'text-gray-600')}`}
                title="讨论"
              >
              <MessageSquare className="h-5 w-5" />
              </button>
              <button
                onClick={() => { const next = !showSettingsPanel; setShowSettingsPanel(next) }}
                className={`w-9 h-9 inline-flex items-center justify-center rounded-md ${showSettingsPanel ? 'bg-blue-100 text-blue-600' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-700'}`}
                title="设置"
              >
                <Type className="h-5 w-5" />
              </button>
            </div>
            {(showVoicePanel || hoverVoice) && (
              <div className="bg-white rounded-lg shadow-md p-6 border border-slate-200 relative">

                <div>
                  <div className="mb-2 px-4 flex items-center justify-evenly">
                    <button onClick={playLatestAudio} className={`w-9 h-9 inline-flex items-center justify-center rounded-md ${isPlaying ? 'bg-blue-100 text-blue-600 animate-pulse' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`} title={currentAudio ? '停止朗读' : '生成并播放'}>
                      {currentAudio ? (<Square className="h-5 w-5" />) : (<Play className="h-5 w-5" />)}
                    </button>
                    <button onClick={() => setShowTtsConfig(!showTtsConfig)} className="w-9 h-9 inline-flex items-center justify-center rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200" title="参数">
                      <Settings className="h-5 w-5" />
                    </button>
                  </div>
                  {(() => {
                    const ids = getOrderedSelectedIds(); const preview = getCombinedText(ids); return (
                      <div className="mb-2">
                        <div className="text-xs text-slate-600 mb-1">待阅读文本</div>
                        <div className="border border-slate-200 rounded-md p-2 bg-white text-xs text-slate-800 whitespace-pre-wrap break-words min-h-[48px]">
                          {(() => {
                            const segments = ids.map(id => {
                              const p = paragraphs.find(pp => getParagraphId(pp) === id)
                              return (p?.content || '').trim()
                            }).filter(s => s && s.length > 0)
                            if (segments.length === 0) return <span className="text-slate-400">请在左侧选中段落文本</span>
                            return (
                              <div>
                                {segments.map((s, i) => (
                                  <div key={i} style={{ ['WebkitLineClamp']: 2, ['WebkitBoxOrient']: 'vertical', overflow: 'hidden', display: '-webkit-box' }}>{s}</div>
                                ))}
                              </div>
                            )
                          })()}
                        </div>
                      </div>
                    )
                  })()}
                  {showTtsConfig && (
                    <div className="border border-slate-200 rounded-md p-3 mb-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-slate-700 text-xs mb-1">音色</label>
                          <select
                            value={VOICE_OPTIONS.includes(ttsVoiceType) ? ttsVoiceType : '__custom__'}
                            onChange={(e) => { const v = e.target.value; if (v === '__custom__') { setShowVoiceCustom(true) } else { setShowVoiceCustom(false); setTtsVoiceType(v); try { localStorage.setItem('volc_tts_voice_type', v) } catch { void 0 } } }}
                            className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm bg-white"
                          >
                            {VOICES.map(opt => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                            <option value="__custom__">自定义...</option>
                          </select>
                          {showVoiceCustom && (
                            <input value={ttsVoiceType} onChange={(e) => { setTtsVoiceType(e.target.value); try { localStorage.setItem('volc_tts_voice_type', e.target.value) } catch { void 0 } }} className="mt-2 w-full px-3 py-2 border border-slate-300 rounded-md text-sm" placeholder="自定义音色ID" />
                          )}
                        </div>
                        <div>
                          <label className="block text-slate-700 text-xs mb-1">语言</label>
                          <input value={ttsLanguage} onChange={(e) => { setTtsLanguage(e.target.value); try { localStorage.setItem('volc_tts_language', e.target.value) } catch { void 0 } }} className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm" placeholder="cn 或 en（留空自动）" />
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-3 mt-3">
                        <div>
                          <label className="block text-slate-700 text-xs mb-1">语速</label>
                          <input type="number" step="0.1" min="0.2" max="3" value={ttsSpeed} onChange={(e) => { const v = parseFloat(e.target.value); setTtsSpeed(v); try { localStorage.setItem('volc_tts_speed_ratio', String(v)) } catch { void 0 } }} className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm" />
                        </div>
                        <div>
                          <label className="block text-slate-700 text-xs mb-1">音量</label>
                          <input type="number" step="0.1" min="0.1" max="3" value={ttsVolume} onChange={(e) => { const v = parseFloat(e.target.value); setTtsVolume(v); try { localStorage.setItem('volc_tts_volume_ratio', String(v)) } catch { void 0 } }} className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm" />
                        </div>
                        <div>
                          <label className="block text-slate-700 text-xs mb-1">音高</label>
                          <input type="number" step="0.1" min="0.1" max="3" value={ttsPitch} onChange={(e) => { const v = parseFloat(e.target.value); setTtsPitch(v); try { localStorage.setItem('volc_tts_pitch_ratio', String(v)) } catch { void 0 } }} className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm" />
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="space-y-2">
                    {(audios || []).map(a => (
                      <div key={a.id} className="flex items-center justify-between border border-slate-200 rounded-md p-2">
                        <button onClick={() => { const audio = new Audio(a.audio_url); audio.play() }} className="px-2 py-1 rounded-md bg-slate-100 text-slate-700 text-xs hover:bg-slate-200">播放</button>
                        <button onClick={() => { if (currentBook) { deleteAudio(getBookKey(), getCurrentParagraphId(), a.id); ensureMergedData(mergedStart, mergedEnd) } }} className="px-2 py-1 rounded-md bg-red-600 text-white text-xs hover:bg-red-700">删除</button>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 text-xs text-slate-700">
                    {isTtsPending && <span>合成中...</span>}
                    {!isTtsPending && ttsStatus === 'success' && ttsSource === 'doubao' && <span>豆包合成成功（音色: {lastTtsModel || ttsVoiceType}）</span>}
                    {!isTtsPending && ttsStatus === 'fallback' && ttsSource === 'browser' && <span>使用本机朗读</span>}
                    {!isTtsPending && ttsStatus === 'error' && <span className="text-red-700">豆包合成失败</span>}
                    {!isTtsPending && ttsStatus === 'error' && ttsDebug?.error && (
                      <span className="block text-red-700">错误：{String(ttsDebug.error)}</span>
                    )}
                  </div>
                </div>
              </div>
            )}
            {showSettingsPanel && (
              <div className="bg-white rounded-xl shadow-md p-6 border border-slate-200">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-2">
                    <Type className="h-5 w-5 text-slate-700" />
                    <span className="text-sm font-medium text-slate-800">文字设置</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button onClick={() => { setReaderFontSize(16); try { localStorage.setItem('reader_font_size', '16') } catch { void 0 } }} className="px-2 py-1 rounded-md text-xs bg-slate-100 text-slate-700 hover:bg-slate-200">小</button>
                    <button onClick={() => { setReaderFontSize(18); try { localStorage.setItem('reader_font_size', '18') } catch { void 0 } }} className="px-2 py-1 rounded-md text-xs bg-slate-100 text-slate-700 hover:bg-slate-200">中</button>
                    <button onClick={() => { setReaderFontSize(22); try { localStorage.setItem('reader_font_size', '22') } catch { void 0 } }} className="px-2 py-1 rounded-md text-xs bg-slate-100 text-slate-700 hover:bg-slate-200">大</button>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <label className="block text-slate-700 text-xs mb-1">文字大小（{readerFontSize}px）</label>
                    <input type="range" min={12} max={28} step={1} value={readerFontSize} onChange={(e) => { const v = parseInt(e.target.value, 10); setReaderFontSize(v); try { localStorage.setItem('reader_font_size', String(v)) } catch { void 0 } }} className="w-full" />
                  </div>
                  <div>
                    <label className="block text-slate-700 text-xs mb-1">字体</label>
                    <select value={readerFontFamily} onChange={(e) => { const v = e.target.value; setReaderFontFamily(v); try { localStorage.setItem('reader_font_family', v) } catch { void 0 } }} className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm bg-white">
                      <option value="system-ui">系统默认</option>
                      <option value="serif">Serif</option>
                      <option value="sans-serif">Sans-serif</option>
                      <option value="monospace">Monospace</option>
                      <option value="Georgia, serif">Georgia</option>
                      <option value="'Times New Roman', serif">Times New Roman</option>
                      <option value="Arial, sans-serif">Arial</option>
                      <option value="'Helvetica Neue', Helvetica, Arial, sans-serif">Helvetica</option>
                      <option value="Verdana, Geneva, sans-serif">Verdana</option>
                      <option value="'Trebuchet MS', sans-serif">Trebuchet MS</option>
                      <option value="Palatino, 'Palatino Linotype', 'Book Antiqua', serif">Palatino</option>
                      <option value="Garamond, serif">Garamond</option>
                      <option value="'Courier New', Courier, monospace">Courier New</option>
                      <option value="'Segoe UI', Tahoma, Geneva, Verdana, sans-serif">Segoe UI</option>
                      <option value="Calibri, 'Segoe UI', Arial, sans-serif">Calibri</option>
                      <option value="'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', 'Liberation Sans', sans-serif">Inter（阅读优化 Sans）</option>
                      <option value="'Roboto', 'Helvetica Neue', Arial, 'Noto Sans', sans-serif">Roboto（通用 Sans）</option>
                      <option value="'Lora', Georgia, serif">Lora（阅读优化 Serif）</option>
                      <option value="'Merriweather', Georgia, serif">Merriweather（阅读优化 Serif）</option>
                      <option value="'Source Serif 4', Georgia, serif">Source Serif 4（现代 Serif）</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-700 text-xs mb-1">背景色</label>
                    <div className="grid grid-cols-3 gap-2">
                      <button onClick={() => { setReaderTheme('whiteBlack'); try { localStorage.setItem('reader_theme', 'whiteBlack') } catch { void 0 } }} className={`h-10 rounded-md border ${readerTheme === 'whiteBlack' ? 'ring-2 ring-blue-500 border-blue-500' : 'border-slate-300'} bg-white text-black`}>Aa</button>
                      <button onClick={() => { setReaderTheme('yellow'); try { localStorage.setItem('reader_theme', 'yellow') } catch { void 0 } }} className={`h-10 rounded-md border ${readerTheme === 'yellow' ? 'ring-2 ring-blue-500 border-blue-500' : 'border-slate-300'} bg-amber-50 text-slate-900`}>Aa</button>
                      <button onClick={() => { setReaderTheme('green'); try { localStorage.setItem('reader_theme', 'green') } catch { void 0 } }} className={`h-10 rounded-md border ${readerTheme === 'green' ? 'ring-2 ring-blue-500 border-blue-500' : 'border-slate-300'} bg-green-50 text-slate-900`}>Aa</button>
                      <button onClick={() => { setReaderTheme('lightGrayWhite'); try { localStorage.setItem('reader_theme', 'lightGrayWhite') } catch { void 0 } }} className={`h-10 rounded-md border ${readerTheme === 'lightGrayWhite' ? 'ring-2 ring-blue-500 border-blue-500' : 'border-slate-300'} bg-gray-600 text-white`}>Aa</button>
                      <button onClick={() => { setReaderTheme('grayWhite'); try { localStorage.setItem('reader_theme', 'grayWhite') } catch { void 0 } }} className={`h-10 rounded-md border ${readerTheme === 'grayWhite' ? 'ring-2 ring-blue-500 border-blue-500' : 'border-slate-300'} bg-gray-700 text-white`}>Aa</button>
                      <button onClick={() => { setReaderTheme('blackWhite'); try { localStorage.setItem('reader_theme', 'blackWhite') } catch { void 0 } }} className={`h-10 rounded-md border ${readerTheme === 'blackWhite' ? 'ring-2 ring-blue-500 border-blue-500' : 'border-slate-300'} bg-black text-white`}>Aa</button>
                    </div>
                  </div>
                  <div className="border border-slate-200 rounded-md p-3 bg-slate-50">
                    <div className="text-xs text-slate-600 mb-1">预览</div>
                    <div className={`${readerTheme === 'yellow' ? 'bg-amber-50' : readerTheme === 'green' ? 'bg-green-50' : readerTheme === 'grayWhite' ? 'bg-gray-700' : readerTheme === 'lightGrayWhite' ? 'bg-gray-600' : readerTheme === 'blackWhite' ? 'bg-black' : 'bg-white'} rounded-md p-3 ${readerTheme === 'grayWhite' || readerTheme === 'blackWhite' || readerTheme === 'lightGrayWhite' ? 'text-white' : (readerTheme === 'whiteBlack' ? 'text-black' : 'text-slate-800')}`} style={{ fontSize: readerFontSize, fontFamily: readerFontFamily }}>
                      这是一段示例文本，用于预览当前设置。
                    </div>
                  </div>
                </div>
              </div>
            )}
            {(showTranslation || hoverTranslation) && (
              <div className="bg-white rounded-lg shadow-md p-6 border border-blue-200 relative">
                <div className="mb-2 px-4 flex items-center justify-evenly">
                  <button onClick={() => handleTranslation()} className={`w-9 h-9 inline-flex items-center justify-center rounded-md ${isTranslating ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`} title="执行翻译">
                    <RefreshCw className={`h-5 w-5 ${isTranslating ? 'animate-spin' : ''}`} />
                  </button>
                  <button onClick={() => setShowTranslationConfig(!showTranslationConfig)} className="w-9 h-9 inline-flex items-center justify-center rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200" title="设置">
                    <Settings className="h-5 w-5" />
                  </button>
                </div>
                {showTranslationConfig && (
                  <div className="border border-blue-200 rounded-md p-3 mb-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-slate-700 text-xs mb-1">提供商</label>
                        <select
                          value={translationProvider}
                          onChange={(e) => { const v = e.target.value; setTranslationProvider(v); try { localStorage.setItem('translation_provider', v) } catch { void 0 }; setNeedsRetranslate(true) }}
                          className="w-full px-3 py-2 border border-blue-300 rounded-md text-sm bg-white"
                        >
                          <option value="gemini">Google Gemini</option>
                          <option value="openrouter">OpenRouter</option>
                        </select>
                      </div>
                      {translationProvider === 'openrouter' && (
                        <div>
                          <label className="block text-slate-700 text-xs mb-1">模型</label>
                          <select
                            value={translationOpenRouterModel}
                            onChange={(e) => { const v = e.target.value; setTranslationOpenRouterModel(v); try { localStorage.setItem('translation_openrouter_model', v) } catch { void 0 }; setNeedsRetranslate(true) }}
                            className="w-full px-3 py-2 border border-blue-300 rounded-md text-sm bg-white"
                          >
                            <option value="x-ai/grok-4.1-fast:free">x-ai/grok-4.1-fast:free</option>
                          </select>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {(() => {
                  const ids = getOrderedSelectedIds()
                  return (
                    <div className="mb-2">
                      <div className="text-xs text-slate-600 mb-1">待翻译文本</div>
                      <div className="border border-slate-200 rounded-md p-2 bg-white text-xs text-slate-800 whitespace-pre-wrap break-words min-h-[48px]">
                        {(() => {
                          const segments = ids.map(id => {
                            const p = paragraphs.find(pp => getParagraphId(pp) === id)
                            return (p?.content || '').trim()
                          }).filter(s => s && s.length > 0)
                          if (segments.length === 0) return <span className="text-slate-400">请在左侧选中段落文本</span>
                          return (
                            <div>
                              {segments.map((s, i) => (
                                <div key={i} style={{ ['WebkitLineClamp']: 2, ['WebkitBoxOrient']: 'vertical', overflow: 'hidden', display: '-webkit-box' }}>{s}</div>
                              ))}
                            </div>
                          )
                        })()}
                      </div>
                    </div>
                  )
                })()}
                <div className="mt-2 text-xs text-slate-700">
                  {(() => {
                    const ids = getOrderedSelectedIds()
                    const targetId = ids[0]
                    const storeText = (translations || []).find(t => t.paragraph_id === targetId)?.translated_text || ''
                    const tText = mergedTranslationsMap[targetId] || storeText
                    if (isTranslating) return <span>翻译中...</span>
                    if (tText && tText.length > 0) return <span>翻译完成（提供商: {translationProvider}{translationProvider === 'openrouter' ? `/${translationOpenRouterModel}` : ''}）</span>
                    return <span className="text-slate-500">尚未翻译</span>
                  })()}
                </div>
                {(() => {
                  const ids = getOrderedSelectedIds()
                  const targetId = ids[0]
                  const storeText = (translations || []).find(t => t.paragraph_id === targetId)?.translated_text || ''
                  const tText = mergedTranslationsMap[targetId] || storeText
                  if (tText && tText.length > 0) {
                    return (
                      <div className="mt-3 border border-blue-200 rounded-md p-3 bg-blue-50 text-xs text-blue-900 whitespace-pre-wrap break-words">
                        <div style={{ ['WebkitLineClamp']: 2, ['WebkitBoxOrient']: 'vertical', overflow: 'hidden', display: '-webkit-box' }}>{tText}</div>
                      </div>
                    )
                  }
                  return null
                })()}
              </div>
            )}
            {(showImagePanel || hoverImage) && (
              <div className="bg-white rounded-lg shadow-md p-6 border border-slate-200 relative">
                <div className="mb-2 px-4 flex items-center justify-evenly">
                  <button onClick={handleImageGeneration} className={`w-9 h-9 inline-flex items-center justify-center rounded-md ${isGeneratingImage ? 'bg-blue-100 text-blue-600 animate-pulse' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`} title="执行绘图">
                    <Brush className="h-5 w-5" />
                  </button>
                  <button onClick={() => setShowImageConfig(!showImageConfig)} className="w-9 h-9 inline-flex items-center justify-center rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200" title="设置">
                    <Settings className="h-5 w-5" />
                  </button>
                </div>
                <div className="border border-slate-200 rounded-md p-3 mb-3">
                  <label className="block text-slate-700 text-xs mb-1">提示词</label>
                  <textarea
                    value={imagePromptText}
                    onChange={(e) => { setImagePromptText(e.target.value) }}
                    className={`w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 ${readerTheme === 'yellow' ? 'focus:ring-amber-500 focus:border-amber-500' : readerTheme === 'green' ? 'focus:ring-green-500 focus:border-green-500' : readerTheme === 'blackWhite' ? 'focus:ring-white focus:border-white' : 'focus:ring-slate-300 focus:border-slate-300'}`}
                    rows={5}
                    placeholder="已填充选中文本，可直接编辑提示词"
                  />
                </div>
                {showImageConfig && (
                  <div className="border border-slate-200 rounded-md p-3 mb-3">
                    <label className="block text-slate-700 text-xs mb-1">提示词模板</label>
                    <textarea
                      value={imagePromptTemplate}
                      onChange={(e) => {
                        setImagePromptTemplate(e.target.value)
                        try { localStorage.setItem('image_prompt_template', e.target.value) } catch { void 0 }
                      }}
                      className={`w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 ${readerTheme === 'yellow' ? 'focus:ring-amber-500 focus:border-amber-500' : readerTheme === 'green' ? 'focus:ring-green-500 focus:border-green-500' : readerTheme === 'blackWhite' ? 'focus:ring-white focus:border-white' : 'focus:ring-slate-300 focus:border-slate-300'}`}
                      rows={4}
                      placeholder="使用 {paragraph} 占位符插入选中文本"
                    />
                    <div className="mt-3">
                      <label className="block text-slate-700 text-xs mb-1">模型</label>
                      <select
                        value={imageModel}
                        onChange={(e) => {
                          setImageModel(e.target.value)
                          try { localStorage.setItem('openrouter_image_model', e.target.value) } catch { void 0 }
                        }}
                        className={`w-full px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 ${readerTheme === 'yellow' ? 'focus:ring-amber-500 focus:border-amber-500' : readerTheme === 'green' ? 'focus:ring-green-500 focus:border-green-500' : readerTheme === 'blackWhite' ? 'focus:ring-white focus:border-white' : 'focus:ring-slate-300 focus:border-slate-300'}`}
                      >
                        <option value="google/gemini-2.5-flash-image">google/gemini-2.5-flash-image</option>
                        <option value="google/gemini-3-pro-image-preview">google/gemini-3-pro-image-preview</option>
                      </select>
                    </div>
                  </div>
                )}
                <div className="mt-2 text-xs text-slate-700">
                  {isGeneratingImage && <span>生成中...</span>}
                  {!isGeneratingImage && imageStatus === 'success' && <span>绘图成功（模型: {imageModel}）</span>}
                  {!isGeneratingImage && imageStatus === 'error' && <span className="text-red-700">绘图失败</span>}
                </div>
                {imageStatus === 'success' && lastImageUrl && (
                  <div className="mt-3 border border-slate-200 rounded-lg overflow-hidden bg-slate-50">
                    <img src={lastImageUrl} alt="最新生成预览" className="w-full object-contain" />
                  </div>
                )}
                {imageDebug?.error && (
                  <div className="mt-2 text-xs text-red-700">错误：{String(imageDebug.error)}</div>
                )}
                {imageDebug?.prompt && (
                  <div className="mt-2">
                    <div className="text-xs text-slate-600 mb-1">使用的提示词</div>
                    <div className="border border-slate-200 rounded-md p-2 bg-white text-xs text-slate-800 whitespace-pre-wrap break-words">
                      {String(imageDebug.prompt)}
                    </div>
                  </div>
                )}
              </div>
            )}
            {(showDiscussion || hoverDiscussion) && (
              <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6 relative">
                <div className="space-y-3">
                  <textarea value={noteInput} onChange={(e) => setNoteInput(e.target.value)} className={`w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 ${readerTheme === 'yellow' ? 'focus:ring-amber-500 focus:border-amber-500' : readerTheme === 'green' ? 'focus:ring-green-500 focus:border-green-500' : readerTheme === 'blackWhite' ? 'focus:ring-white focus:border-white' : 'focus:ring-slate-300 focus:border-slate-300'}`} rows={3} placeholder="记录交流内容" />
                  <div className="flex space-x-2">
                    <button onClick={() => setRole('parent')} className={`flex-1 px-3 py-2 rounded-md text-sm ${currentRole === 'parent' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>家长</button>
                    <button onClick={() => setRole('child')} className={`flex-1 px-3 py-2 rounded-md text-sm ${currentRole === 'child' ? 'bg-green-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>孩子</button>
                  </div>
                  <div className="flex justify-end">
                    <button onClick={() => { if (currentBook && currentChapter) { const bid = getBookKey(); const runIds = (selectedIds.length > 0 ? selectedIds : [getCurrentParagraphId()]); if (noteInput.trim()) { runIds.forEach(pid => { if (pid) { addNote(bid, currentChapter.id, pid, noteInput.trim()) } }); setNoteInput(''); ensureMergedData(mergedStart, mergedEnd) } } }} className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 text-sm">添加对话</button>
                  </div>
                </div>
              </div>
            )}
              </div>
              {/* 移除整体容器右侧按钮，改为每段内贴边展示 */}
            </div>
          </div>
    </div>
  )
}
