import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { Book, Chapter, Paragraph } from '../types/database'

interface BooksState {
  books: Book[]
  currentBook: Book | null
  currentChapter: Chapter | null
  chapters: Chapter[]
  paragraphs: Paragraph[]
  isLoading: boolean
  fetchBooks: (userId: string) => Promise<void>
  uploadBook: (file: File, userId: string) => Promise<void>
  deleteBook: (bookId: string, userId: string) => Promise<void>
  setCurrentBook: (book: Book) => void
  setCurrentChapter: (chapter: Chapter | null) => void
  setChapters: (chapters: Chapter[]) => void
  fetchChapters: (bookId: string) => Promise<void>
  fetchParagraphs: (chapterId: string) => Promise<void>
  setParagraphs: (paragraphs: Paragraph[]) => void
}

export const useBooksStore = create<BooksState>((set, get) => ({
  // Supabase runtime down detector to avoid repeated failing requests
  // Set to true on first failure, subsequent calls will use local fallback
  // (reset on page reload)
  
  books: [],
  currentBook: null,
  currentChapter: null,
  chapters: [],
  paragraphs: [],
  isLoading: false,

  fetchBooks: async (userId: string) => {
    try {
      set({ isLoading: true })
      const { data, error } = await supabase
        .from('books')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
      if (error) throw error
      set({ books: data || [], isLoading: false })
    } catch (error) {
      console.error('Fetch books error:', error)
      set({ isLoading: false })
      throw error
    }
  },

  uploadBook: async (file: File, userId: string) => {
    try {
      set({ isLoading: true })
      const toSafeName = (name: string) => {
        const trimmed = (name || '').trim()
        const idx = trimmed.lastIndexOf('.')
        const ext = idx >= 0 ? trimmed.slice(idx + 1).toLowerCase() : ''
        const base = idx >= 0 ? trimmed.slice(0, idx) : trimmed
        const normalized = base.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        const ascii = normalized.replace(/[^a-zA-Z0-9\-_.\s]/g, '')
        const dashed = ascii.replace(/\s+/g, '-')
        const collapsed = dashed.replace(/-+/g, '-').replace(/^-|-$|^\.+|\.+$/g, '')
        const lower = collapsed.toLowerCase()
        const safeBase = lower.length > 0 ? lower.slice(0, 120) : 'book'
        const safeExt = ext && ext.length > 0 ? ext : 'epub'
        return `${safeBase}.${safeExt}`
      }
      const safeName = toSafeName(file.name)
      const fileName = `${userId}/${Date.now()}-${safeName}`
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('books')
        .upload(fileName, file)
      if (uploadError) throw uploadError
      const { error: bookError } = await supabase
        .from('books')
        .insert([
          {
            user_id: userId,
            title: file.name.replace('.epub', ''),
            metadata: {
              fileName: file.name,
              fileSize: file.size,
              uploadPath: uploadData.path,
            }
          }
        ])
      if (bookError) throw bookError
      await get().fetchBooks(userId)
      set({ isLoading: false })
    } catch (error) {
      console.error('Upload book error:', error)
      set({ isLoading: false })
      throw error
    }
  },

  deleteBook: async (bookId: string, userId: string) => {
    try {
      set({ isLoading: true })
      const book = get().books.find(b => b.id === bookId)
      const uploadPath = (book?.metadata && (book.metadata as any).uploadPath) || undefined
      if (uploadPath) {
        await supabase.storage.from('books').remove([uploadPath])
      }
      const { error } = await supabase.from('books').delete().eq('id', bookId).eq('user_id', userId)
      if (error) throw error
      const remaining = get().books.filter(b => b.id !== bookId)
      set({ books: remaining, isLoading: false })
    } catch (error) {
      console.error('Delete book error:', error)
      set({ isLoading: false })
      throw error
    }
  },

  setCurrentBook: (book: Book) => {
    set({ currentBook: book, currentChapter: null, chapters: [], paragraphs: [] })
  },

  setCurrentChapter: (chapter: Chapter | null) => {
    set({ currentChapter: chapter })
  },

  setChapters: (chapters: Chapter[]) => {
    set({ chapters })
  },

  fetchChapters: async (bookId: string) => {
    try {
      const { data, error } = await supabase
        .from('chapters')
        .select('*')
        .eq('book_id', bookId)
        .order('order_index', { ascending: true })
      if (error) throw error
      set({ chapters: data || [] })
    } catch (error) {
      console.error('Fetch chapters error:', error)
      set({ chapters: [] })
    }
  },

  fetchParagraphs: async (chapterId: string) => {
    try {
      const { data, error } = await supabase
        .from('paragraphs')
        .select('*')
        .eq('chapter_id', chapterId)
        .order('order_index', { ascending: true })
      if (error) throw error
      set({ paragraphs: data || [] })
    } catch (error) {
      console.error('Fetch paragraphs error:', error)
      set({ paragraphs: [] })
    }
  },
  setParagraphs: (paragraphs: Paragraph[]) => {
    set({ paragraphs })
  },
}))
