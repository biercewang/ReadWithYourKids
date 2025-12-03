-- 语音表 (audios)
CREATE TABLE IF NOT EXISTS audios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paragraph_id UUID REFERENCES paragraphs(id) ON DELETE CASCADE,
    audio_url TEXT NOT NULL,
    provider TEXT,
    voice_type TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audios_paragraph_id ON audios(paragraph_id);
CREATE INDEX IF NOT EXISTS idx_audios_created_at ON audios(created_at DESC);

GRANT ALL PRIVILEGES ON audios TO authenticated;

ALTER TABLE audios ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Users can view book audios" ON audios
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM paragraphs 
            JOIN chapters ON chapters.id = paragraphs.chapter_id 
            JOIN books ON books.id = chapters.book_id 
            WHERE paragraphs.id = audios.paragraph_id 
            AND books.user_id = auth.uid()
        )
    );

CREATE POLICY IF NOT EXISTS "Users can insert book audios" ON audios
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM paragraphs 
            JOIN chapters ON chapters.id = paragraphs.chapter_id 
            JOIN books ON books.id = chapters.book_id 
            WHERE paragraphs.id = audios.paragraph_id 
            AND books.user_id = auth.uid()
        )
    );

CREATE POLICY IF NOT EXISTS "Users can delete book audios" ON audios
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM paragraphs 
            JOIN chapters ON chapters.id = paragraphs.chapter_id 
            JOIN books ON books.id = chapters.book_id 
            WHERE paragraphs.id = audios.paragraph_id 
            AND books.user_id = auth.uid()
        )
    );

