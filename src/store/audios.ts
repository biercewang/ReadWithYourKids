import { create } from 'zustand'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { useAuthStore } from './auth'

interface AudioItem {
  id: string
  paragraph_id: string
  audio_url: string
  provider?: string
  voice_type?: string
  created_at: string
}

interface AudiosState {
  audios: AudioItem[]
  loadAudios: (bookId: string, paragraphId: string) => void
  addAudio: (bookId: string, chapterId: string, paragraphId: string, dataUrl: string, provider?: string, voiceType?: string) => void
  deleteAudio: (bookId: string, paragraphId: string, audioId: string) => void
}

const KEY = 'demo_audios'

function dataUrlToBlob(dataUrl: string): Blob | null {
  try {
    const parts = dataUrl.split(',')
    const meta = parts[0] || ''
    const b64 = parts[1] || ''
    const mimeMatch = /data:(.*?);base64/.exec(meta)
    const mime = (mimeMatch && mimeMatch[1]) || 'audio/mpeg'
    const bin = atob(b64)
    const arr = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
    return new Blob([arr], { type: mime })
  } catch { return null }
}

export const useAudiosStore = create<AudiosState>((set, get) => ({
  audios: [],
  loadAudios: (bookId: string, paragraphId: string) => {
    const supa = isSupabaseConfigured && supabase
    if (supa) {
      ;(async () => {
        try {
          const { data, error } = await supabase
            .from('audios')
            .select('*')
            .eq('paragraph_id', paragraphId)
            .order('created_at', { ascending: false })
          if (error) throw error
          const list: AudioItem[] = (data || []).map(row => ({
            id: row.id,
            paragraph_id: row.paragraph_id,
            audio_url: row.audio_url,
            provider: row.provider,
            voice_type: row.voice_type,
            created_at: row.created_at,
          }))
          set({ audios: list })
        } catch { set({ audios: [] }) }
      })()
      return
    }
    try {
      const raw = localStorage.getItem(KEY)
      const map = raw ? JSON.parse(raw) : {}
      const bookMap = map[bookId] || {}
      const list: AudioItem[] = bookMap[paragraphId] || []
      set({ audios: list })
    } catch { set({ audios: [] }) }
  },
  addAudio: (bookId: string, chapterId: string, paragraphId: string, dataUrl: string, provider?: string, voiceType?: string) => {
    const supa = isSupabaseConfigured && supabase
    if (supa) {
      ;(async () => {
        try {
          const uid = useAuthStore.getState().user?.id || ''
          let publicUrl = ''
          try {
            const path = `${uid}/${bookId}/${chapterId}/${paragraphId}/${Date.now()}.mp3`
            const blob = dataUrlToBlob(dataUrl)
            if (blob) {
              const { data: uploadData } = await supabase.storage.from('generated').upload(path, blob, { upsert: false })
              if (uploadData?.path) {
                const { data: pub } = await supabase.storage.from('generated').getPublicUrl(uploadData.path)
                publicUrl = pub?.publicUrl || ''
              }
            }
          } catch {}
          const urlToSave = publicUrl || dataUrl
          const { data, error } = await supabase
            .from('audios')
            .insert([{ paragraph_id: paragraphId, audio_url: urlToSave, provider, voice_type: voiceType }])
            .select()
            .single()
          if (error) throw error
          const item: AudioItem = {
            id: data.id,
            paragraph_id: paragraphId,
            audio_url: data.audio_url,
            provider: data.provider,
            voice_type: data.voice_type,
            created_at: data.created_at,
          }
          set({ audios: [item, ...get().audios] })
        } catch {}
      })()
      return
    }
    const item: AudioItem = {
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      paragraph_id: paragraphId,
      audio_url: dataUrl,
      provider,
      voice_type: voiceType,
      created_at: new Date().toISOString(),
    }
    try {
      const raw = localStorage.getItem(KEY)
      const map = raw ? JSON.parse(raw) : {}
      const bookMap = map[bookId] || {}
      const list: AudioItem[] = bookMap[paragraphId] || []
      const updated = [item, ...list]
      bookMap[paragraphId] = updated
      map[bookId] = bookMap
      localStorage.setItem(KEY, JSON.stringify(map))
      set({ audios: updated })
    } catch { set(state => ({ audios: [item, ...(state.audios || [])] })) }
  },
  deleteAudio: (bookId: string, paragraphId: string, audioId: string) => {
    const supa = isSupabaseConfigured && supabase
    if (supa) {
      ;(async () => {
        try {
          const { error } = await supabase
            .from('audios')
            .delete()
            .eq('id', audioId)
          if (error) throw error
          const updated = get().audios.filter(a => a.id !== audioId)
          set({ audios: updated })
        } catch {}
      })()
      return
    }
    try {
      const raw = localStorage.getItem(KEY)
      const map = raw ? JSON.parse(raw) : {}
      const bookMap = map[bookId] || {}
      const list: AudioItem[] = bookMap[paragraphId] || []
      const updated = list.filter(a => a.id !== audioId)
      bookMap[paragraphId] = updated
      map[bookId] = bookMap
      localStorage.setItem(KEY, JSON.stringify(map))
      set({ audios: updated })
    } catch {}
  },
}))

