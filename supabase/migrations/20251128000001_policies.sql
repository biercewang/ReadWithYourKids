-- Enable RLS and define owner-based policies for all tables

-- books
ALTER TABLE books ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS books_select_own ON books;
DROP POLICY IF EXISTS books_modify_own ON books;
CREATE POLICY books_select_own ON books
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY books_modify_own ON books
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- chapters
ALTER TABLE chapters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chapters_select_own ON chapters;
DROP POLICY IF EXISTS chapters_modify_own ON chapters;
CREATE POLICY chapters_select_own ON chapters
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM books b WHERE b.id = chapters.book_id AND b.user_id = auth.uid()
    )
  );
CREATE POLICY chapters_modify_own ON chapters
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM books b WHERE b.id = chapters.book_id AND b.user_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM books b WHERE b.id = chapters.book_id AND b.user_id = auth.uid()
    )
  );

-- paragraphs
ALTER TABLE paragraphs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS paragraphs_select_own ON paragraphs;
DROP POLICY IF EXISTS paragraphs_modify_own ON paragraphs;
CREATE POLICY paragraphs_select_own ON paragraphs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM chapters c JOIN books b ON b.id = c.book_id
      WHERE c.id = paragraphs.chapter_id AND b.user_id = auth.uid()
    )
  );
CREATE POLICY paragraphs_modify_own ON paragraphs
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM chapters c JOIN books b ON b.id = c.book_id
      WHERE c.id = paragraphs.chapter_id AND b.user_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM chapters c JOIN books b ON b.id = c.book_id
      WHERE c.id = paragraphs.chapter_id AND b.user_id = auth.uid()
    )
  );

-- discussions
ALTER TABLE discussions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS discussions_select_own ON discussions;
DROP POLICY IF EXISTS discussions_modify_own ON discussions;
CREATE POLICY discussions_select_own ON discussions
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM paragraphs p
      JOIN chapters c ON c.id = p.chapter_id
      JOIN books b ON b.id = c.book_id
      WHERE p.id = discussions.paragraph_id AND b.user_id = auth.uid()
    )
  );
CREATE POLICY discussions_modify_own ON discussions
  FOR ALL USING (
    EXISTS (
      SELECT 1
      FROM paragraphs p
      JOIN chapters c ON c.id = p.chapter_id
      JOIN books b ON b.id = c.book_id
      WHERE p.id = discussions.paragraph_id AND b.user_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1
      FROM paragraphs p
      JOIN chapters c ON c.id = p.chapter_id
      JOIN books b ON b.id = c.book_id
      WHERE p.id = discussions.paragraph_id AND b.user_id = auth.uid()
    )
  );

-- translations
ALTER TABLE translations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS translations_select_own ON translations;
DROP POLICY IF EXISTS translations_modify_own ON translations;
CREATE POLICY translations_select_own ON translations
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM paragraphs p
      JOIN chapters c ON c.id = p.chapter_id
      JOIN books b ON b.id = c.book_id
      WHERE p.id = translations.paragraph_id AND b.user_id = auth.uid()
    )
  );
CREATE POLICY translations_modify_own ON translations
  FOR ALL USING (
    EXISTS (
      SELECT 1
      FROM paragraphs p
      JOIN chapters c ON c.id = p.chapter_id
      JOIN books b ON b.id = c.book_id
      WHERE p.id = translations.paragraph_id AND b.user_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1
      FROM paragraphs p
      JOIN chapters c ON c.id = p.chapter_id
      JOIN books b ON b.id = c.book_id
      WHERE p.id = translations.paragraph_id AND b.user_id = auth.uid()
    )
  );

-- images
ALTER TABLE images ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS images_select_own ON images;
DROP POLICY IF EXISTS images_modify_own ON images;
CREATE POLICY images_select_own ON images
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM paragraphs p
      JOIN chapters c ON c.id = p.chapter_id
      JOIN books b ON b.id = c.book_id
      WHERE p.id = images.paragraph_id AND b.user_id = auth.uid()
    )
  );
CREATE POLICY images_modify_own ON images
  FOR ALL USING (
    EXISTS (
      SELECT 1
      FROM paragraphs p
      JOIN chapters c ON c.id = p.chapter_id
      JOIN books b ON b.id = c.book_id
      WHERE p.id = images.paragraph_id AND b.user_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1
      FROM paragraphs p
      JOIN chapters c ON c.id = p.chapter_id
      JOIN books b ON b.id = c.book_id
      WHERE p.id = images.paragraph_id AND b.user_id = auth.uid()
    )
  );

-- vocabulary
ALTER TABLE vocabulary ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vocabulary_select_own ON vocabulary;
DROP POLICY IF EXISTS vocabulary_modify_own ON vocabulary;
CREATE POLICY vocabulary_select_own ON vocabulary
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY vocabulary_modify_own ON vocabulary
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

