import { create } from 'zustand'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { Translation } from '../types/database'

interface TranslationsState {
  translations: Translation[]
  loadTranslation: (bookId: string, paragraphId: string) => void
  addTranslation: (bookId: string, paragraphId: string, text: string, language: string) => void
  deleteTranslation: (bookId: string, paragraphId: string, translationId: string) => void
}

const KEY = 'demo_translations'

export const useTranslationsStore = create<TranslationsState>((set, get) => ({
  translations: [],
  loadTranslation: (bookId: string, paragraphId: string) => {
    const supa = isSupabaseConfigured && supabase
    if (supa) {
      ;(async () => {
        try {
          const { data, error } = await supabase
            .from('translations')
            .select('*')
            .eq('paragraph_id', paragraphId)
            .order('created_at', { ascending: false })
          if (error) throw error
          const list: Translation[] = (data || []).map(row => ({
            id: row.id,
            paragraph_id: row.paragraph_id,
            translated_text: row.translated_text,
            language: row.language,
            created_at: row.created_at,
          }))
          set({ translations: list })
        } catch {
          set({ translations: [] })
        }
      })()
      return
    }
    try {
      const raw = localStorage.getItem(KEY)
      const map = raw ? JSON.parse(raw) : {}
      const bookMap = map[bookId] || {}
      const text: string = bookMap[paragraphId] || ''
      const t: Translation | null = text && text.length > 0 ? {
        id: 'local',
        paragraph_id: paragraphId,
        translated_text: text,
        language: 'zh',
        created_at: new Date().toISOString(),
      } : null
      set({ translations: t ? [t] : [] })
    } catch {
      set({ translations: [] })
    }
  },
  addTranslation: (bookId: string, paragraphId: string, text: string, language: string) => {
    const supa = isSupabaseConfigured && supabase
    if (supa) {
      ;(async () => {
        try {
          const { data, error } = await supabase
            .from('translations')
            .insert([{ paragraph_id: paragraphId, translated_text: text, language }])
            .select()
            .single()
          if (error) throw error
          const t: Translation = {
            id: data.id,
            paragraph_id: data.paragraph_id,
            translated_text: data.translated_text,
            language: data.language,
            created_at: data.created_at,
          }
          set({ translations: [t, ...get().translations] })
        } catch {}
      })()
      return
    }
    try {
      const raw = localStorage.getItem(KEY)
      const map = raw ? JSON.parse(raw) : {}
      const bookMap = map[bookId] || {}
      bookMap[paragraphId] = text
      map[bookId] = bookMap
      localStorage.setItem(KEY, JSON.stringify(map))
      const t: Translation = {
        id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        paragraph_id: paragraphId,
        translated_text: text,
        language,
        created_at: new Date().toISOString(),
      }
      set({ translations: [t, ...get().translations] })
    } catch {}
  },
  deleteTranslation: (bookId: string, paragraphId: string, translationId: string) => {
    const supa = isSupabaseConfigured && supabase
    if (supa) {
      ;(async () => {
        try {
          const { error } = await supabase
            .from('translations')
            .delete()
            .eq('id', translationId)
          if (error) throw error
          const updated = get().translations.filter(t => t.id !== translationId)
          set({ translations: updated })
        } catch {}
      })()
      return
    }
    try {
      const raw = localStorage.getItem(KEY)
      const map = raw ? JSON.parse(raw) : {}
      const bookMap = map[bookId] || {}
      const text: string = bookMap[paragraphId] || ''
      if (text) {
        delete bookMap[paragraphId]
        map[bookId] = bookMap
        localStorage.setItem(KEY, JSON.stringify(map))
      }
      const updated = get().translations.filter(t => t.id !== translationId)
      set({ translations: updated })
    } catch {}
  }
}))

