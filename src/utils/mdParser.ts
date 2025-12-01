export interface MDParsedBook {
  title: string
  author?: string
  chapters: { title: string; paragraphs: { content: string; orderIndex: number }[] }[]
}

function normalizeText(s: string) {
  return s.replace(/[\r\t]/g, ' ').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim()
}

function splitParagraphsBlock(text: string) {
  const blocks = text
    .split(/\n\n+/)
    .map(t => t.trim())
    .filter(t => t.length > 0)
  const paras: { content: string; orderIndex: number }[] = []
  let idx = 0
  for (const b of blocks) {
    const cleaned = normalizeText(b)
    if (!cleaned) continue
    paras.push({ content: cleaned, orderIndex: idx++ })
  }
  if (paras.length > 0) return paras
  const sentences = text
    .split(/(?<=[。！？.!?])\s+/)
    .map(t => t.trim())
    .filter(t => t.length > 0)
  return sentences.map((s, i) => ({ content: normalizeText(s), orderIndex: i }))
}

export async function parseMarkdownFile(file: File): Promise<MDParsedBook> {
  const raw = await file.text()
  return parseMarkdown(raw, file.name.replace(/\.md$/i, ''))
}

export function parseMarkdown(raw: string, fallbackTitle: string = '未命名图书'): MDParsedBook {
  let title = fallbackTitle
  let author: string | undefined
  let body = raw
  const fmMatch = raw.match(/^---[\s\S]*?---\n?/)
  if (fmMatch) {
    const fm = fmMatch[0]
    body = raw.slice(fm.length)
    const tMatch = fm.match(/\btitle:\s*(.+)/i)
    const aMatch = fm.match(/\bauthor:\s*(.+)/i)
    if (tMatch) title = tMatch[1].trim()
    if (aMatch) author = aMatch[1].trim()
  }

  const lines = body.split(/\n/)
  const chapters: { title: string; content: string[] }[] = []
  let current: { title: string; content: string[] } | null = null
  for (const line of lines) {
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      if (current) chapters.push(current)
      current = { title: normalizeText(h[2]), content: [] }
    } else {
      if (!current) current = { title: '正文', content: [] }
      current.content.push(line)
    }
  }
  if (current) chapters.push(current)

  const chapterOut = chapters.map((ch, ci) => {
    const text = ch.content.join('\n')
    const paras = splitParagraphsBlock(text)
    return { title: ch.title || `Chapter ${ci + 1}`, paragraphs: paras }
  }).filter(ch => ch.paragraphs.length > 0)

  if (chapterOut.length === 0) {
    const paras = splitParagraphsBlock(body)
    chapterOut.push({ title: '正文', paragraphs: paras })
  }

  return { title: title || fallbackTitle, author, chapters: chapterOut }
}

