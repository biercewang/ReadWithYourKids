 

export interface ParsedBook {
  title: string
  author: string
  cover?: string
  chapters: ParsedChapter[]
}

export interface ParsedChapter {
  title: string
  content: string
  paragraphs: ParsedParagraph[]
}

export interface ParsedParagraph {
  content: string
  orderIndex: number
}

type ZipLike = { file: (path: string) => { async: (type: string) => Promise<string> } | undefined }
type HasLoadAsync = { loadAsync: (ab: ArrayBuffer) => Promise<unknown> }

export class EPUBParser {
  private static async loadZip(arrayBuffer: ArrayBuffer): Promise<ZipLike> {
    const mod = await import('jszip')
    const def: unknown = (mod as unknown as { default?: unknown })?.default
    const maybeDef = def as Partial<HasLoadAsync> | (new () => HasLoadAsync)
    if (maybeDef && (maybeDef as Partial<HasLoadAsync>).loadAsync && typeof (maybeDef as Partial<HasLoadAsync>).loadAsync === 'function') {
      const zip = await ((maybeDef as HasLoadAsync).loadAsync(arrayBuffer))
      return zip as ZipLike
    }
    if (def && typeof def === 'function') {
      const Ctor = def as unknown as new () => HasLoadAsync
      const inst = new Ctor()
      if (typeof inst.loadAsync === 'function') {
        const zip = await inst.loadAsync(arrayBuffer)
        return zip as ZipLike
      }
    }
    const maybeLoad = (mod as Partial<HasLoadAsync>)?.loadAsync
    if (typeof maybeLoad === 'function') {
      const zip = await maybeLoad(arrayBuffer)
      return zip as ZipLike
    }
    throw new Error('JSZip加载失败：未找到可用的loadAsync')
  }
  static async parseBook(file: File): Promise<ParsedBook> {
    try {
      const arrayBuffer = await file.arrayBuffer()
      const zip = await EPUBParser.loadZip(arrayBuffer)
      const containerXml = await zip.file('META-INF/container.xml')?.async('string')
      if (!containerXml) throw new Error('container.xml缺失')
      const dom = new DOMParser().parseFromString(containerXml, 'application/xml')
      const rootfileEl = dom.querySelector('rootfile')
      const fullPath = rootfileEl?.getAttribute('full-path') || ''
      const opfStr = await zip.file(fullPath)?.async('string')
      if (!opfStr) throw new Error('OPF缺失')
      const opf = new DOMParser().parseFromString(opfStr, 'application/xml')
      const title = (opf.querySelector('metadata > title, metadata > dc\\:title')?.textContent || file.name.replace('.epub', '')).trim()
      const author = (opf.querySelector('metadata > creator, metadata > dc\\:creator')?.textContent || 'Unknown Author').trim()
      const manifest: Record<string,string> = {}
      opf.querySelectorAll('manifest > item').forEach((it) => {
        const id = it.getAttribute('id') || ''
        const href = it.getAttribute('href') || ''
        manifest[id] = href
      })
      const spineIds: string[] = []
      opf.querySelectorAll('spine > itemref').forEach((ir) => {
        const idref = ir.getAttribute('idref') || ''
        const linear = ir.getAttribute('linear') || 'yes'
        if (linear !== 'no') spineIds.push(idref)
      })
      const basePath = fullPath.replace(/[^/]+$/, '')
      const chapters: ParsedChapter[] = []

      const tocEntries = await EPUBParser.getTocEntriesFromOpf(zip, opf, basePath)
      if (tocEntries.length > 0) {
        const grouped: Record<string, { frag: string|null, title: string }[]> = {}
        for (const e of tocEntries) {
          const arr = grouped[e.path] || []
          arr.push({ frag: e.frag, title: e.title })
          grouped[e.path] = arr
        }
        let chapterIdx = 0
        for (const path of Object.keys(grouped)) {
          const segs = await EPUBParser.segmentFileByToc(zip, path, grouped[path])
          for (const seg of segs) {
            const paragraphs = EPUBParser.extractParagraphs(seg.html)
            if ((paragraphs?.length || 0) === 0 || EPUBParser.isInvalidParagraphs(paragraphs)) continue
            const finalTitle = seg.title && seg.title.trim().length > 0
              ? `(${chapterIdx + 1}) ${seg.title.trim()}`
              : `(${chapterIdx + 1})`
            chapters.push({
              title: finalTitle,
              content: paragraphs.map(p => p.content).join('\n\n'),
              paragraphs
            })
            chapterIdx++
            if (chapters.length >= 200) break
          }
          if (chapters.length >= 200) break
        }
      }

      if (chapters.length === 0) {
        for (let i = 0; i < spineIds.length; i++) {
          const id = spineIds[i]
          const href = manifest[id]
          if (!href) continue
          const xhtmlStr = await zip.file(basePath + href)?.async('string')
          if (!xhtmlStr) continue
          const paragraphs = EPUBParser.extractParagraphs(xhtmlStr)
          if ((paragraphs?.length || 0) === 0 || EPUBParser.isInvalidParagraphs(paragraphs)) continue
          chapters.push({
            title: `(${i + 1})`,
            content: paragraphs.map(p => p.content).join('\n\n'),
            paragraphs
          })
          if (chapters.length >= 50) break
        }
      }
      if (chapters.length === 0) {
        const firstHref = manifest[spineIds[0]]
        const xhtmlStr = await zip.file(basePath + firstHref)?.async('string')
        const paragraphs = EPUBParser.extractParagraphs(xhtmlStr || '')
        if ((paragraphs?.length || 0) > 0 && !EPUBParser.isInvalidParagraphs(paragraphs)) {
          chapters.push({
            title: '(1) 正文',
            content: paragraphs.map(p => p.content).join('\n\n'),
            paragraphs
          })
        }
      }
      return { title, author, cover: undefined, chapters }
    } catch (error) {
      console.error('EPUB parsing error:', error)
      throw new Error('Failed to parse EPUB file')
    }
  }
  
  // Removed epubjs-specific helpers to avoid runtime export issues
  
  private static extractParagraphs(docOrHtml: string | Element | Document): ParsedParagraph[] {
    let root: Element
    if (typeof docOrHtml === 'string') {
      const div = document.createElement('div')
      div.innerHTML = docOrHtml
      root = div
    } else if ((docOrHtml as Document).documentElement) {
      root = (docOrHtml as Document).documentElement as Element
    } else {
      root = docOrHtml as Element
    }
    // Remove scripts/styles
    root.querySelectorAll('script, style').forEach(el => el.remove())
    // Promote <br> to newline for textContent
    root.querySelectorAll('br').forEach(br => { br.replaceWith(document.createTextNode('\n')) })

    const ps = Array.from(root.querySelectorAll('p'))
      .map((p, idx) => ({
        content: (p.textContent || '').replace(/\s+/g, ' ').trim(),
        orderIndex: idx
      }))
      .filter(p => p.content.length > 0)
    if (ps.length > 0) return ps

    // If no <p>, try block-level tags
    const blocks = Array.from(root.querySelectorAll('div, section, article, li'))
      .map((el, idx) => ({
        content: (el.textContent || '').replace(/\s+/g, ' ').trim(),
        orderIndex: idx
      }))
      .filter(p => p.content.length > 0)
    if (blocks.length > 0) return blocks

    // Fallback: split text content
    const text = (root.textContent || '').replace(/\s+/g, ' ').trim()
    const segments = text
      .split(/\n\n|(?<=[。！？.!?])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 0)
    return segments.map((content, idx) => ({ content, orderIndex: idx }))
  }

  private static isInvalidParagraphs(paragraphs: ParsedParagraph[]): boolean {
    const joined = paragraphs.map(p => p.content).join(' ').toLowerCase()
    if (joined.includes('this page contains the following errors') || joined.includes('invalid element name')) return true
    const avgLen = paragraphs.reduce((acc, p) => acc + p.content.length, 0) / paragraphs.length
    return avgLen < 8
  }

  private static normPath(baseDir: string, href: string): string {
    const base = baseDir.endsWith('/') ? baseDir : baseDir + '/'
    const parts = (base + href).split('/').filter(Boolean)
    const stack: string[] = []
    for (const p of parts) {
      if (p === '.') continue
      if (p === '..') { stack.pop(); continue }
      stack.push(p)
    }
    return stack.join('/')
  }

  private static async getTocEntriesFromOpf(zip: ZipLike, opf: Document, basePath: string): Promise<{ path: string, frag: string|null, title: string }[]> {
    let navHref: string | null = null
    let ncxHref: string | null = null
    opf.querySelectorAll('manifest > item').forEach(it => {
      const href = it.getAttribute('href') || ''
      const mediaType = it.getAttribute('media-type') || ''
      const props = it.getAttribute('properties') || ''
      if (!navHref && props.includes('nav') && href) navHref = href
      if (!ncxHref && mediaType === 'application/x-dtbncx+xml' && href) ncxHref = href
    })
    const entries: { path: string, frag: string|null, title: string }[] = []
    if (navHref) {
      const navAbs = basePath + navHref
      const navDir = navAbs.replace(/[^/]+$/, '')
      const navStr = await zip.file(navAbs)?.async('string')
      if (navStr) {
        const doc = new DOMParser().parseFromString(navStr, 'text/html')
        const nav = doc.querySelector('nav[epub\\:type="toc"], nav[role="doc-toc"], nav#toc, nav')
        const container = (nav?.querySelector('ol')) || nav
        if (container) {
          container.querySelectorAll('li').forEach(li => {
            const a = li.querySelector('a[href]')
            if (a) {
              const href = a.getAttribute('href') || ''
              const text = (a.textContent || '').replace(/\s+/g, ' ').trim()
              let frag: string|null = null
              let fileRef = href
              if (href.includes('#')) { const sp = href.split('#'); fileRef = sp[0]; frag = sp[1] }
              const pAbs = EPUBParser.normPath(navDir, fileRef)
              entries.push({ path: pAbs, frag, title: text })
            }
          })
        }
      }
    } else if (ncxHref) {
      const ncxAbs = basePath + ncxHref
      const ncxStr = await zip.file(ncxAbs)?.async('string')
      if (ncxStr) {
        const doc = new DOMParser().parseFromString(ncxStr, 'application/xml')
        const navMap = doc.querySelector('navMap') || doc.querySelector('*:not(svg) > navMap')
        const opfDir = basePath
        if (navMap) {
          const collect = (np: Element) => {
            let text = ''
            let src = ''
            np.querySelectorAll(':scope > navLabel text').forEach(t => { if (t.textContent) text = (t.textContent || '').trim() })
            const content = np.querySelector(':scope > content')
            if (content) src = content.getAttribute('src') || ''
            if (src) {
              let frag: string|null = null
              let fileRef = src
              if (src.includes('#')) { const sp = src.split('#'); fileRef = sp[0]; frag = sp[1] }
              const pAbs = EPUBParser.normPath(opfDir, fileRef)
              entries.push({ path: pAbs, frag, title: text })
            }
            np.querySelectorAll(':scope > navPoint').forEach(child => collect(child))
          }
          navMap.querySelectorAll(':scope > navPoint').forEach(np => collect(np))
        }
      }
    }
    return entries.filter(e => e.path.toLowerCase().endsWith('.xhtml') || e.path.toLowerCase().endsWith('.html'))
  }

  private static async segmentFileByToc(zip: ZipLike, absPath: string, points: { frag: string|null, title: string }[]): Promise<{ title: string, html: string }[]> {
    const raw = await zip.file(absPath)?.async('string')
    if (!raw) return []
    type Pos = { title: string, frag: string|null, pos: number }
    const positions: Pos[] = []
    for (const pt of points) {
      let pos = -1
      if (pt.frag) {
        const pats = [
          new RegExp(`id\\s*=\\s*"${pt.frag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`),
          new RegExp(`id\\s*=\\s*'${pt.frag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`),
          new RegExp(`name\\s*=\\s*"${pt.frag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`),
          new RegExp(`name\\s*=\\s*'${pt.frag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`),
          new RegExp(`xml:id\\s*=\\s*"${pt.frag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`),
          new RegExp(`xml:id\\s*=\\s*'${pt.frag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`),
        ]
        for (const rg of pats) {
          const m = raw.match(rg)
          if (m && m.index !== undefined) {
            const s = m.index
            const tagOpen = raw.lastIndexOf('<', s)
            pos = tagOpen >= 0 ? tagOpen : s
            break
          }
        }
      }
      positions.push({ title: pt.title, frag: pt.frag, pos: pos >= 0 ? pos : 0 })
    }
    positions.sort((a,b) => a.pos - b.pos)
    const segments: { title: string, html: string }[] = []
    for (let i = 0; i < positions.length; i++) {
      const start = positions[i].pos
      const end = i+1 < positions.length ? positions[i+1].pos : raw.length
      const html = raw.slice(start, end)
      segments.push({ title: positions[i].title, html })
    }
    return segments
  }
}
