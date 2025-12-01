import { useState, useEffect } from 'react'
import { useAuthStore } from '../store/auth'
import { useBooksStore } from '../store/books'
import { useNavigate } from 'react-router-dom'
import { Book, Upload, Plus, BookOpen, Trash2, Play } from 'lucide-react'
import { parseMarkdownFile } from '../utils/mdParser'
import { EPUBParser } from '../utils/epubParser'
import { newId } from '../utils/id'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { Book as BookType, Chapter, Paragraph } from '../types/database'

export default function Home() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuthStore()
  const { books, isLoading: booksLoading, fetchBooks, uploadBook, deleteBook, setCurrentBook, setCurrentChapter, setParagraphs, setChapters, fetchParagraphs } = useBooksStore()
  const navigate = useNavigate()
  const [isUploading, setIsUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [bookToDelete, setBookToDelete] = useState<BookType | null>(null)

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login')
    } else if (isAuthenticated && user) {
      fetchBooks(user.id)
    }
  }, [authLoading, isAuthenticated, user, navigate, fetchBooks])

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
            const chRows = (parsed.chapters || []).map((c, idx) => ({ book_id: bookData.id, title: c.title || `Chapter ${idx + 1}`, order_index: idx + 1 }))
            const { data: insCh, error: chErr } = await supabase.from('chapters').insert(chRows).select()
            if (chErr) throw chErr
            const allParas = [] as { chapter_id: string; content: string; order_index: number }[]
            for (let i = 0; i < (parsed.chapters || []).length; i++) {
              const c = parsed.chapters[i]
              const ch = insCh[i]
              const plist = (c.paragraphs || []).map((p, j) => ({ chapter_id: ch.id, content: p.content, order_index: j + 1 }))
              allParas.push(...plist)
            }
            if (allParas.length > 0) {
              const { error: pErr } = await supabase.from('paragraphs').insert(allParas)
              if (pErr) throw pErr
            }
            setCurrentBook(bookData)
            const chList: Chapter[] = insCh.map(c => ({ id: c.id, book_id: c.book_id, title: c.title, order_index: c.order_index, created_at: c.created_at }))
            setChapters(chList)
            const first = chList[0]
            setCurrentChapter(first)
            await fetchParagraphs(first.id)
            navigate(`/reader/${bookData.id}`)
            return
          } catch (e) {
            console.warn('Supabase上传失败，回退至本地存储模式', e)
          }
        }
      }
      
      const fallbackBook: BookType = {
        id: newId(),
        user_id: user.id,
        title: parsed.title || file.name.replace('.md', ''),
        author: parsed.author,
        cover_url: parsed.cover,
        metadata: { fileName: file.name },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      try {
        setCurrentBook(fallbackBook)
      } catch (e) {
        throw new Error(`设置当前图书失败: ${e instanceof Error ? e.message : String(e)}`)
      }
      
      // Create a Chapter in memory and map paragraphs
      const chapter: Chapter = {
        id: newId(),
        book_id: fallbackBook.id,
        title: (parsed.chapters[0]?.title) || 'Chapter 1',
        order_index: 1,
        created_at: new Date().toISOString(),
      }
      const chapterList: Chapter[] = (parsed.chapters || []).map((c, idx) => ({
        id: idx === 0 ? chapter.id : newId(),
        book_id: fallbackBook.id,
        title: c.title || `Chapter ${idx + 1}`,
        order_index: idx + 1,
        created_at: new Date().toISOString(),
      }))
      try {
        setChapters(chapterList)
      } catch (e) {
        throw new Error(`写入章节失败: ${e instanceof Error ? e.message : String(e)}`)
      }
      try {
        const rawCh = localStorage.getItem('demo_chapters')
        const mapCh = rawCh ? JSON.parse(rawCh) : {}
        mapCh[fallbackBook.id] = chapterList
        localStorage.setItem('demo_chapters', JSON.stringify(mapCh))
      } catch {}
      try {
        setCurrentChapter(chapter)
      } catch (e) {
        throw new Error(`设置当前章节失败: ${e instanceof Error ? e.message : String(e)}`)
      }
      
      const paras: Paragraph[] = ((parsed.chapters[0]?.paragraphs) || []).map((p, idx) => ({
        id: newId(),
        chapter_id: chapter.id,
        content: p.content,
        order_index: idx + 1,
        created_at: new Date().toISOString(),
      }))
      try {
        setParagraphs(paras)
      } catch (e) {
        throw new Error(`写入段落失败: ${e instanceof Error ? e.message : String(e)}`)
      }

      const allChapterParas: Record<string, Paragraph[]> = {};
      (parsed.chapters || []).forEach((c, idx) => {
        const chId = chapterList[idx].id
        const list: Paragraph[] = (c.paragraphs || []).map((p, i) => ({
          id: newId(),
          chapter_id: chId,
          content: p.content,
          order_index: i + 1,
          created_at: new Date().toISOString(),
        }))
        allChapterParas[chId] = list
      })
      try {
        const rawPara = localStorage.getItem('demo_paragraphs')
        const mapPara = rawPara ? JSON.parse(rawPara) : {}
        mapPara[fallbackBook.id] = allChapterParas
        localStorage.setItem('demo_paragraphs', JSON.stringify(mapPara))
      } catch {}

      // Persist book into local storage list for Home page
      try {
        const rawBooks = localStorage.getItem('demo_books')
        const list: BookType[] = rawBooks ? JSON.parse(rawBooks) : []
        const exists = list.find(b => b.id === fallbackBook.id)
        const updated = exists ? list.map(b => (b.id === fallbackBook.id ? fallbackBook : b)) : [fallbackBook, ...list]
        localStorage.setItem('demo_books', JSON.stringify(updated))
      } catch {}
      
      try {
        navigate(`/reader/${fallbackBook.id}`)
      } catch (e) {
        throw new Error(`跳转阅读页失败: ${e instanceof Error ? e.message : String(e)}`)
      }
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
    // Prefill chapters & paragraphs in demo mode if available
    if (!isSupabaseConfigured) {
      try {
        const rawCh = localStorage.getItem('demo_chapters')
        const rawPara = localStorage.getItem('demo_paragraphs')
        const mapCh = rawCh ? JSON.parse(rawCh) : {}
        const mapParaAll = rawPara ? JSON.parse(rawPara) : {}
        const chList = mapCh[book.id] || []
        if (chList.length > 0) {
          setChapters(chList)
          setCurrentChapter(chList[0])
          const chapterParaMap = mapParaAll[book.id] || {}
          const paraList = chapterParaMap[chList[0].id] || []
          if (paraList.length > 0) setParagraphs(paraList)
        }
      } catch {}
    }
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

  if (!isAuthenticated) {
    return null // Will redirect to login
  }

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
              <div key={book.id} className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow">
                <div className="aspect-w-3 aspect-h-4 bg-gray-200">
                  {book.cover_url ? (
                    <img
                      src={book.cover_url}
                      alt={book.title}
                      className="w-full h-64 object-cover"
                    />
                  ) : (
                    <div className="w-full h-64 flex items-center justify-center bg-gradient-to-br from-blue-100 to-indigo-100">
                      <Book className="h-16 w-16 text-blue-600" />
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <h3 className="font-semibold text-gray-900 mb-2 line-clamp-2">{book.title}</h3>
                  <p className="text-sm text-gray-600 mb-4">
                    {book.author || '未知作者'}
                  </p>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => handleStartReading(book)}
                      className="flex-1 inline-flex items-center justify-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
                    >
                      <Play className="h-4 w-4 mr-1" />
                      开始阅读
                    </button>
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
    </div>
  )
}
