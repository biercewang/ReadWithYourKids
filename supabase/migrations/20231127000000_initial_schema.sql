-- 用户表 (users)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);

-- 图书表 (books)
CREATE TABLE books (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    author VARCHAR(255),
    cover_url TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_books_user_id ON books(user_id);
CREATE INDEX idx_books_created_at ON books(created_at DESC);

-- 章节表 (chapters)
CREATE TABLE chapters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id UUID REFERENCES books(id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    order_index INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_chapters_book_id ON chapters(book_id);
CREATE INDEX idx_chapters_order ON chapters(book_id, order_index);

-- 段落表 (paragraphs)
CREATE TABLE paragraphs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chapter_id UUID REFERENCES chapters(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    order_index INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_paragraphs_chapter_id ON paragraphs(chapter_id);
CREATE INDEX idx_paragraphs_order ON paragraphs(chapter_id, order_index);

-- 讨论记录表 (discussions)
CREATE TABLE discussions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paragraph_id UUID REFERENCES paragraphs(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    user_type VARCHAR(20) CHECK (user_type IN ('parent', 'child')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_discussions_paragraph_id ON discussions(paragraph_id);
CREATE INDEX idx_discussions_user_id ON discussions(user_id);
CREATE INDEX idx_discussions_created_at ON discussions(created_at DESC);

-- 翻译表 (translations)
CREATE TABLE translations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paragraph_id UUID REFERENCES paragraphs(id) ON DELETE CASCADE,
    translated_text TEXT NOT NULL,
    language VARCHAR(10) DEFAULT 'zh',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_translations_paragraph_id ON translations(paragraph_id);

-- 图片表 (images)
CREATE TABLE images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paragraph_id UUID REFERENCES paragraphs(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    prompt TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_images_paragraph_id ON images(paragraph_id);

-- 生词表 (vocabulary)
CREATE TABLE vocabulary (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    word VARCHAR(100) NOT NULL,
    definition TEXT NOT NULL,
    example TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_vocabulary_user_id ON vocabulary(user_id);
CREATE INDEX idx_vocabulary_word ON vocabulary(word);

-- 权限设置
-- 授予匿名用户基本读取权限
GRANT SELECT ON books TO anon;
GRANT SELECT ON chapters TO anon;
GRANT SELECT ON paragraphs TO anon;

-- 授予认证用户完整权限
GRANT ALL PRIVILEGES ON users TO authenticated;
GRANT ALL PRIVILEGES ON books TO authenticated;
GRANT ALL PRIVILEGES ON chapters TO authenticated;
GRANT ALL PRIVILEGES ON paragraphs TO authenticated;
GRANT ALL PRIVILEGES ON discussions TO authenticated;
GRANT ALL PRIVILEGES ON translations TO authenticated;
GRANT ALL PRIVILEGES ON images TO authenticated;
GRANT ALL PRIVILEGES ON vocabulary TO authenticated;

-- 启用行级安全 (RLS)
ALTER TABLE books ENABLE ROW LEVEL SECURITY;
ALTER TABLE chapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE paragraphs ENABLE ROW LEVEL SECURITY;
ALTER TABLE discussions ENABLE ROW LEVEL SECURITY;
ALTER TABLE translations ENABLE ROW LEVEL SECURITY;
ALTER TABLE images ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocabulary ENABLE ROW LEVEL SECURITY;

-- 创建 RLS 策略
-- Books: 用户只能查看和修改自己的图书
CREATE POLICY "Users can view own books" ON books
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own books" ON books
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own books" ON books
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own books" ON books
    FOR DELETE USING (auth.uid() = user_id);

-- Chapters: 用户只能查看和修改自己图书的章节
CREATE POLICY "Users can view book chapters" ON chapters
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM books 
            WHERE books.id = chapters.book_id 
            AND books.user_id = auth.uid()
        )
    );

-- Paragraphs: 用户只能查看和修改自己图书的段落
CREATE POLICY "Users can view chapter paragraphs" ON paragraphs
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM chapters 
            JOIN books ON books.id = chapters.book_id 
            WHERE chapters.id = paragraphs.chapter_id 
            AND books.user_id = auth.uid()
        )
    );

-- Discussions: 用户只能查看和添加自己图书的讨论
CREATE POLICY "Users can view book discussions" ON discussions
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM paragraphs 
            JOIN chapters ON chapters.id = paragraphs.chapter_id 
            JOIN books ON books.id = chapters.book_id 
            WHERE paragraphs.id = discussions.paragraph_id 
            AND books.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert book discussions" ON discussions
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM paragraphs 
            JOIN chapters ON chapters.id = paragraphs.chapter_id 
            JOIN books ON books.id = chapters.book_id 
            WHERE paragraphs.id = discussions.paragraph_id 
            AND books.user_id = auth.uid()
        )
    );

-- Vocabulary: 用户只能查看和修改自己的生词
CREATE POLICY "Users can view own vocabulary" ON vocabulary
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own vocabulary" ON vocabulary
    FOR ALL USING (auth.uid() = user_id);