export type NoteRole = 'parent' | 'child'

export interface Note {
  id: string
  book_id: string
  chapter_id: string
  paragraph_id: string
  user_type: NoteRole
  content: string
  created_at: string
}

