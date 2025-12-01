export interface User {
  id: string
  email: string
  name: string
  created_at: string
  updated_at: string
}

export interface Book {
  id: string
  user_id: string
  title: string
  author?: string
  cover_url?: string
  metadata: Record<string, any>
  created_at: string
  updated_at: string
}

export interface Chapter {
  id: string
  book_id: string
  title: string
  order_index: number
  created_at: string
}

export interface Paragraph {
  id: string
  chapter_id: string
  content: string
  order_index: number
  created_at: string
}

export interface Discussion {
  id: string
  paragraph_id: string
  user_id: string
  content: string
  user_type: 'parent' | 'child'
  created_at: string
}

export interface Translation {
  id: string
  paragraph_id: string
  translated_text: string
  language: string
  created_at: string
}

export interface Image {
  id: string
  paragraph_id: string
  image_url: string
  prompt: string
  created_at: string
}

export interface Vocabulary {
  id: string
  user_id: string
  word: string
  definition: string
  example: string
  created_at: string
}