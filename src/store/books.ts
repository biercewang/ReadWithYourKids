import { create } from 'zustand'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
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
  setCurrentChapter: (chapter: Chapter) => void
  setChapters: (chapters: Chapter[]) => void
  fetchChapters: (bookId: string) => Promise<void>
  fetchParagraphs: (chapterId: string) => Promise<void>
  setParagraphs: (paragraphs: Paragraph[]) => void
}

export const useBooksStore = create<BooksState>((set, get) => ({
  books: [],
  currentBook: null,
  currentChapter: null,
  chapters: [],
  paragraphs: [],
  isLoading: false,

  fetchBooks: async (userId: string) => {
    try {
      set({ isLoading: true })
      if (!isSupabaseConfigured || !supabase) {
        const raw = localStorage.getItem('demo_books')
        const demoBooks: Book[] = raw ? JSON.parse(raw) : []
        set({ books: demoBooks, isLoading: false })
        return
      }
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
    }
  },

  uploadBook: async (file: File, userId: string) => {
    try {
      set({ isLoading: true })
      if (!isSupabaseConfigured || !supabase) {
        const newBook: Book = {
          id: newId(),
          user_id: userId,
          title: file.name.replace('.epub', ''),
          author: '未知作者',
          cover_url: undefined,
          metadata: {
            fileName: file.name,
            fileSize: file.size,
            uploadPath: `local/${userId}/${Date.now()}-${file.name}`,
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
        const raw = localStorage.getItem('demo_books')
        const demoBooks: Book[] = raw ? JSON.parse(raw) : []
        const updated = [newBook, ...demoBooks]
        localStorage.setItem('demo_books', JSON.stringify(updated))
        set({ books: updated, isLoading: false })
        return
      }
      
      // Upload file to Supabase Storage
      const fileName = `${userId}/${Date.now()}-${file.name}`
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('books')
        .upload(fileName, file)
      
      if (uploadError) throw uploadError
      
      // Create book record
      const { data: bookData, error: bookError } = await supabase
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
        .select()
        .single()
      
      if (bookError) throw bookError
      
      // Refresh books list
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
      if (!isSupabaseConfigured || !supabase) {
        const raw = localStorage.getItem('demo_books')
        const demoBooks: Book[] = raw ? JSON.parse(raw) : []
        const updated = demoBooks.filter(b => b.id !== bookId)
        localStorage.setItem('demo_books', JSON.stringify(updated))
        set({ books: updated, isLoading: false })
        return
      }
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
    set({ currentBook: book })
  },

  setCurrentChapter: (chapter: Chapter) => {
    set({ currentChapter: chapter })
  },

  setChapters: (chapters: Chapter[]) => {
    set({ chapters })
  },

  fetchChapters: async (bookId: string) => {
    try {
      if (!isSupabaseConfigured || !supabase) {
        set({ chapters: [] })
        return
      }
      const { data, error } = await supabase
        .from('chapters')
        .select('*')
        .eq('book_id', bookId)
        .order('order_index', { ascending: true })
      if (error) throw error
      set({ chapters: data || [] })
    } catch (error) {
      console.error('Fetch chapters error:', error)
    }
  },

  fetchParagraphs: async (chapterId: string) => {
    try {
      if (!isSupabaseConfigured || !supabase) {
        set({ paragraphs: [] })
        return
      }
      const { data, error } = await supabase
        .from('paragraphs')
        .select('*')
        .eq('chapter_id', chapterId)
        .order('order_index', { ascending: true })
      
      if (error) throw error
      set({ paragraphs: data || [] })
    } catch (error) {
      console.error('Fetch paragraphs error:', error)
    }
  },
  setParagraphs: (paragraphs: Paragraph[]) => {
    set({ paragraphs })
  },
}))
import { newId } from '../utils/id'
