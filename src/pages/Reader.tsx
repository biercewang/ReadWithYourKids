import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import { useBooksStore } from '../store/books'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { translateAuto, translateStreamAuto, translateWithOpenRouter, translateWithOpenRouterStream, translateWithGemini, translateWithGeminiStream, generateImageWithOpenRouter, ttsWithDoubaoHttp } from '../lib/ai'
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
  const [imageModel, setImageModel] = useState<string>(() => {
    try {
      const env = (import.meta as any)?.env?.VITE_OPENROUTER_IMAGE_MODEL || ''
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('openrouter_image_model') || '' : ''
      return raw || env || 'google/gemini-2.5-flash-image'
    } catch {
      return 'google/gemini-2.5-flash-image'
    }
  })
  const { notes, currentRole, loadNotes, loadNotesSmart, addNote, deleteNote, setRole } = useNotesStore()
  const { translations, loadTranslation, addTranslation } = useTranslationsStore()
  const [noteInput, setNoteInput] = useState('')

  const [mergedStart, setMergedStart] = useState<number>(0)
  const [mergedEnd, setMergedEnd] = useState<number>(0)
  const [mergedImagesMap, setMergedImagesMap] = useState<Record<string, ImgType[]>>({})
  const [mergedTranslationsMap, setMergedTranslationsMap] = useState<Record<string, string>>({})
  const [mergedNotesMap, setMergedNotesMap] = useState<Record<string, Note[]>>({})
  const [mergedAudiosMap, setMergedAudiosMap] = useState<Record<string, { id: string, audio_url: string }[]>>({})
  const [hiddenMergedIds, setHiddenMergedIds] = useState<string[]>([])
  const [deleteMenuPid, setDeleteMenuPid] = useState<string | null>(null)
  const [isTtsPending, setIsTtsPending] = useState(false)
  const [ttsStatus, setTtsStatus] = useState<'idle'|'success'|'fallback'|'error'>('idle')
  const [ttsSource, setTtsSource] = useState<'doubao'|'browser'|''>('')
  const [ttsDebug, setTtsDebug] = useState<any>(null)
  const [showTtsDebug, setShowTtsDebug] = useState(false)
  const [showTtsConfig, setShowTtsConfig] = useState(false)
  const [ttsVoiceType, setTtsVoiceType] = useState<string>(()=>{
    try { return localStorage.getItem('volc_tts_voice_type') || 'BV700_streaming' } catch { return 'BV700_streaming' }
  })
  const [ttsLanguage, setTtsLanguage] = useState<string>(()=>{
    try { return localStorage.getItem('volc_tts_language') || '' } catch { return '' }
  })
  const [ttsSpeed, setTtsSpeed] = useState<number>(()=>{
    try { const v = parseFloat(localStorage.getItem('volc_tts_speed_ratio') || '1'); return isNaN(v)?1:v } catch { return 1 }
  })
  const [ttsVolume, setTtsVolume] = useState<number>(()=>{
    try { const v = parseFloat(localStorage.getItem('volc_tts_volume_ratio') || '1'); return isNaN(v)?1:v } catch { return 1 }
  })
  const [ttsPitch, setTtsPitch] = useState<number>(()=>{
    try { const v = parseFloat(localStorage.getItem('volc_tts_pitch_ratio') || '1'); return isNaN(v)?1:v } catch { return 1 }
  })
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [currentAudio, setCurrentAudio] = useState<HTMLAudioElement | null>(null)
  const [lastTtsModel, setLastTtsModel] = useState<string>('')
  const [showVoiceCustom, setShowVoiceCustom] = useState(false)
  const [showTranslationConfig, setShowTranslationConfig] = useState(false)
  const [showImageConfig, setShowImageConfig] = useState(false)
  const VOICE_OPTIONS = [
    'BV700_streaming','BV001_streaming','BV002_streaming','BV100_streaming','BV200_streaming',
    'zh_male_lengkugege_emo_v2_mars_bigtts',
    'zh_female_tianxinxiaomei_emo_v2_mars_bigtts',
    'zh_female_gaolengyujie_emo_v2_mars_bigtts',
    'zh_male_aojiaobazong_emo_v2_mars_bigtts',
    'zh_male_guangzhoudege_emo_mars_bigtts',
    'zh_male_jingqiangkanye_emo_mars_bigtts',
    'zh_female_linjuayi_emo_v2_mars_bigtts',
    'zh_male_yourougongzi_emo_v2_mars_bigtts',
    'zh_male_ruyayichen_emo_v2_mars_bigtts',
    'zh_male_junlangnanyou_emo_v2_mars_bigtts',
    'zh_male_beijingxiaoye_emo_v2_mars_bigtts',
    'zh_female_roumeinvyou_emo_v2_mars_bigtts',
    'zh_male_yangguangqingnian_emo_v2_mars_bigtts',
    'zh_female_meilinvyou_emo_v2_mars_bigtts',
    'zh_female_shuangkuaisisi_emo_v2_mars_bigtts',
    'en_female_candice_emo_v2_mars_bigtts',
    'en_female_skye_emo_v2_mars_bigtts',
    'en_male_glen_emo_v2_mars_bigtts'
  ]

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

  const getOrderedSelectedIds = () => {
    if ((selectedIds || []).length === 0) return [getCurrentParagraphId()]
    const order = paragraphs.map(p => getParagraphId(p))
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
    const bid = getBookKey()
    const slice = paragraphs.slice(startIdx, endIdx + 1)
    const newImages: Record<string, ImgType[]> = { ...mergedImagesMap }
    const newTrans: Record<string, string> = { ...mergedTranslationsMap }
    const newNotes: Record<string, Note[]> = { ...mergedNotesMap }
    const newAud: Record<string, { id: string, audio_url: string }[]> = { ...mergedAudiosMap }
    if (isSupabaseConfigured && supabase) {
      for (const p of slice) {
        const pid = getParagraphId(p)
        try {
          const { data: imgData } = await supabase
            .from('images')
            .select('*')
            .eq('paragraph_id', pid)
            .order('created_at', { ascending: false })
          newImages[pid] = (imgData || []).map(row => ({ id: row.id, paragraph_id: row.paragraph_id, image_url: row.image_url, prompt: row.prompt, created_at: row.created_at }))
        } catch { newImages[pid] = newImages[pid] || [] }
        try {
          const { data: tData } = await supabase
            .from('translations')
            .select('*')
            .eq('paragraph_id', pid)
            .order('created_at', { ascending: false })
          const t = (tData || [])[0]
          newTrans[pid] = t?.translated_text || ''
        } catch { newTrans[pid] = newTrans[pid] || '' }
        try {
          const { data: nData } = await supabase
            .from('discussions')
            .select('*')
            .eq('paragraph_id', pid)
            .order('created_at', { ascending: false })
          newNotes[pid] = (nData || []).map(d => ({ id: d.id, book_id: bid, chapter_id: currentChapter?.id || '', paragraph_id: d.paragraph_id, user_type: d.user_type, content: d.content, created_at: d.created_at }))
        } catch { newNotes[pid] = newNotes[pid] || [] }
        try {
          const { data: aData } = await supabase
            .from('audios')
            .select('*')
            .eq('paragraph_id', pid)
            .order('created_at', { ascending: false })
          newAud[pid] = (aData || []).map(a => ({ id: a.id, audio_url: a.audio_url }))
        } catch { newAud[pid] = newAud[pid] || [] }
      }
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
          newImages[pid] = bookImg[pid] || []
          newTrans[pid] = bookTrans[pid] || ''
          newNotes[pid] = bookNotes[pid] || []
          const list = bookAud[pid] || []
          newAud[pid] = list.map((a: any) => ({ id: a.id, audio_url: a.audio_url }))
        }
      } catch {}
    }
    setMergedImagesMap(newImages)
    setMergedTranslationsMap(newTrans)
    setMergedNotesMap(newNotes)
    setMergedAudiosMap(newAud)
  }

  const handlePrevChapter = () => {
    if (!chapters || chapters.length === 0 || !currentChapter) return
    const idx = chapters.findIndex(c => c.id === currentChapter.id)
    if (idx > 0) {
      const ch = chapters[idx - 1]
      setCurrentChapter(ch)
      setCurrentParagraphIndex(0)
      setShowTranslation(false)
      if (isSupabaseConfigured && currentBook) {
        fetchParagraphs(ch.id)
      } else {
        try {
          const raw = localStorage.getItem('demo_paragraphs')
          if (raw && currentBook) {
            const all = JSON.parse(raw)
            const bookMap = all[currentBook.id] || {}
            const list = bookMap[ch.id] || []
            setParagraphs(list)
          }
        } catch {}
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
        fetchParagraphs(ch.id)
      } else {
        try {
          const raw = localStorage.getItem('demo_paragraphs')
          if (raw && currentBook) {
            const all = JSON.parse(raw)
            const bookMap = all[currentBook.id] || {}
            const list = bookMap[ch.id] || []
            setParagraphs(list)
          }
        } catch {}
      }
    }
  }

  useEffect(() => {
    if (!user) {
      navigate('/login')
      return
    }

    if (!currentBook && bookId) {
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
        } catch {}
      }
    }

    if (currentBook && !currentChapter) {
      if (isSupabaseConfigured) {
        fetchChapters(currentBook.id)
      } else {
        try {
          const rawCh = localStorage.getItem('demo_chapters')
          const rawPara = localStorage.getItem('demo_paragraphs')
          const mapCh = rawCh ? JSON.parse(rawCh) : {}
          const mapPara = rawPara ? JSON.parse(rawPara) : {}
          const chList = mapCh[currentBook.id] || []
          if (chList.length > 0) {
            setCurrentChapter(chList[0])
            const chapterParasMap = mapPara[currentBook.id] || {}
            const paraList = chapterParasMap[chList[0].id] || []
            if (paraList.length > 0) setParagraphs(paraList)
          }
        } catch {}
      }
      setCurrentParagraphIndex(0)
    }
  }, [user, navigate, currentBook, bookId, setCurrentBook, setCurrentChapter, setParagraphs])

  useEffect(() => {
    if (isSupabaseConfigured && !currentChapter && chapters.length > 0) {
      const ch = chapters[0]
      setCurrentChapter(ch)
      setCurrentParagraphIndex(0)
      fetchParagraphs(ch.id)
    }
  }, [chapters, currentChapter])

  const handleTextToSpeech = async () => {
    if (paragraphs.length === 0) return
    const ids = getOrderedSelectedIds()
    const targetId = ids[ids.length - 1]
    const text = getCombinedText(ids)
    try {
      setIsTtsPending(true)
      setShowTtsDebug(false)
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
      audio.onended = () => setIsPlaying(false)
      setTtsStatus('success')
      setTtsSource('doubao')
      setTtsDebug(raw)
      setIsTtsPending(false)
      if (currentBook && currentChapter) {
        const bid = getBookKey()
        addAudio(bid, currentChapter.id, targetId, audioUrl, 'doubao', ttsVoiceType)
        ensureMergedData(mergedStart, mergedEnd)
      }
      await audio.play()
    } catch (e) {
      setIsTtsPending(false)
      setTtsDebug({ error: e instanceof Error ? e.message : String(e) })
      if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(paragraphs[currentParagraphIndex]?.content || '')
        utterance.lang = 'en-US'
        utterance.rate = 0.8
        utterance.onstart = () => setIsPlaying(true)
        utterance.onend = () => setIsPlaying(false)
        speechSynthesis.speak(utterance)
        setTtsStatus('fallback')
        setTtsSource('browser')
      } else {
        alert(e instanceof Error ? e.message : '朗读失败')
        setTtsStatus('error')
        setTtsSource('')
      }
    }
  }

  const playLatestAudio = async () => {
    try {
      if (currentAudio) {
        try { currentAudio.pause(); currentAudio.currentTime = 0 } catch {}
        setCurrentAudio(null)
        setIsPlaying(false)
        return
      }
      const url = (audios || [])[0]?.audio_url || ''
      if (url) {
        const audio = new Audio(url)
        audio.onended = () => { try { setCurrentAudio(null); setIsPlaying(false) } catch {} }
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
      const { audioUrl, raw } = await ttsWithDoubaoHttp(text,{ voice_type: ttsVoiceType, language: ttsLanguage||undefined, speed_ratio: ttsSpeed, volume_ratio: ttsVolume, pitch_ratio: ttsPitch, encoding: 'mp3' })
      setTtsStatus('success')
      setTtsSource('doubao')
      setTtsDebug(raw)
      setLastTtsModel(ttsVoiceType)
      const audio = new Audio(audioUrl)
      audio.onended = () => { try { setCurrentAudio(null); setIsPlaying(false) } catch {} }
      audio.play()
      setCurrentAudio(audio)
      setIsPlaying(true)
      if (currentBook && currentChapter) {
        const bid = getBookKey()
        addAudio(bid, currentChapter.id, targetId, audioUrl, 'doubao', ttsVoiceType)
        ensureMergedData(mergedStart, mergedEnd)
      }
    } catch (e) {
      setTtsStatus('error')
      setTtsSource('')
      setTtsDebug({ error: e instanceof Error ? e.message : String(e) })
    } finally {
      setIsTtsPending(false)
    }
  }

  const handleVoiceMenuClick = async () => {
    const next = !showVoicePanel
    setShowVoicePanel(next)
    if (next) {
      setShowTranslation(false)
      setShowImagePanel(false)
      setShowDiscussion(false)
      await handleTextToSpeech()
    }
  }

  const handleTranslation = async () => {
    if (paragraphs.length === 0) return
    try {
      const bid = getBookKey()
      const ids = getOrderedSelectedIds()
      const targetId = ids[ids.length - 1]
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
      const bid = getBookKey()
      const ids = getOrderedSelectedIds()
      const targetId = ids[ids.length - 1]
      const text = getCombinedText(ids)
      const prompt = imagePromptTemplate.includes('{paragraph}')
        ? imagePromptTemplate.replace('{paragraph}', text)
        : `${imagePromptTemplate}\n\n${text}`
      const img = await generateImageWithOpenRouter(prompt, '1024x1024')
      if (currentBook && currentChapter) {
        addImage(bid, currentChapter.id, targetId, img, prompt)
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : '生成图片失败')
    } finally {
      setIsGeneratingImage(false)
    }
  }

  const handlePreviousParagraph = () => {
    if (currentParagraphIndex > 0) {
      const prevStart = computePrevStart(currentParagraphIndex)
      setCurrentParagraphIndex(prevStart)
      setShowTranslation(false)
      setTranslationText('')
    }
  }

  const handleNextParagraph = () => {
    if (currentParagraphIndex < paragraphs.length - 1) {
      setCurrentParagraphIndex(currentParagraphIndex + 1)
      setShowTranslation(false)
      setTranslationText('')
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
      loadAudios(getBookKey(), pid)
    }
  }, [currentBook, currentParagraphIndex, paragraphs])

  useEffect(() => {
    if (paragraphs.length > 0) {
      setMergedStart(currentParagraphIndex)
      setMergedEnd(currentParagraphIndex)
      setMergedImagesMap({})
      setMergedTranslationsMap({})
      setMergedNotesMap({})
      setHiddenMergedIds([])
      setDeleteMenuPid(null)
      ensureMergedData(currentParagraphIndex, currentParagraphIndex)
    }
  }, [currentParagraphIndex, paragraphs])

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
      } catch {}
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

  

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-screen-2xl mx-auto px-0">
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
                      fetchParagraphs(ch.id)
                    } else {
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
                    }
                  }
                }}
                className="px-3 py-2 rounded-md border border-slate-300 bg-white text-sm text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {(useBooksStore.getState().chapters || []).map(c => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
              <button
                onClick={handlePrevChapter}
                className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
                disabled={!currentChapter || (chapters.findIndex(c => c.id === currentChapter.id) <= 0)}
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <button
                onClick={handleNextChapter}
                className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
                disabled={!currentChapter || (chapters.findIndex(c => c.id === currentChapter.id) >= chapters.length - 1)}
              >
                <ChevronDown className="h-4 w-4" />
              </button>
              <select
                value={String(currentParagraphIndex + 1)}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10)
                  if (!isNaN(v)) {
                    setCurrentParagraphIndex(Math.max(0, Math.min(v - 1, paragraphs.length - 1)))
                    setShowTranslation(false)
                  }
                }}
                className="w-16 px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 bg-white text-center"
              >
                {Array.from({ length: Math.max(paragraphs.length, 1) }, (_, i) => (
                  <option key={i} value={String(i + 1)}>{i + 1}</option>
                ))}
              </select>
              <button
                onClick={handlePreviousParagraph}
                disabled={currentParagraphIndex === 0}
                className="inline-flex items-center justify-center w-9 h-9 border border-gray-300 rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={handleNextParagraph}
                disabled={currentParagraphIndex >= paragraphs.length - 1}
                className="inline-flex items-center justify-center w-9 h-9 border border-gray-300 rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              
              {/* 操作按钮已移至内容区域上方的独立容器 */}
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-screen-2xl mx-auto px-6 lg:px-10 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Main Reading Area */}
          <div className="lg:col-span-3">
            <div className="bg-white rounded-lg shadow-md p-8 mb-6 w-full">
              <div className="w-full">
                {paragraphs.length === 0 ? (
                  <div className="text-center text-gray-600 py-12">
                    该图书尚未解析到段落，请返回首页重新上传以解析章节。
                  </div>
                ) : (
                  <div className="space-y-2">
                    {mergedStart > 0 && (
                      <div className="w-full">
                        {mergedEnd > mergedStart ? (
                          <div className="grid grid-cols-3 gap-1">
                            <button
                              onClick={() => { const ns = mergedStart - 1; setMergedStart(ns); ensureMergedData(ns, mergedEnd) }}
                              className="col-span-2 h-6 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs rounded-md flex items-center justify-center"
                              aria-label="向上扩展"
                              title="向上扩展"
                            >
                              <ChevronUp className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => { const ns = mergedStart + 1; setMergedStart(ns); ensureMergedData(ns, mergedEnd) }}
                              className="col-span-1 h-6 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs rounded-md flex items-center justify-center"
                              aria-label="缩小上方"
                              title="缩小上方"
                            >
                              <ChevronDown className="h-4 w-4" />
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
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                      <div className="lg:col-span-12 space-y-6">
                        {(() => {
                          const list = paragraphs
                            .slice(mergedStart, Math.min(mergedEnd + 1, paragraphs.length))
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
                              <div key={pid} className="group w-full border border-slate-200 rounded-lg p-4 relative">
                                <div className={`absolute top-2 right-2 transition ${selectedIds.includes(pid) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                                  <input
                                    type="checkbox"
                                    checked={selectedIds.includes(pid)}
                                    onChange={(e)=>{ setSelectedIds(prev => e.target.checked ? [...prev, pid] : prev.filter(x=>x!==pid)) }}
                                    className="w-4 h-4 accent-blue-600 cursor-pointer"
                                    aria-label="选择段落"
                                  />
                                </div>
                                <p className="text-lg leading-relaxed text-gray-800 w-full whitespace-pre-wrap break-words">{p.content}</p>
                                {tText && (
                                  <div className="mt-3 bg-blue-50 border border-blue-200 rounded-md p-3 text-sm text-blue-900 whitespace-pre-wrap break-words">{tText}</div>
                                )}
                                {imgUrl && (
                                  <div className="mt-3 border border-slate-200 rounded-lg overflow-hidden bg-slate-50">
                                    <img src={imgUrl} alt="插画" className="w-full object-contain" />
                                  </div>
                                )}
                                {nList.length > 0 && (
                                  <div className="mt-3 space-y-2">
                                    {nList.map(n => (
                                      <div key={n.id} className="border border-slate-200 rounded-md p-2">
                                        <div className="flex items-center justify-between mb-1">
                                          <span className={`text-xs font-medium ${n.user_type==='parent'?'text-blue-600':'text-green-600'}`}>{n.user_type==='parent'?'家长':'孩子'}</span>
                                          <span className="text-xs text-slate-500">{new Date(n.created_at).toLocaleString()}</span>
                                        </div>
                                        <p className="text-sm text-slate-800 whitespace-pre-wrap break-words">{n.content}</p>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {aList.length > 0 && (
                                  <div className="mt-3">
                                    <button onClick={()=>{ const url=aList[0]?.audio_url||''; if(url){ const audio=new Audio(url); audio.play() } }} className="px-3 py-2 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700">播放语音</button>
                                  </div>
                                )}
                              </div>
                            )
                          })
                        })()}
                      </div>
                    </div>
                    {mergedEnd < paragraphs.length - 1 && (
                      <div className="w-full">
                        {mergedEnd > mergedStart ? (
                          <div className="grid grid-cols-3 gap-1">
                            <button
                              onClick={() => { const ne = mergedEnd + 1; setMergedEnd(ne); ensureMergedData(mergedStart, ne) }}
                              className="col-span-2 h-6 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs rounded-md flex items-center justify-center"
                              aria-label="向下扩展"
                              title="向下扩展"
                            >
                              <ChevronDown className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => { const ne = Math.max(mergedStart, mergedEnd - 1); setMergedEnd(ne); ensureMergedData(mergedStart, ne) }}
                              className="col-span-1 h-6 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs rounded-md flex items-center justify-center"
                              aria-label="缩小下方"
                              title="缩小下方"
                            >
                              <ChevronUp className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { const ne = mergedEnd + 1; setMergedEnd(ne); ensureMergedData(mergedStart, ne) }}
                            className="w-full h-6 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs rounded-md flex items-center justify-center"
                            aria-label="向下扩展"
                            title="向下扩展"
                          >
                            <ChevronDown className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
              
              
            </div>
          </div>

          <div className="lg:col-span-1 space-y-6">
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 px-4 py-2 flex items-center justify-between w-full">
              <button
                onClick={() => { const next = !showVoicePanel; setShowVoicePanel(next); if (next) { setShowTranslation(false); setShowImagePanel(false); setShowDiscussion(false) } }}
                className={`w-9 h-9 inline-flex items-center justify-center rounded-md ${showVoicePanel ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                title="语音"
              >
                <Volume2 className="h-5 w-5" />
              </button>
              <button
                onClick={() => { const next = !showTranslation; setShowTranslation(next); if (next) { setShowImagePanel(false); setShowDiscussion(false); setShowVoicePanel(false) } }}
                disabled={isTranslating}
                className={`w-9 h-9 inline-flex items-center justify-center rounded-md ${isTranslating ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                title="翻译"
              >
                <Languages className="h-5 w-5" />
              </button>
              <button
                onClick={() => { const next = !showImagePanel; setShowImagePanel(next); if (next) { setShowTranslation(false); setShowDiscussion(false); setShowVoicePanel(false) } }}
                className={`w-9 h-9 inline-flex items-center justify-center rounded-md ${showImagePanel ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                title="图片"
              >
                <Image className="h-5 w-5" />
              </button>
              <button
                onClick={() => { const next = !showDiscussion; setShowDiscussion(next); if (next) { setShowTranslation(false); setShowImagePanel(false); setShowVoicePanel(false) } }}
                className={`w-9 h-9 inline-flex items-center justify-center rounded-md ${
                  showDiscussion 
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
                  <div className="mb-2">
                    <button onClick={playLatestAudio} className="w-9 h-9 inline-flex items-center justify-center rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200" title={currentAudio? '停止朗读':'生成并播放'}>
                      {currentAudio ? (<Square className="h-5 w-5" />) : (<Play className="h-5 w-5" />)}
                    </button>
                    <button onClick={()=>setShowTtsConfig(!showTtsConfig)} className="ml-2 w-9 h-9 inline-flex items-center justify-center rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200" title="参数">
                      <Settings className="h-5 w-5" />
                    </button>
                  </div>
                  {showTtsConfig && (
                    <div className="border border-slate-200 rounded-md p-3 mb-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-slate-700 text-xs mb-1">音色</label>
                          <select
                            value={VOICE_OPTIONS.includes(ttsVoiceType) ? ttsVoiceType : '__custom__'}
                            onChange={(e)=>{ const v=e.target.value; if(v==='__custom__'){ setShowVoiceCustom(true) } else { setShowVoiceCustom(false); setTtsVoiceType(v); try{ localStorage.setItem('volc_tts_voice_type', v) }catch{} } }}
                            className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm bg-white"
                          >
                            {VOICE_OPTIONS.map(opt => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                            <option value="__custom__">自定义...</option>
                          </select>
                          {showVoiceCustom && (
                            <input value={ttsVoiceType} onChange={(e)=>{ setTtsVoiceType(e.target.value); try{ localStorage.setItem('volc_tts_voice_type', e.target.value) }catch{} }} className="mt-2 w-full px-3 py-2 border border-slate-300 rounded-md text-sm" placeholder="自定义音色ID" />
                          )}
                        </div>
                        <div>
                          <label className="block text-slate-700 text-xs mb-1">语言</label>
                          <input value={ttsLanguage} onChange={(e)=>{ setTtsLanguage(e.target.value); try{ localStorage.setItem('volc_tts_language', e.target.value) }catch{} }} className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm" placeholder="cn 或 en（留空自动）" />
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-3 mt-3">
                        <div>
                          <label className="block text-slate-700 text-xs mb-1">语速</label>
                          <input type="number" step="0.1" min="0.2" max="3" value={ttsSpeed} onChange={(e)=>{ const v=parseFloat(e.target.value); setTtsSpeed(v); try{ localStorage.setItem('volc_tts_speed_ratio', String(v)) }catch{} }} className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm" />
                        </div>
                        <div>
                          <label className="block text-slate-700 text-xs mb-1">音量</label>
                          <input type="number" step="0.1" min="0.1" max="3" value={ttsVolume} onChange={(e)=>{ const v=parseFloat(e.target.value); setTtsVolume(v); try{ localStorage.setItem('volc_tts_volume_ratio', String(v)) }catch{} }} className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm" />
                        </div>
                        <div>
                          <label className="block text-slate-700 text-xs mb-1">音高</label>
                          <input type="number" step="0.1" min="0.1" max="3" value={ttsPitch} onChange={(e)=>{ const v=parseFloat(e.target.value); setTtsPitch(v); try{ localStorage.setItem('volc_tts_pitch_ratio', String(v)) }catch{} }} className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm" />
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="space-y-2">
                    {(audios||[]).map(a=> (
                      <div key={a.id} className="flex items-center justify-between border border-slate-200 rounded-md p-2">
                        <button onClick={()=>{ const audio = new Audio(a.audio_url); audio.play() }} className="px-2 py-1 rounded-md bg-slate-100 text-slate-700 text-xs hover:bg-slate-200">播放</button>
                        <button onClick={()=>{ if(currentBook){ deleteAudio(getBookKey(), getCurrentParagraphId(), a.id); ensureMergedData(mergedStart, mergedEnd) } }} className="px-2 py-1 rounded-md bg-red-600 text-white text-xs hover:bg-red-700">删除</button>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 text-xs text-slate-700">
                    {isTtsPending && <span>合成中...</span>}
                    {!isTtsPending && ttsStatus==='success' && ttsSource==='doubao' && <span>豆包合成成功（音色: {lastTtsModel||ttsVoiceType}）</span>}
                    {!isTtsPending && ttsStatus==='fallback' && ttsSource==='browser' && <span>使用本机朗读</span>}
                    {!isTtsPending && ttsStatus==='error' && <span className="text-red-700">豆包合成失败</span>}
                  </div>
                </div>
              </div>
            )}
            {showImagePanel && (
              <div className="bg-white rounded-lg shadow-md p-6 border border-slate-200 relative">
                <div className="mb-2">
                  <button onClick={handleImageGeneration} className="w-9 h-9 inline-flex items-center justify-center rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200" title="执行绘图">
                    <Brush className="h-5 w-5" />
                  </button>
                  <button onClick={()=>setShowImageConfig(!showImageConfig)} className="ml-2 w-9 h-9 inline-flex items-center justify-center rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200" title="设置">
                    <Settings className="h-5 w-5" />
                  </button>
                </div>
                {showImageConfig && (
                  <div className="border border-slate-200 rounded-md p-3 mb-3">
                    <textarea
                      value={imagePromptTemplate}
                      onChange={(e) => {
                        setImagePromptTemplate(e.target.value)
                        try { localStorage.setItem('image_prompt_template', e.target.value) } catch {}
                      }}
                      className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      rows={5}
                      placeholder="填写图片生成的提示词模板，使用 {paragraph} 占位符"
                    />
                    <div className="mt-3">
                      <select
                        value={imageModel}
                        onChange={(e) => {
                          setImageModel(e.target.value)
                          try { localStorage.setItem('openrouter_image_model', e.target.value) } catch {}
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
                </div>
              </div>
            )}
            {showTranslation && (
              <div className="bg-white rounded-lg shadow-md p-6 border border-blue-200 relative">
                <div className="mb-2">
                  <button onClick={handleTranslation} className="w-9 h-9 inline-flex items-center justify-center rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200" title="执行翻译">
                    <RefreshCw className="h-5 w-5" />
                  </button>
                  <button onClick={()=>setShowTranslationConfig(!showTranslationConfig)} className="ml-2 w-9 h-9 inline-flex items-center justify-center rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200" title="设置">
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
                          onChange={(e)=>{ const v=e.target.value; setTranslationProvider(v); try{ localStorage.setItem('translation_provider', v) }catch{}; setNeedsRetranslate(true) }}
                          className="w-full px-3 py-2 border border-blue-300 rounded-md text-sm bg-white"
                        >
                          <option value="gemini">Google Gemini</option>
                          <option value="openrouter">OpenRouter</option>
                        </select>
                      </div>
                      {translationProvider==='openrouter' && (
                        <div>
                          <label className="block text-slate-700 text-xs mb-1">模型</label>
                          <select
                            value={translationOpenRouterModel}
                            onChange={(e)=>{ const v=e.target.value; setTranslationOpenRouterModel(v); try{ localStorage.setItem('translation_openrouter_model', v) }catch{}; setNeedsRetranslate(true) }}
                            className="w-full px-3 py-2 border border-blue-300 rounded-md text-sm bg-white"
                          >
                            <option value="x-ai/grok-4.1-fast:free">x-ai/grok-4.1-fast:free</option>
                          </select>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <div className="mt-2 text-xs text-slate-700">
                  {isTranslating && <span>翻译中...</span>}
                </div>
              </div>
            )}
            {showDiscussion && (
              <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6 relative">
                <div className="space-y-3">
                  <textarea value={noteInput} onChange={(e)=>setNoteInput(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500" rows={3} placeholder="记录交流内容" />
                  <div className="flex space-x-2">
                    <button onClick={() => setRole('parent')} className={`flex-1 px-3 py-2 rounded-md text-sm ${currentRole==='parent'?'bg-blue-600 text-white':'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>家长</button>
                    <button onClick={() => setRole('child')} className={`flex-1 px-3 py-2 rounded-md text-sm ${currentRole==='child'?'bg-green-600 text-white':'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>孩子</button>
                  </div>
                  <div className="flex justify-end">
                    <button onClick={()=>{ if(currentBook&&currentChapter){ const bid=getBookKey(); const runIds = (selectedIds.length>0?selectedIds:[getCurrentParagraphId()]); if(noteInput.trim()){ runIds.forEach(pid=>{ if(pid){ addNote(bid,currentChapter.id,pid,noteInput.trim()) } }); setNoteInput(''); ensureMergedData(mergedStart, mergedEnd) } } }} className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 text-sm">添加对话</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
