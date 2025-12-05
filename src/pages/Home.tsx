import { useState, useEffect } from 'react'
import { useAuthStore } from '../store/auth'
import { useBooksStore } from '../store/books'
import { useNavigate } from 'react-router-dom'
import { Book, Upload, Plus, BookOpen, Trash2, Play, KeyRound, MoreHorizontal } from 'lucide-react'
import { parseMarkdownFile } from '../utils/mdParser'
import { EPUBParser } from '../utils/epubParser'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { Book as BookType, Chapter } from '../types/database'

export default function Home() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuthStore()
  const { books, isLoading: booksLoading, fetchBooks, uploadBook, deleteBook, setCurrentBook, setCurrentChapter, setParagraphs, setChapters, fetchParagraphs } = useBooksStore()
  const navigate = useNavigate()
  const [isUploading, setIsUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [bookToDelete, setBookToDelete] = useState<BookType | null>(null)
  const [changePwdOpen, setChangePwdOpen] = useState(false)
  const [currPwd, setCurrPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [changing, setChanging] = useState(false)
  const [changeError, setChangeError] = useState('')
  const [changeOk, setChangeOk] = useState('')
  const [readingStatesCloud, setReadingStatesCloud] = useState<Record<string, { chapterId: string; paragraphIndex: number; mergedStart?: number; mergedEnd?: number; updatedAt?: string }>>({})
  const [chapterTitlesCloud, setChapterTitlesCloud] = useState<Record<string, string>>({})
  const [chapterParaCountsCloud, setChapterParaCountsCloud] = useState<Record<string, number>>({})
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false)
  const [cardMenuOpenId, setCardMenuOpenId] = useState<string | null>(null)

  useEffect(() => {
    if (!authLoading) {
      if (isSupabaseConfigured && !isAuthenticated) {
        navigate('/login')
      } else if (user) {
        fetchBooks(user.id)
      }
    }
  }, [authLoading, isAuthenticated, user, navigate, fetchBooks])

  useEffect(() => {
    try {
      if (user && localStorage.getItem('home_refresh') === '1') {
        fetchBooks(user.id)
        localStorage.removeItem('home_refresh')
      }
    } catch {}
  }, [user, fetchBooks])

  // 仅云端模式：不再读取本地 demo_* 或 reading_state

  useEffect(() => {
    (async () => {
      if (!isSupabaseConfigured || !user) return
      try {
        const { data: rp } = await supabase
          .from('reading_progress')
          .select('book_id, chapter_id, paragraph_index, merged_start, merged_end, updated_at')
          .eq('user_id', user.id);
        const map: Record<string, { chapterId: string; paragraphIndex: number; mergedStart?: number; mergedEnd?: number; updatedAt?: string }> = {};
        const chIds: string[] = [];
        (rp || []).forEach((row: any) => {
          if (row && row.book_id) {
            map[row.book_id] = { chapterId: row.chapter_id, paragraphIndex: row.paragraph_index || 0, mergedStart: row.merged_start, mergedEnd: row.merged_end, updatedAt: row.updated_at };
            if (row.chapter_id) chIds.push(row.chapter_id);
          }
        });
        setReadingStatesCloud(map);
        if (chIds.length > 0) {
          const { data: chRows } = await supabase
            .from('chapters')
            .select('id,title')
            .in('id', Array.from(new Set(chIds)));
          const ctm: Record<string, string> = {};
          (chRows || []).forEach((c: any) => { if (c && c.id) ctm[c.id] = c.title || '' });
          setChapterTitlesCloud(ctm);
        }
      } catch {}
    })()
  }, [isSupabaseConfigured, user, books])

  useEffect(() => {
    (async () => {
      if (!isSupabaseConfigured || !user) return
      const ids = Array.from(new Set(Object.values(readingStatesCloud).map(s => s.chapterId).filter(Boolean)))
      if (ids.length === 0) return
      try {
        const counts: Record<string, number> = {}
        for (const cid of ids) {
          const { count } = await supabase.from('paragraphs').select('id', { count: 'exact', head: true }).eq('chapter_id', cid)
          counts[cid] = typeof count === 'number' ? count : 0
        }
        setChapterParaCountsCloud(counts)
      } catch {}
    })()
  }, [isSupabaseConfigured, user, readingStatesCloud])

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      const insideAvatar = !!t && (!!t.closest('.avatar-menu') || !!t.closest('.avatar-menu-trigger'))
      const insideCardMenu = !!t && (!!t.closest('.book-card-menu') || !!t.closest('.book-card-menu-trigger'))
      if (!insideAvatar) setAvatarMenuOpen(false)
      if (!insideCardMenu) setCardMenuOpenId(null)
    }
    document.addEventListener('click', onDocClick)
    return () => { document.removeEventListener('click', onDocClick) }
  }, [])

  const handleFileUpload = async (file: File) => {
    if (!user) return
    
    setIsUploading(true)
    try {
      const lower = file.name.toLowerCase()
      let parsed: { title: string; author?: string; cover?: string; chapters: { title: string; paragraphs: { content: string; orderIndex: number }[] }[] }
      if (lower.endsWith('.md')) {
        try {
          parsed = await parseMarkdownFile(file)
        } catch (e) {
          throw new Error(`解析Markdown失败: ${e instanceof Error ? e.message : String(e)}`)
        }
      } else if (lower.endsWith('.epub')) {
        try {
          parsed = await EPUBParser.parseBook(file)
        } catch (e) {
          throw new Error(`解析EPUB失败: ${e instanceof Error ? e.message : String(e)}`)
        }
      } else {
        alert('请上传Markdown(.md)或EPUB(.epub)文件')
        return
      }
      if (isSupabaseConfigured && supabase) {
        const { data: sessionData } = await supabase.auth.getSession()
        if (sessionData?.session) {
          try {
            const fileName = `${user.id}/${Date.now()}-${file.name}`
            const { data: uploadData, error: uploadError } = await supabase.storage.from('books').upload(fileName, file)
            if (uploadError) throw uploadError
            const { data: bookData, error: bookError } = await supabase
              .from('books')
              .insert([{ user_id: user.id, title: parsed.title || file.name.replace('.md', ''), author: parsed.author, metadata: { fileName: file.name, fileSize: file.size, uploadPath: uploadData.path } }])
              .select()
              .single()
            if (bookError) throw bookError
            if (bookData && parsed.cover && parsed.cover.startsWith('data:image/')) {
              const m = parsed.cover.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/) as RegExpMatchArray | null
              const mime = (m && m[1]) ? m[1] : 'image/jpeg'
              const ext = (mime.split('/')[1] || 'jpeg').replace(/[^a-z0-9]+/gi, '')
              const parts = parsed.cover.split(',')
              const bstr = atob(parts[1] || '')
              const bytes = new Uint8Array(bstr.length)
              for (let i = 0; i < bstr.length; i++) bytes[i] = bstr.charCodeAt(i)
              const blob = new Blob([bytes], { type: mime })
              const coverPath = `${user.id}/covers/${bookData.id}.${ext}`
              const { error: coverErr } = await supabase.storage.from('books').upload(coverPath, blob, { upsert: true })
              if (!coverErr) {
                const { data: pub } = supabase.storage.from('books').getPublicUrl(coverPath)
                const url = (pub?.publicUrl || '')
                if (url && url.length > 0) {
                  await supabase.from('books').update({ cover_url: url }).eq('id', bookData.id)
                }
              }
            }
            const chRows = (parsed.chapters || []).map((c, idx) => ({ book_id: bookData.id, title: c.title || `(${idx + 1})`, order_index: idx + 1 }))
            const { error: chErr } = await supabase.from('chapters').insert(chRows)
            if (chErr) throw chErr
            const { data: fetchedCh, error: chFetchErr } = await supabase
              .from('chapters')
              .select('*')
              .eq('book_id', bookData.id)
              .order('order_index', { ascending: true })
            if (chFetchErr) throw chFetchErr
            const allParas = [] as { chapter_id: string; content: string; order_index: number }[]
            for (let i = 0; i < (parsed.chapters || []).length; i++) {
              const c = parsed.chapters[i]
              const ch = fetchedCh[i]
              const plist = (c.paragraphs || []).map((p, j) => ({ chapter_id: ch.id, content: p.content, order_index: j + 1 }))
              allParas.push(...plist)
            }
            if (allParas.length > 0) {
              const batchSize = 500
              for (let i = 0; i < allParas.length; i += batchSize) {
                const batch = allParas.slice(i, i + batchSize)
                const { error: pErr } = await supabase.from('paragraphs').insert(batch)
                if (pErr) throw pErr
              }
            }
            setCurrentBook(bookData)
            const chList: Chapter[] = fetchedCh.map(c => ({ id: c.id, book_id: c.book_id, title: c.title, order_index: c.order_index, created_at: c.created_at }))
            setChapters(chList)
            const first = chList[0]
            setCurrentChapter(first)
            await fetchParagraphs(first.id)
            navigate(`/reader/${bookData.id}?fresh=1`)
            return
          } catch (e) {
            alert('当前仅支持云端模式，请稍后重试或检查网络/登录状态')
            return
          }
        }
      }
      // 云端模式强制：如果未登录或上传失败，则提示后终止
      alert('云端模式已启用：请登录并确保云端可用后再上传')
      return
    } catch (error) {
      console.error('Upload error:', error)
      alert(error instanceof Error ? error.message : '上传失败，请重试')
    } finally {
      setIsUploading(false)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    
    const files = Array.from(e.dataTransfer.files)
    const accepted = files.filter(file => {
      const n = file.name.toLowerCase()
      return n.endsWith('.md') || n.endsWith('.epub')
    })
    if (accepted.length > 0) {
      handleFileUpload(accepted[0])
    } else {
      alert('请上传Markdown(.md)或EPUB(.epub)文件')
    }
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      handleFileUpload(file)
    }
  }

  const handleStartReading = (book: BookType) => {
    setCurrentBook(book)
    navigate(`/reader/${book.id}?fresh=1`)
  }

  const handleContinueReading = (book: BookType) => {
    setCurrentBook(book)
    navigate(`/reader/${book.id}`)
  }

  const handleDelete = (book: BookType) => {
    if (!user) return
    setBookToDelete(book)
    setConfirmDeleteOpen(true)
  }
  const confirmDelete = async () => {
    if (!user || !bookToDelete) return
    try {
      await deleteBook(bookToDelete.id, user.id)
      setConfirmDeleteOpen(false)
      setBookToDelete(null)
    } catch (e) {
      alert(e instanceof Error ? e.message : '删除失败，请重试')
    }
  }
  const cancelDelete = () => {
    setConfirmDeleteOpen(false)
    setBookToDelete(null)
  }

  const submitChangePassword = async () => {
    setChangeError('')
    setChangeOk('')
    if (!currPwd || !newPwd || !confirmPwd) { setChangeError('请填写完整'); return }
    if (newPwd.length < 6) { setChangeError('新密码至少6位'); return }
    if (newPwd !== confirmPwd) { setChangeError('两次输入的新密码不一致'); return }
    try {
      setChanging(true)
      await useAuthStore.getState().changePassword(currPwd, newPwd)
      setChangeOk('密码修改成功')
      setTimeout(() => { setChangePwdOpen(false); setChangeOk('') }, 1200)
    } catch (e: any) {
      setChangeError(e?.message || '修改密码失败')
    } finally {
      setChanging(false)
    }
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#FAF7F5] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-500 mx-auto"></div>
          <p className="mt-4 text-[#4A5568]">加载中...</p>
        </div>
      </div>
    )
  }

  // 未启用 Supabase 或未登录时也可使用本地模式

  return (
    <div className="min-h-screen bg-[#FAF7F5]">
      <header className="bg-transparent">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center">
              <Book className="h-9 w-9 text-amber-600" />
              <h1 className="ml-3 text-3xl font-semibold tracking-tight text-[#2D3748]">亲子阅读助手</h1>
            </div>
            <div className="relative">
              <button
                onClick={() => setAvatarMenuOpen(v => !v)}
                className="avatar-menu-trigger w-10 h-10 rounded-full bg-white shadow-md flex items-center justify-center text-[#2D3748]"
                style={{ boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}
              >
                <span className="text-sm font-medium">{(user?.name || 'U').slice(0, 1).toUpperCase()}</span>
              </button>
              {avatarMenuOpen && (
                <div className="avatar-menu absolute right-0 mt-2 w-44 rounded-xl bg-white shadow-lg ring-1 ring-black/5 py-2" style={{ boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
                  <button
                    onClick={() => { setAvatarMenuOpen(false); setChangePwdOpen(true); setChangeError(''); setChangeOk(''); setCurrPwd(''); setNewPwd(''); setConfirmPwd('') }}
                    className="w-full text-left px-3 py-2 text-sm text-[#2D3748] hover:bg-amber-50"
                  >修改密码</button>
                  <button
                    onClick={() => { setAvatarMenuOpen(false); useAuthStore.getState().signOut(); navigate('/login') }}
                    className="w-full text-left px-3 py-2 text-sm text-[#2D3748] hover:bg-amber-50"
                  >退出登录</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h2 className="text-3xl font-semibold text-[#2D3748] mb-2">我的图书</h2>
          <p className="text-[#4A5568]">导入喜欢的书，在温馨的书房开始亲子阅读</p>
        </div>

        

        {booksLoading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-500 mx-auto mb-4"></div>
            <p className="text-[#4A5568]">加载图书中...</p>
          </div>
        ) : (
          <>
            {books.length === 0 && (
              <div className="text-center py-12">
                <svg className="mx-auto mb-4" width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="10" y="20" width="100" height="80" rx="16" fill="#FFF" stroke="#E5D9CF" strokeWidth="2" />
                  <circle cx="60" cy="60" r="20" fill="#F4D2A6" />
                  <circle cx="52" cy="56" r="3" fill="#2D3748" />
                  <circle cx="68" cy="56" r="3" fill="#2D3748" />
                  <path d="M48 68 C52 72, 68 72, 72 68" stroke="#2D3748" strokeWidth="3" strokeLinecap="round" />
                  <rect x="36" y="76" width="48" height="6" rx="3" fill="#EFD9C9" />
                </svg>
                <h3 className="text-lg font-medium text-[#2D3748] mb-2">还没有图书</h3>
                <p className="text-[#4A5568]">导入新书，开启一次温馨的亲子阅读</p>
              </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-6">
              <div className="group relative rounded-xl bg-white overflow-hidden transition-transform hover:-translate-y-1" style={{ boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}>
                <label htmlFor="file-upload" className="cursor-pointer block w-full h-full">
                  <div className="flex flex-col items-center justify-center" style={{ height: '100%' }}>
                    <div className="w-full" style={{ aspectRatio: '2 / 3' }}>
                      <div className="w-full h-full flex items-center justify-center border-2 border-dashed border-[#E5D9CF] bg-white/60">
                        <Plus className="h-10 w-10 text-amber-600" />
                      </div>
                    </div>
                    <div className="w-full px-4 py-3">
                      <div className="h-1.5 w-full bg-[#F0E6DE] rounded-full" />
                      <div className="mt-2 text-sm font-medium text-[#2D3748] truncate">导入新书</div>
                    </div>
                  </div>
                </label>
              </div>
              {books.map((book) => {
                const s = readingStatesCloud[book.id]
                const ct = s ? chapterTitlesCloud[s.chapterId] || '' : ''
                const total = s ? (chapterParaCountsCloud[s.chapterId] || 0) : 0
                const curr = s ? (s.paragraphIndex || 0) + 1 : 0
                const pct = total > 0 ? Math.max(0, Math.min(100, Math.round((curr / total) * 100))) : 0
                const coverSrc = book.cover_url && book.cover_url.length > 0 ? book.cover_url : (() => {
                  const t = (book.title || '').trim()
                  const bg = '#F3EAE3'
                  const fg = '#2D3748'
                  const ch = (t || '书').slice(0, 1)
                  const svg = `<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"400\" height=\"600\"><rect width=\"100%\" height=\"100%\" fill=\"${bg}\"/><text x=\"50%\" y=\"55%\" dominant-baseline=\"middle\" text-anchor=\"middle\" font-size=\"180\" font-family=\"Georgia, serif\" fill=\"${fg}\" opacity=\"0.85\">${ch}</text></svg>`
                  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
                })()
                return (
                  <div key={book.id} className="group relative rounded-xl bg-white overflow-hidden transition-transform hover:-translate-y-1" style={{ boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}>
                    <div className="w-full" style={{ aspectRatio: '2 / 3' }}>
                      <img src={coverSrc} alt={book.title} className="w-full h-full object-cover" />
                      <button
                        onClick={() => handleStartReading(book)}
                        className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                        aria-label="开始阅读"
                        title="开始阅读"
                      >
                        <span className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-amber-500 text-white shadow-lg">
                          <Play className="h-6 w-6" />
                        </span>
                      </button>
                      <div className="absolute right-3 top-3">
                        <button
                          onClick={(e) => { e.stopPropagation(); setCardMenuOpenId(id => (id === book.id ? null : book.id)) }}
                          className="book-card-menu-trigger w-9 h-9 rounded-full bg-white/90 backdrop-blur-sm text-[#2D3748] inline-flex items-center justify-center"
                          aria-label="更多操作"
                          title="更多操作"
                        >
                          <MoreHorizontal className="h-5 w-5" />
                        </button>
                        {cardMenuOpenId === book.id && (
                          <div className="book-card-menu absolute right-0 mt-2 w-36 rounded-xl bg-white shadow-lg ring-1 ring-black/5 py-2" style={{ boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
                            <button onClick={() => { setCardMenuOpenId(null); handleStartReading(book) }} className="w-full text-left px-3 py-2 text-sm text-[#2D3748] hover:bg-amber-50">从头阅读</button>
                            <button onClick={() => { setCardMenuOpenId(null); handleDelete(book) }} className="w-full text-left px-3 py-2 text-sm text-[#2D3748] hover:bg-amber-50">删除</button>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="px-4 py-3">
                      <div className="h-1.5 w-full bg-[#F0E6DE] rounded-full overflow-hidden">
                        <div style={{ width: `${pct}%` }} className="h-full bg-amber-500 rounded-full" />
                      </div>
                      <div className="mt-2 text-sm font-medium text-[#2D3748] truncate">{book.title}</div>
                      <div className="text-xs text-[#4A5568] truncate">{book.author || '未知作者'}</div>
                      {s && (
                        <div className="mt-1 text-[11px] text-[#4A5568] truncate">{(ct ? `《${ct}》` : '上次章节') + ' · 第 ' + Math.max(1, curr) + ' 段'}</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        <input type="file" accept=".md,.epub" onChange={handleFileInput} className="hidden" id="file-upload" disabled={isUploading} />
      </main>
      {confirmDeleteOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-6">
            <h4 className="text-lg font-semibold text-gray-900 mb-3">确认删除</h4>
            <p className="text-sm text-gray-700 mb-6">确定删除“{bookToDelete?.title}”及其本地数据吗？此操作不可撤销。</p>
            <div className="flex justify-end space-x-3">
              <button onClick={cancelDelete} className="px-4 py-2 rounded-md border border-gray-300 text-gray-700 bg-white hover:bg-gray-50">取消</button>
              <button onClick={confirmDelete} className="px-4 py-2 rounded-md text-white bg-red-600 hover:bg-red-700">删除</button>
            </div>
          </div>
        </div>
      )}
      {changePwdOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-6">
            <h4 className="text-lg font-semibold text-gray-900 mb-3">修改密码</h4>
            <div className="space-y-3">
              <input
                type="password"
                placeholder="当前密码"
                value={currPwd}
                onChange={(e)=>setCurrPwd(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              />
              <input
                type="password"
                placeholder="新密码（至少6位）"
                value={newPwd}
                onChange={(e)=>setNewPwd(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              />
              <input
                type="password"
                placeholder="确认新密码"
                value={confirmPwd}
                onChange={(e)=>setConfirmPwd(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              />
              {changeError && <div className="text-sm text-red-600">{changeError}</div>}
              {changeOk && <div className="text-sm text-green-600">{changeOk}</div>}
            </div>
            <div className="flex justify-end space-x-3 mt-4">
              <button onClick={()=>setChangePwdOpen(false)} className="px-4 py-2 rounded-md border border-gray-300 text-gray-700 bg-white hover:bg-gray-50">取消</button>
              <button onClick={submitChangePassword} disabled={changing} className="px-4 py-2 rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50">{changing ? '修改中...' : '确认修改'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
