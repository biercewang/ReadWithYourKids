import { create } from 'zustand'
import { Note, NoteRole } from '../types/notes'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { useAuthStore } from './auth'

interface NotesState {
  notes: Note[]
  currentRole: NoteRole
  loadNotes: (bookId: string, paragraphId: string) => void
  loadNotesSmart: (bookIds: string[], paragraphId: string) => void
  addNote: (bookId: string, chapterId: string, paragraphId: string, content: string) => void
  deleteNote: (bookId: string, paragraphId: string, noteId: string) => void
  setRole: (role: NoteRole) => void
}

const KEY = 'demo_notes'

export const useNotesStore = create<NotesState>((set, get) => ({
  notes: [],
  currentRole: 'parent',
  loadNotes: (bookId: string, paragraphId: string) => {
    const supa = isSupabaseConfigured && supabase
    if (supa) {
      ;(async () => {
        try {
          const { data, error } = await supabase
            .from('discussions')
            .select('*')
            .eq('paragraph_id', paragraphId)
            .order('created_at', { ascending: false })
          if (error) throw error
          const list: Note[] = (data || []).map(d => ({
            id: d.id,
            book_id: bookId,
            chapter_id: '',
            paragraph_id: d.paragraph_id,
            user_type: d.user_type,
            content: d.content,
            created_at: d.created_at,
          }))
          set({ notes: list })
        } catch {
          set({ notes: [] })
        }
      })()
      return
    }
    try {
      const raw = localStorage.getItem(KEY)
      const map = raw ? JSON.parse(raw) : {}
      const bookMap = map[bookId] || {}
      const list: Note[] = bookMap[paragraphId] || []
      set({ notes: list })
    } catch {
      set({ notes: [] })
    }
  },
  loadNotesSmart: (bookIds: string[], paragraphId: string) => {
    const supa = isSupabaseConfigured && supabase
    if (supa) {
      get().loadNotes(bookIds[0], paragraphId)
      return
    }
    try {
      const raw = localStorage.getItem(KEY)
      const map = raw ? JSON.parse(raw) : {}
      for (const bid of bookIds) {
        const bookMap = map[bid] || {}
        const list: Note[] = bookMap[paragraphId] || []
        if (list && list.length > 0) {
          set({ notes: list })
          return
        }
      }
      set({ notes: [] })
    } catch {
      set({ notes: [] })
    }
  },
  addNote: (bookId: string, chapterId: string, paragraphId: string, content: string) => {
    const role = get().currentRole
    const supa = isSupabaseConfigured && supabase
    if (supa) {
      ;(async () => {
        try {
          const uid = useAuthStore.getState().user?.id || ''
          const { data, error } = await supabase
            .from('discussions')
            .insert([{ paragraph_id: paragraphId, user_id: uid, content, user_type: role }])
            .select()
            .single()
          if (error) throw error
          const note: Note = {
            id: data.id,
            book_id: bookId,
            chapter_id: chapterId,
            paragraph_id: paragraphId,
            user_type: data.user_type,
            content: data.content,
            created_at: data.created_at,
          }
          set({ notes: [note, ...get().notes] })
        } catch {}
      })()
      return
    }
    const note: Note = {
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      book_id: bookId,
      chapter_id: chapterId,
      paragraph_id: paragraphId,
      user_type: role,
      content,
      created_at: new Date().toISOString(),
    }
    try {
      const raw = localStorage.getItem(KEY)
      const map = raw ? JSON.parse(raw) : {}
      const bookMap = map[bookId] || {}
      const list: Note[] = bookMap[paragraphId] || []
      const updated = [note, ...list]
      bookMap[paragraphId] = updated
      map[bookId] = bookMap
      localStorage.setItem(KEY, JSON.stringify(map))
      set({ notes: updated })
    } catch {
      set(state => ({ notes: [note, ...state.notes] }))
    }
  },
  deleteNote: (bookId: string, paragraphId: string, noteId: string) => {
    const supa = isSupabaseConfigured && supabase
    if (supa) {
      ;(async () => {
        try {
          const { error } = await supabase
            .from('discussions')
            .delete()
            .eq('id', noteId)
          if (error) throw error
          const updated = get().notes.filter(n => n.id !== noteId)
          set({ notes: updated })
        } catch {}
      })()
      return
    }
    try {
      const raw = localStorage.getItem(KEY)
      const map = raw ? JSON.parse(raw) : {}
      const bookMap = map[bookId] || {}
      const list: Note[] = bookMap[paragraphId] || []
      const updated = list.filter(n => n.id !== noteId)
      bookMap[paragraphId] = updated
      map[bookId] = bookMap
      localStorage.setItem(KEY, JSON.stringify(map))
      set({ notes: updated })
    } catch {}
  },
  setRole: (role: NoteRole) => set({ currentRole: role }),
}))
