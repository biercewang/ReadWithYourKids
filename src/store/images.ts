import { create } from 'zustand'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { Image } from '../types/database'
import { useAuthStore } from './auth'

interface ImagesState {
  images: Image[]
  loadImages: (bookId: string, paragraphId: string) => void
  addImage: (bookId: string, chapterId: string, paragraphId: string, dataUrl: string, prompt: string) => void
  deleteImage: (bookId: string, paragraphId: string, imageId: string) => void
}

const KEY = 'demo_images'

function dataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',')
  const meta = parts[0] || ''
  const b64 = parts[1] || ''
  const mimeMatch = /data:(.*?);base64/.exec(meta)
  const mime = (mimeMatch && mimeMatch[1]) || 'image/png'
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

export const useImagesStore = create<ImagesState>((set, get) => ({
  images: [],
  loadImages: (bookId: string, paragraphId: string) => {
    const cloudOnly = typeof localStorage !== 'undefined' && localStorage.getItem('cloud_only') === '1'
    const supa = isSupabaseConfigured && supabase && (!(useImagesStore as any)._supaDown || cloudOnly)
    if (supa) {
      ;(async () => {
        try {
          const { data, error } = await supabase
            .from('images')
            .select('*')
            .eq('paragraph_id', paragraphId)
            .order('created_at', { ascending: false })
          if (error) throw error
          const list: Image[] = (data || []).map(row => ({
            id: row.id,
            paragraph_id: row.paragraph_id,
            image_url: row.image_url,
            prompt: row.prompt,
            created_at: row.created_at,
          }))
          set({ images: list })
        } catch {
          if (!cloudOnly) { (useImagesStore as any)._supaDown = true }
          try {
            const raw = localStorage.getItem(KEY)
            const map = raw ? JSON.parse(raw) : {}
            const bookMap = map[bookId] || {}
            const list: Image[] = bookMap[paragraphId] || []
            set({ images: list })
          } catch {
            set({ images: [] })
          }
        }
      })()
      return
    }
    try {
      const raw = localStorage.getItem(KEY)
      const map = raw ? JSON.parse(raw) : {}
      const bookMap = map[bookId] || {}
      const list: Image[] = bookMap[paragraphId] || []
      set({ images: list })
    } catch {
      set({ images: [] })
    }
  },
  addImage: (bookId: string, chapterId: string, paragraphId: string, dataUrl: string, prompt: string) => {
    const supa = isSupabaseConfigured && supabase
    const cloudOnly = typeof localStorage !== 'undefined' && localStorage.getItem('cloud_only') === '1'
    if (supa) {
      ;(async () => {
        try {
          const uid = useAuthStore.getState().user?.id || ''
          let publicUrl = ''
          try {
            const path = `${uid}/${bookId}/${chapterId}/${paragraphId}/${Date.now()}.png`
            let blob: Blob | null = null
            if (typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
              blob = dataUrlToBlob(dataUrl)
            } else if (typeof dataUrl === 'string' && /^https?:\/\//.test(dataUrl)) {
              try {
                const resp = await fetch(dataUrl)
                blob = await resp.blob()
              } catch {
                blob = null
              }
            }
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
            .from('images')
            .insert([{ paragraph_id: paragraphId, image_url: urlToSave, prompt }])
            .select()
            .single()
          if (error) throw error
          const img: Image = {
            id: data.id,
            paragraph_id: paragraphId,
            image_url: data.image_url,
            prompt: data.prompt,
            created_at: data.created_at,
          }
          set({ images: [img, ...get().images] })
        } catch (e) {
          if (!cloudOnly) { (useImagesStore as any)._supaDown = true }
          const img: Image = {
            id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
            paragraph_id: paragraphId,
            image_url: dataUrl,
            prompt,
            created_at: new Date().toISOString(),
          }
          try {
            const raw = localStorage.getItem(KEY)
            const map = raw ? JSON.parse(raw) : {}
            const bookMap = map[bookId] || {}
            const list: Image[] = bookMap[paragraphId] || []
            const updated = [img, ...list]
            bookMap[paragraphId] = updated
            map[bookId] = bookMap
            localStorage.setItem(KEY, JSON.stringify(map))
            set({ images: updated })
          } catch {
            set(state => ({ images: [img, ...(state.images || [])] }))
          }
        }
      })()
      return
    }

    const img: Image = {
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      paragraph_id: paragraphId,
      image_url: dataUrl,
      prompt,
      created_at: new Date().toISOString(),
    }
    try {
      const raw = localStorage.getItem(KEY)
      const map = raw ? JSON.parse(raw) : {}
      const bookMap = map[bookId] || {}
      const list: Image[] = bookMap[paragraphId] || []
      const updated = [img, ...list]
      bookMap[paragraphId] = updated
      map[bookId] = bookMap
      localStorage.setItem(KEY, JSON.stringify(map))
      set({ images: updated })
    } catch {
      set(state => ({ images: [img, ...(state.images || [])] }))
    }
  },
  deleteImage: (bookId: string, paragraphId: string, imageId: string) => {
    const supa = isSupabaseConfigured && supabase
    if (supa) {
      ;(async () => {
        try {
          const { error } = await supabase
            .from('images')
            .delete()
            .eq('id', imageId)
          if (error) throw error
          const updated = get().images.filter(i => i.id !== imageId)
          set({ images: updated })
        } catch {}
      })()
      return
    }
    try {
      const raw = localStorage.getItem(KEY)
      const map = raw ? JSON.parse(raw) : {}
      const bookMap = map[bookId] || {}
      const list: Image[] = bookMap[paragraphId] || []
      const updated = list.filter(i => i.id !== imageId)
      bookMap[paragraphId] = updated
      map[bookId] = bookMap
      localStorage.setItem(KEY, JSON.stringify(map))
      set({ images: updated })
    } catch {}
  },
}))
