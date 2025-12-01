 

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

export class EPUBParser {
  private static async loadZip(arrayBuffer: ArrayBuffer): Promise<any> {
    const mod: any = await import('jszip')
    const def = mod?.default
    if (def && typeof def.loadAsync === 'function') {
      return def.loadAsync(arrayBuffer)
    }
    if (def && typeof def === 'function') {
      const inst = new def()
      if (typeof inst.loadAsync === 'function') {
        return inst.loadAsync(arrayBuffer)
      }
    }
    if (typeof mod?.loadAsync === 'function') {
      return mod.loadAsync(arrayBuffer)
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
      const basePath = fullPath.replace(/[^\/]+$/, '')
      const chapters: ParsedChapter[] = []
      for (let i = 0; i < spineIds.length; i++) {
        const id = spineIds[i]
        const href = manifest[id]
        if (!href) continue
        const xhtmlStr = await zip.file(basePath + href)?.async('string')
        if (!xhtmlStr) continue
        const paragraphs = EPUBParser.extractParagraphs(xhtmlStr)
        if ((paragraphs?.length || 0) === 0 || EPUBParser.isInvalidParagraphs(paragraphs)) continue
        chapters.push({
          title: `Chapter ${i + 1}`,
          content: paragraphs.map(p => p.content).join('\n\n'),
          paragraphs
        })
        if (chapters.length >= 50) break
      }
      if (chapters.length === 0) {
        const firstHref = manifest[spineIds[0]]
        const xhtmlStr = await zip.file(basePath + firstHref)?.async('string')
        const paragraphs = EPUBParser.extractParagraphs(xhtmlStr || '')
        if ((paragraphs?.length || 0) > 0 && !EPUBParser.isInvalidParagraphs(paragraphs)) {
          chapters.push({
            title: '正文',
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
}
