import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import { useBooksStore } from '../store/books'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { translateAuto, translateStreamAuto, translateWithOpenRouter, translateWithOpenRouterStream, translateWithGemini, translateWithGeminiStream, generateImageWithOpenRouter, ttsWithDoubaoHttp, recognizeWithDoubaoFileStandard, recognizeWithDoubaoFile } from '../lib/ai'
import { useImagesStore } from '../store/images'
import { useAudiosStore } from '../store/audios'
import { Volume2, Languages, Image, MessageSquare, BookOpen, ArrowLeft, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Trash2, MoreVertical, Info, Play, Square, Settings, RefreshCw, Brush } from 'lucide-react'
import { Paragraph, Image as ImgType } from '../types/database'
import { useNotesStore } from '../store/notes'
import { useTranslationsStore } from '../store/translations'
import { Note } from '../types/notes'

export default function Reader() {
  const { bookId } = useParams<{ bookId: string }>()
  const navigate = useNavigate()
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
  const [supabaseDown, setSupabaseDown] = useState(false)
  const [cloudOnly, setCloudOnly] = useState<boolean>(() => {
    try { return localStorage.getItem('cloud_only') === '1' } catch { return false }
  })
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

  const loadReadingStateLocal = () => {
    try {
      const bid = getBookKey()
      const raw = localStorage.getItem('reading_state')
      const map = raw ? JSON.parse(raw) : {}
      return map[bid] || null
    } catch { return null }
  }

  const saveReadingStateLocal = () => {
    try {
      if (!currentBook || !currentChapter) return
      const bid = getBookKey()
      const raw = localStorage.getItem('reading_state')
      const map = raw ? JSON.parse(raw) : {}
      map[bid] = { chapterId: currentChapter.id, paragraphIndex: currentParagraphIndex, mergedStart, mergedEnd }
      localStorage.setItem('reading_state', JSON.stringify(map))
    } catch { }
  }

  const loadReadingStateRemote = async (): Promise<any> => {
    try {
      if (supabaseDown && !cloudOnly) return null
      if (!(isSupabaseConfigured && supabase) || !currentBook || !user) return null
      const { data } = await supabase
        .from('reading_progress')
        .select('*')
        .eq('user_id', user.id)
        .eq('book_id', currentBook.id)
        .single()
      if (!data) return null
      return { chapterId: data.chapter_id, paragraphIndex: data.paragraph_index, mergedStart: data.merged_start, mergedEnd: data.merged_end }
    } catch { setSupabaseDown(true); return null }
  }

  const saveReadingStateRemote = async (): Promise<void> => {
    try {
      if (supabaseDown && !cloudOnly) return
      if (!(isSupabaseConfigured && supabase) || !currentBook || !currentChapter || !user) return
      const { error } = await supabase
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
      if (error) { setSupabaseDown(true); return }
    } catch { setSupabaseDown(true) }
  }

  const getSavedState = async () => {
    let saved = await loadReadingStateRemote()
    if (!saved) saved = loadReadingStateLocal()
    return saved
  }

  const getOrderedSelectedIds = () => {
    if ((selectedIds || []).length === 0) return [getCurrentParagraphId()]
    const order = paragraphs.slice(0, visibleLimit).map(p => getParagraphId(p))
    const set = new Set(selectedIds)
    return order.filter(id => set.has(id))
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
    if (isSupabaseConfigured && supabase && (!supabaseDown || cloudOnly)) {
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
    } else {
      try {
        const rawImg = localStorage.getItem('demo_images')
        const rawTrans = localStorage.getItem('demo_translations')
        const rawNotes = localStorage.getItem('demo_notes')
        const rawAud = localStorage.getItem('demo_audios')
        const mapImg = rawImg ? JSON.parse(rawImg) : {}
        const mapTrans = rawTrans ? JSON.parse(rawTrans) : {}
        const mapNotes = rawNotes ? JSON.parse(rawNotes) : {}
        const mapAud = rawAud ? JSON.parse(rawAud) : {}
        const bookImg = mapImg[bid] || {}
        const bookTrans = mapTrans[bid] || {}
        const bookNotes = mapNotes[bid] || {}
        const bookAud = mapAud[bid] || {}
        for (const p of slice) {
          const pid = getParagraphId(p)
          newImages[pid] = bookImg[pid] || (newImages[pid] || [])
          const cachedTrans = bookTrans[pid]
          if (typeof cachedTrans === 'string' && cachedTrans.length > 0) {
            newTrans[pid] = cachedTrans
          } else {
            newTrans[pid] = typeof newTrans[pid] === 'string' ? newTrans[pid] : ''
          }
          newNotes[pid] = bookNotes[pid] || (newNotes[pid] || [])
          const list = bookAud[pid] || []
          newAud[pid] = list.length > 0 ? list.map((a: any) => ({ id: a.id, audio_url: a.audio_url })) : (newAud[pid] || [])
        }
      } catch { }
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
      setShowTranslation(false)
      if (isSupabaseConfigured && currentBook) {
        setIsParagraphsLoading(true)
        fetchParagraphs(ch.id).finally(() => setIsParagraphsLoading(false))
      } else {
        setIsParagraphsLoading(true)
        try {
          const raw = localStorage.getItem('demo_paragraphs')
          if (raw && currentBook) {
            const all = JSON.parse(raw)
            const bookMap = all[currentBook.id] || {}
            const list = bookMap[ch.id] || []
            setParagraphs(list)
          }
        } catch { }
        setIsParagraphsLoading(false)
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
      setShowTranslation(false)
      if (isSupabaseConfigured && currentBook) {
        const cached = preloadedParas[ch.id]
        if (cached && Array.isArray(cached) && cached.length > 0) {
          setIsParagraphsLoading(true)
          setParagraphs(cached)
          setIsParagraphsLoading(false)
        } else {
          setIsParagraphsLoading(true)
          // Try local cache first to show partial content quickly
          try {
            const raw = localStorage.getItem('demo_paragraphs')
            if (raw && currentBook) {
              const all = JSON.parse(raw)
              const bookMap = all[currentBook.id] || {}
              const list = bookMap[ch.id] || []
              if (list && list.length > 0) setParagraphs(list)
            }
          } catch { }
          fetchParagraphs(ch.id).finally(() => setIsParagraphsLoading(false))
        }
      } else {
        setIsParagraphsLoading(true)
        try {
          const raw = localStorage.getItem('demo_paragraphs')
          if (raw && currentBook) {
            const all = JSON.parse(raw)
            const bookMap = all[currentBook.id] || {}
            const list = bookMap[ch.id] || []
            setParagraphs(list)
          }
        } catch { }
        setIsParagraphsLoading(false)
      }
    }
  }

  const preloadNextChapter = async () => {
    if (!chapters || chapters.length === 0 || !currentChapter) return
    const idx = chapters.findIndex(c => c.id === currentChapter.id)
    if (idx >= 0 && idx < chapters.length - 1) {
      const next = chapters[idx + 1]
      if (preloadedParas[next.id] && Array.isArray(preloadedParas[next.id]) && preloadedParas[next.id].length > 0) return
      if (isSupabaseConfigured && supabase && (!supabaseDown || cloudOnly) && currentBook) {
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
      } else {
        try {
          const raw = localStorage.getItem('demo_paragraphs')
          if (raw && currentBook) {
            const all = JSON.parse(raw)
            const bookMap = all[currentBook.id] || {}
            const list = bookMap[next.id] || []
            if (list && list.length > 0) setPreloadedParas(prev => ({ ...prev, [next.id]: list }))
          }
        } catch { }
      }
    }
  }

  useEffect(() => {
    if (currentChapter && paragraphs.length > 0) {
      preloadNextChapter()
    }
  }, [currentChapter, paragraphs])

  useEffect(() => {
    preloadNextParagraphContent()
  }, [showVoicePanel, showTranslation, currentParagraphIndex, paragraphs])

  useEffect(() => {
    if (!user) {
      navigate('/login')
      return
    }

    if ((bookId && (!currentBook || currentBook.id !== bookId))) {
      // Try to resolve currentBook from store or localStorage
      const storeBook = (useBooksStore.getState().books || []).find(b => b.id === bookId)
      if (storeBook) {
        setCurrentBook(storeBook)
      } else {
        try {
          const raw = localStorage.getItem('demo_books')
          if (raw) {
            const list = JSON.parse(raw)
            const found = list.find((b: any) => b.id === bookId)
            if (found) setCurrentBook(found)
          }
        } catch { }
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
      } else {
        setIsParagraphsLoading(true)
        try {
          const rawCh = localStorage.getItem('demo_chapters')
          const rawPara = localStorage.getItem('demo_paragraphs')
          const mapCh = rawCh ? JSON.parse(rawCh) : {}
          const mapPara = rawPara ? JSON.parse(rawPara) : {}
          const chList = mapCh[currentBook.id] || []
          if (chList.length > 0) {
            const saved = loadReadingStateLocal()
            const target = saved?.chapterId ? (chList.find(c => c.id === saved.chapterId) || chList[0]) : chList[0]
            setCurrentChapter(target)
            const chapterParasMap = mapPara[currentBook.id] || {}
            const paraList = chapterParasMap[target.id] || []
            if (paraList.length > 0) {
              setParagraphs(paraList)
              const idx = Math.max(0, Math.min(saved?.paragraphIndex ?? 0, paraList.length - 1))
              setCurrentParagraphIndex(idx)
            }
          }
        } catch { }
        setIsParagraphsLoading(false)
      }
    }
  }, [user, navigate, currentBook, bookId, setCurrentBook, setCurrentChapter, setParagraphs])

  useEffect(() => {
    if (isSupabaseConfigured && !currentChapter && chapters.length > 0) {
      (async () => {
        let saved = await loadReadingStateRemote()
        if (!saved) { saved = loadReadingStateLocal() }
        const ch = saved?.chapterId ? (chapters.find(c => c.id === saved.chapterId) || chapters[0]) : chapters[0]
        setCurrentChapter(ch)
        const idx = Math.max(0, saved?.paragraphIndex ?? 0)
        setCurrentParagraphIndex(idx)
        setIsParagraphsLoading(true)
        fetchParagraphs(ch.id).finally(() => setIsParagraphsLoading(false))
      })()
    }
  }, [chapters, currentChapter])

  useEffect(() => {
    (async () => {
      if (currentBook && currentChapter && paragraphs.length > 0 && !appliedSavedIndex) {
        const saved = await getSavedState()
        if (saved?.chapterId && saved.chapterId !== currentChapter.id) {
          const target = (useBooksStore.getState().chapters || []).find(c => c.id === saved.chapterId)
          if (target) {
            setCurrentChapter(target)
            try {
              const rawPara = localStorage.getItem('demo_paragraphs')
              const mapPara = rawPara ? JSON.parse(rawPara) : {}
              const bookId = getBookKey()
              const chapterParasMap = mapPara[bookId] || {}
              const list = chapterParasMap[target.id] || []
              if (Array.isArray(list) && list.length > 0) {
                setParagraphs(list)
              }
            } catch { }
            if (isSupabaseConfigured && !supabaseDown) {
              setIsParagraphsLoading(true)
              fetchParagraphs(target.id).finally(() => setIsParagraphsLoading(false))
            }
            return
          }
        }
        if (typeof saved?.paragraphIndex === 'number') {
          const idx = Math.max(0, Math.min(saved.paragraphIndex, paragraphs.length - 1))
          setCurrentParagraphIndex(idx)
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
      const full = translationProvider === 'openrouter'
        ? await translateWithOpenRouter(text, 'zh', translationOpenRouterModel)
        : await translateWithGemini(text, 'zh')
      setMergedTranslationsMap(prev => ({ ...prev, [targetId]: full }))
      if (full && full.length > 0) addTranslation(bid, targetId, full, 'zh')
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
    const blob = new Blob([input])
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
                      const blob = new Blob([p])
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
              const blob = new Blob([p])
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
      const saved = loadReadingStateLocal()
      if (!appliedSavedMerge && saved && typeof saved.mergedStart === 'number' && typeof saved.mergedEnd === 'number') {
        const s = Math.max(0, Math.min(saved.mergedStart, paragraphs.length - 1))
        const e = Math.max(s, Math.min(saved.mergedEnd, paragraphs.length - 1))
        setMergedStart(s)
        setMergedEnd(e)
        setCurrentParagraphIndex(s)
        setAppliedSavedMerge(true)
        setMergedImagesMap({})
        setMergedTranslationsMap({})
        setMergedNotesMap({})
        setHiddenMergedIds([])
        setDeleteMenuPid(null)
        ensureMergedData(s, e)
      } else {
        ensureMergedData(mergedStart, mergedEnd)
      }
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
    saveReadingStateLocal()
    saveReadingStateRemote()
  }, [currentBook, currentChapter, currentParagraphIndex, mergedStart, mergedEnd])

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
        handlePreviousParagraph()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        handleNextParagraph()
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
  }, [handlePreviousParagraph, handleNextParagraph, mergedStart, mergedEnd, paragraphs])



  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-screen-2xl mx-auto px-6 lg:px-10">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center">
              <button
                onClick={() => navigate('/')}
                className="mr-4 p-2 text-gray-600 hover:text-gray-900"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div>
                <h1 className="text-xl font-bold text-gray-900">{currentBook.title}</h1>
                <p className="text-sm text-gray-600">段落 {mergedStart === mergedEnd ? (mergedStart + 1) : `${mergedStart + 1}-${mergedEnd + 1}`} / {paragraphs.length}</p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <select
                value={currentChapter?.id || ''}
                onChange={(e) => {
                  const ch = (useBooksStore.getState().chapters || []).find(c => c.id === e.target.value)
                  if (ch) {
                    setCurrentChapter(ch)
                    setCurrentParagraphIndex(0)
                    setShowTranslation(false)
                    if (isSupabaseConfigured && currentBook) {
                      setIsParagraphsLoading(true)
                      fetchParagraphs(ch.id).finally(() => setIsParagraphsLoading(false))
                    } else {
                      setIsParagraphsLoading(true)
                      try {
                        const raw = localStorage.getItem('demo_paragraphs')
                        if (raw && currentBook) {
                          const all = JSON.parse(raw)
                          const bookMap = all[currentBook.id] || {}
                          const list = bookMap[ch.id] || []
                          setParagraphs(list)
                        } else {
                          setParagraphs([])
                        }
                      } catch {
                        setParagraphs([])
                      }
                      setIsParagraphsLoading(false)
                    }
                  }
                }}
                className="px-3 py-2 rounded-md border border-slate-300 bg-white text-sm text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {(useBooksStore.getState().chapters || []).map(c => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
              {/* 章切换按钮已移除 */}
              <select
                value={String(currentParagraphIndex + 1)}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10)
                  if (!isNaN(v)) {
                    setCurrentParagraphIndex(Math.max(0, Math.min(v - 1, paragraphs.length - 1)))
                  }
                }}
                className="w-16 px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 bg-white text-center"
              >
                {Array.from({ length: Math.max(paragraphs.length, 1) }, (_, i) => (
                  <option key={i} value={String(i + 1)}>{i + 1}</option>
                ))}
              </select>
              {/* 段落切换按钮移至阅读区右侧 */}

              {/* 操作按钮已移至内容区域上方的独立容器 */}
            </div>
            {/* 阅读窗口外侧右侧：上为“下一段”，下为“上一段”，贴边显示 */}
            { (currentParagraphIndex < paragraphs.length - 1 || mergedEnd < paragraphs.length - 1) && (
              <button
                onClick={handleNextParagraph}
                aria-label="下一段"
                className="absolute -right-4 top-8 w-6 h-6 rounded-md border border-slate-200 bg-slate-50 text-slate-400 hover:bg-slate-100 flex items-center justify-center z-10"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
            { (currentParagraphIndex > 0 || mergedStart > 0) && (
              <button
                onClick={handlePreviousParagraph}
                aria-label="上一段"
                className="absolute -right-4 bottom-8 w-6 h-6 rounded-md border border-slate-200 bg-slate-50 text-slate-400 hover:bg-slate-100 flex items-center justify-center z-10"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-screen-2xl mx-auto px-6 lg:px-10 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Main Reading Area */}
          <div className="lg:col-span-3">
            <div className="bg-white rounded-lg shadow-md p-8 mb-6 w-full relative">
              <div className="w-full">
                {isParagraphsLoading && paragraphs.length === 0 ? (
                  <div className="text-center text-gray-600 py-12">
                    <div>读取中... {Math.round(Math.max(0, Math.min(100, loadingProgress)))}%</div>
                    <div className="w-64 h-2 bg-slate-200 rounded mx-auto mt-3">
                      <div className="h-2 bg-blue-500 rounded" style={{ width: `${Math.max(5, Math.min(100, loadingProgress))}%` }} />
                    </div>
                  </div>
                ) : paragraphs.length === 0 ? (
                  <div className="text-center text-gray-600 py-12">
                    正在准备内容，请稍候...
                  </div>
                ) : (
                  <div className="space-y-2">
                    {mergedStart > 0 && (
                      <div className="w-full">
                        {mergedEnd > mergedStart ? (
                          <div className="grid grid-cols-3 gap-1">
                            <button
                              onClick={() => { const ns = mergedStart + 1; setMergedStart(ns); ensureMergedData(ns, mergedEnd) }}
                              className="col-span-1 h-6 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs rounded-md flex items-center justify-center"
                              aria-label="缩小上方"
                              title="缩小上方"
                            >
                              <ChevronDown className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => { const ns = mergedStart - 1; setMergedStart(ns); ensureMergedData(ns, mergedEnd) }}
                              className="col-span-2 h-6 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs rounded-md flex items-center justify-center"
                              aria-label="向上扩展"
                              title="向上扩展"
                            >
                              <ChevronUp className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { const ns = mergedStart - 1; setMergedStart(ns); ensureMergedData(ns, mergedEnd) }}
                            className="w-full h-6 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs rounded-md flex items-center justify-center"
                            aria-label="向上扩展"
                            title="向上扩展"
                          >
                            <ChevronUp className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    )}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-2">
                      <div className="lg:col-span-12 space-y-2">
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
                            const isSelectedBox = selectedIds.includes(pid)
                            return (
                              <div key={pid} className={`group w-full rounded-lg p-3 relative border ${isSelectedBox ? 'border-blue-500' : 'border-slate-200'}`}>
                                <div className="absolute top-2 right-2 transition opacity-0 group-hover:opacity-100">
                                  <input
                                    type="checkbox"
                                    checked={selectedIds.includes(pid)}
                                    onChange={(e) => { setSelectedIds(prev => e.target.checked ? [...prev, pid] : prev.filter(x => x !== pid)) }}
                                    className="w-4 h-4 accent-blue-600 cursor-pointer"
                                    aria-label="选择段落"
                                  />
                                </div>
                            <p className="text-lg leading-relaxed text-gray-800 w-full whitespace-pre-wrap break-words">{p.content}</p>
                            {tText && (
                              <div className="mt-2 bg-blue-50 border border-blue-200 rounded-md p-2 text-sm text-blue-900 whitespace-pre-wrap break-words">{tText}</div>
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
                            {/* 段落卡片内不放左右按钮 */}
                          </div>
                            )
                          })
                        })()}
                        <div ref={listBottomRef} />
                      </div>
                    </div>
                    {mergedEnd < paragraphs.length - 1 && (
                      <div className="w-full">
                        {mergedEnd > mergedStart ? (
                          <div className="grid grid-cols-3 gap-1">
                            <button
                              onClick={() => { const ne = Math.max(mergedStart, mergedEnd - 1); setMergedEnd(ne); ensureMergedData(mergedStart, ne) }}
                              className="col-span-1 h-6 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs rounded-md flex items-center justify-center"
                              aria-label="缩小下方"
                              title="缩小下方"
                            >
                              <ChevronUp className="h-4 w-4" />
                            </button>
                            <button
                              onClick={extendDown}
                              className="col-span-2 h-6 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs rounded-md flex items-center justify-center"
                              aria-label="向下扩展"
                              title="向下扩展"
                            >
                              <ChevronDown className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={extendDown}
                            className="w-full h-6 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs rounded-md flex items-center justify-center"
                            aria-label="向下扩展"
                            title="向下扩展"
                          >
                            <ChevronDown className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    )}
                    {(paragraphs.length > 0) && (isParagraphsLoading || loadingProgress < 100) && (
                      <div className="mt-3 text-xs text-slate-600 text-center">
                        正在加载更多内容... {Math.round(Math.max(0, Math.min(100, loadingProgress)))}%
                      </div>
                    )}
                  </div>
                )}
              </div>


            </div>
          </div>

          <div className="lg:col-span-1 space-y-6">
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 px-4 py-2 flex items-center justify-evenly w-full">
              <button
                onClick={async () => { const next = !showVoicePanel; setShowVoicePanel(next); if (next) { setShowImagePanel(false); setShowDiscussion(false); stopPlaying(); await handleTextToSpeech() } }}
                className={`w-9 h-9 inline-flex items-center justify-center rounded-md ${isPlaying ? 'bg-blue-100 text-blue-600 animate-pulse' : (showVoicePanel ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}`}
                title="语音"
              >
                <Volume2 className="h-5 w-5" />
              </button>
              <button
                onClick={() => { const next = !showTranslation; setShowTranslation(next); if (next) { setShowImagePanel(false); setShowDiscussion(false); if (!isTranslating) { const ids = getOrderedSelectedIds(); const targetId = ids[0]; const storeText = (translations || []).find(t => t.paragraph_id === targetId)?.translated_text || ''; const tText = mergedTranslationsMap[targetId] || storeText; if (!tText || tText.length === 0 || needsRetranslate) { handleTranslation(); setNeedsRetranslate(false) } } } }}
                className={`w-9 h-9 inline-flex items-center justify-center rounded-md ${showTranslation ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                title="翻译"
              >
                <Languages className="h-5 w-5" />
              </button>
              <button
                onClick={() => { const next = !showImagePanel; setShowImagePanel(next); if (next) { setShowTranslation(false); setShowDiscussion(false); setShowVoicePanel(false) } }}
                className={`w-9 h-9 inline-flex items-center justify-center rounded-md ${isGeneratingImage ? 'bg-blue-100 text-blue-600 animate-pulse' : (showImagePanel ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}`}
                title="图片"
              >
                <Image className="h-5 w-5" />
              </button>
              <button
                onClick={() => { const next = !showDiscussion; setShowDiscussion(next); if (next) { setShowTranslation(false); setShowImagePanel(false); setShowVoicePanel(false) } }}
                className={`w-9 h-9 inline-flex items-center justify-center rounded-md ${showDiscussion
                    ? 'bg-blue-100 text-blue-600'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                title="讨论"
              >
                <MessageSquare className="h-5 w-5" />
              </button>
            </div>
            {showVoicePanel && (
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
                          {preview && preview.length > 0 ? preview : <span className="text-slate-400">请在左侧选中段落文本</span>}
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
                            onChange={(e) => { const v = e.target.value; if (v === '__custom__') { setShowVoiceCustom(true) } else { setShowVoiceCustom(false); setTtsVoiceType(v); try { localStorage.setItem('volc_tts_voice_type', v) } catch { } } }}
                            className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm bg-white"
                          >
                            {VOICES.map(opt => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                            <option value="__custom__">自定义...</option>
                          </select>
                          {showVoiceCustom && (
                            <input value={ttsVoiceType} onChange={(e) => { setTtsVoiceType(e.target.value); try { localStorage.setItem('volc_tts_voice_type', e.target.value) } catch { } }} className="mt-2 w-full px-3 py-2 border border-slate-300 rounded-md text-sm" placeholder="自定义音色ID" />
                          )}
                        </div>
                        <div>
                          <label className="block text-slate-700 text-xs mb-1">语言</label>
                          <input value={ttsLanguage} onChange={(e) => { setTtsLanguage(e.target.value); try { localStorage.setItem('volc_tts_language', e.target.value) } catch { } }} className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm" placeholder="cn 或 en（留空自动）" />
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-3 mt-3">
                        <div>
                          <label className="block text-slate-700 text-xs mb-1">语速</label>
                          <input type="number" step="0.1" min="0.2" max="3" value={ttsSpeed} onChange={(e) => { const v = parseFloat(e.target.value); setTtsSpeed(v); try { localStorage.setItem('volc_tts_speed_ratio', String(v)) } catch { } }} className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm" />
                        </div>
                        <div>
                          <label className="block text-slate-700 text-xs mb-1">音量</label>
                          <input type="number" step="0.1" min="0.1" max="3" value={ttsVolume} onChange={(e) => { const v = parseFloat(e.target.value); setTtsVolume(v); try { localStorage.setItem('volc_tts_volume_ratio', String(v)) } catch { } }} className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm" />
                        </div>
                        <div>
                          <label className="block text-slate-700 text-xs mb-1">音高</label>
                          <input type="number" step="0.1" min="0.1" max="3" value={ttsPitch} onChange={(e) => { const v = parseFloat(e.target.value); setTtsPitch(v); try { localStorage.setItem('volc_tts_pitch_ratio', String(v)) } catch { } }} className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm" />
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
            {showImagePanel && (
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
                    className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
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
                        try { localStorage.setItem('image_prompt_template', e.target.value) } catch { }
                      }}
                      className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      rows={4}
                      placeholder="使用 {paragraph} 占位符插入选中文本"
                    />
                    <div className="mt-3">
                      <label className="block text-slate-700 text-xs mb-1">模型</label>
                      <select
                        value={imageModel}
                        onChange={(e) => {
                          setImageModel(e.target.value)
                          try { localStorage.setItem('openrouter_image_model', e.target.value) } catch { }
                        }}
                        className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm bg-white"
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
            {showTranslation && (
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
                          onChange={(e) => { const v = e.target.value; setTranslationProvider(v); try { localStorage.setItem('translation_provider', v) } catch { }; setNeedsRetranslate(true) }}
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
                            onChange={(e) => { const v = e.target.value; setTranslationOpenRouterModel(v); try { localStorage.setItem('translation_openrouter_model', v) } catch { }; setNeedsRetranslate(true) }}
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
                  const preview = getCombinedText(ids)
                  return (
                    <div className="mb-2">
                      <div className="text-xs text-slate-600 mb-1">待翻译文本</div>
                      <div className="border border-slate-200 rounded-md p-2 bg-white text-xs text-slate-800 whitespace-pre-wrap break-words min-h-[48px]">
                        {preview && preview.length > 0 ? preview : <span className="text-slate-400">请在左侧选中段落文本</span>}
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
                      <div className="mt-3 border border-blue-200 rounded-md p-3 bg-blue-50 text-sm text-blue-900 whitespace-pre-wrap break-words">
                        {tText}
                      </div>
                    )
                  }
                  return null
                })()}
              </div>
            )}
            {showDiscussion && (
              <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6 relative">
                <div className="space-y-3">
                  <div className="flex items-center space-x-2">
                    <button onClick={startStreamingAsr} disabled={isRecording} className={`px-3 py-2 rounded-md text-sm ${isRecording ? 'bg-slate-200 text-slate-500' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}>流式识别</button>
                    <button onClick={stopStreamingAsr} disabled={!isRecording} className={`px-3 py-2 rounded-md text-sm ${!isRecording ? 'bg-slate-200 text-slate-500' : 'bg-indigo-100 text-indigo-800 hover:bg-indigo-200'}`}>结束流式</button>
                    <button onClick={() => setShowAsrDebug(!showAsrDebug)} className="px-2 h-9 inline-flex items-center justify-center rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 text-xs">调试</button>
                  </div>
                  <div className="text-xs text-slate-700 mt-2">
                    {isRecording ? '流式识别中...' : '未连接'}
                    {asrStatus === 'error' && <span className="text-red-700">（发生错误）</span>}
                  </div>
                  <div className="border border-slate-300 rounded-md bg-white h-16 overflow-hidden">
                    <canvas ref={recCanvasRef} className="w-full h-16" />
                  </div>
                  <div className="border border-slate-200 rounded-md p-2 bg-white text-sm text-slate-800 whitespace-pre-wrap break-words min-h-[48px]">
                    {recordTranscript && recordTranscript.length > 0 ? recordTranscript : <span className="text-slate-400">录音识别内容将显示在此</span>}
                  </div>
                  {showAsrDebug && (
                    <div className="border border-slate-200 rounded-md p-2 bg-white text-xs text-slate-700">
                      <div>状态：{asrStatus}</div>
                      <div>WS地址：{String(asrDebug?.ws_url || '')}</div>
                      <div>WS就绪状态：{String(asrDebug?.ws_ready_state ?? '')}</div>
                      <div>连接ID：{String(asrDebug?.connect_id || '')}</div>
                      <div>请求ID：{String(asrDebug?.req_id || '')}</div>
                      <div>AppID：{String(asrDebug?.app_id || '')}</div>
                      
                      <div>集群：{String(asrDebug?.cluster || '')}</div>
                      <div>客户端请求长度：{String(asrDebug?.client_request_len ?? '')}</div>
                      <div>已发送音频包：{String(asrDebug?.audio_packets_sent ?? '')}</div>
                      <div>最后包大小：{String(asrDebug?.last_packet_size ?? '')}</div>
                      <div>最后消息类型：{String(asrDebug?.last_msg_type ?? '')}</div>
                      <div>最后消息载荷长度：{String(asrDebug?.last_payload_len ?? '')}</div>
                      <div>停止点击时间：{String(asrDebug?.stop_click_at ?? '')}</div>
                      <div>已发送最后包：{String(asrDebug?.final_packet_sent ? '是' : '否')}</div>
                      <div>音频DataURL长度：{String(asrDebug?.dataUrl_len || '')}</div>
                      <div>识别返回：{asrDebug?.response ? JSON.stringify(asrDebug.response) : '无'}</div>
                      {asrDebug?.ws_close && <div>WS关闭：{JSON.stringify(asrDebug.ws_close)}</div>}
                      {asrDebug?.ws_error_frame && <div className="text-red-700">服务端错误帧：{JSON.stringify(asrDebug.ws_error_frame)}</div>}
                      {asrDebug?.ws_error && <div className="text-red-700">WS错误：{String(asrDebug.ws_error)}</div>}
                      {asrDebug?.error && <div className="text-red-700">错误：{String(asrDebug.error)}</div>}
                    </div>
                  )}
                  <textarea value={noteInput} onChange={(e) => setNoteInput(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500" rows={3} placeholder="记录交流内容" />
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
