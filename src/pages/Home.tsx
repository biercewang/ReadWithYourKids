import { useState, useEffect } from 'react'
import { useAuthStore } from '../store/auth'
import { useBooksStore } from '../store/books'
import { useNavigate } from 'react-router-dom'
import { Book, Upload, Plus, BookOpen, Trash2, Play, KeyRound } from 'lucide-react'
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
              .insert([{ user_id: user.id, title: parsed.title || file.name.replace('.md', ''), author: parsed.author, cover_url: parsed.cover, metadata: { fileName: file.name, fileSize: file.size, uploadPath: uploadData.path } }])
              .select()
              .single()
            if (bookError) throw bookError
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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    )
  }

  // 未启用 Supabase 或未登录时也可使用本地模式

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center">
              <Book className="h-8 w-8 text-blue-600" />
              <h1 className="ml-3 text-2xl font-bold text-gray-900">亲子阅读助手</h1>
            </div>
            <div className="flex items-center space-x-4">
              
              <span className="text-gray-700">欢迎，{user?.name}</span>
              <button
                onClick={() => { setChangePwdOpen(true); setChangeError(''); setChangeOk(''); setCurrPwd(''); setNewPwd(''); setConfirmPwd('') }}
                className="text-gray-500 hover:text-gray-700 inline-flex items-center"
              >
                <KeyRound className="h-4 w-4 mr-1" />
                修改密码
              </button>
              <button
                onClick={() => {
                  useAuthStore.getState().signOut()
                  navigate('/login')
                }}
                className="text-gray-500 hover:text-gray-700"
              >
                退出登录
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-gray-900 mb-2">我的图书</h2>
          <p className="text-gray-600">上传EPUB格式的电子书，开始亲子阅读之旅</p>
        </div>

        

        {/* Books Grid */}
        {booksLoading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">加载图书中...</p>
          </div>
        ) : books.length === 0 ? (
          <div className="text-center py-12">
            <BookOpen className="mx-auto h-16 w-16 text-gray-400 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">还没有图书</h3>
            <p className="text-gray-600">上传您的第一本EPUB电子书开始阅读</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {books.map((book) => (
              <div key={book.id} className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow flex flex-col">
                <div className="p-4 flex flex-col h-full">
                  <h3 className="font-semibold text-gray-900 mb-2 text-base">{book.title}</h3>
                  <p className="text-sm text-gray-600">{book.author || '未知作者'}</p>
                  <div className="flex items-center space-x-2 mt-auto">
                    <button
                      onClick={() => handleStartReading(book)}
                      aria-label="开始阅读"
                      title="开始阅读"
                      className="flex-1 inline-flex items-center justify-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 shadow-sm hover:shadow-md"
                    >
                      <Play className="h-4 w-4" />
                    </button>
                    <div className="relative group">
                      <button
                        onClick={() => handleContinueReading(book)}
                        aria-label="继续阅读"
                        title="继续阅读"
                        className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 shadow-sm hover:shadow-md"
                      >
                        <BookOpen className="h-4 w-4" />
                      </button>
                      {(() => {
                        const s = readingStatesCloud[book.id]
                        if (!s) return null
                        const ct = chapterTitlesCloud[s.chapterId] || ''
                        return (
                          <div className="absolute z-10 hidden group-hover:block left-1/2 -translate-x-1/2 top-full mt-2 rounded-md bg-gray-900 text-white text-xs px-3 py-2 shadow-xl min-w-[220px] max-w-[340px] whitespace-pre-wrap break-words">
                            {(ct ? `《${ct}》` : '上次章节') + '\n' + `第 ${Math.max(1, (s.paragraphIndex || 0) + 1)} 段`}
                          </div>
                        )
                      })()}
                    </div>
                    <button onClick={() => handleDelete(book)} className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Upload Area (moved below books) */}
        <div className="mt-8">
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-300'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <Upload className="mx-auto h-12 w-12 text-gray-400 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">上传EPUB电子书</h3>
            <p className="text-gray-600 mb-4">拖拽文件到此处，或点击选择文件</p>
            <input
              type="file"
              accept=".md,.epub"
              onChange={handleFileInput}
              className="hidden"
              id="file-upload"
              disabled={isUploading}
            />
            <label
              htmlFor="file-upload"
              className={`inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 cursor-pointer ${
                isUploading ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              {isUploading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  上传中...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  选择文件
                </>
              )}
            </label>
          </div>
        </div>
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
