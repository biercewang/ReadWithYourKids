import zipfile
import os
from bs4 import BeautifulSoup
import sys
import tempfile
import shutil
import xml.etree.ElementTree as ET
import re
from urllib.parse import unquote
def _short_title(t):
    t = re.sub(r"\s+", " ", t or "").strip()
    if not t:
        return t
    if re.fullmatch(r"[A-Za-z0-9_\-]{10,}", t):
        t = t[:10]
    parts = t.split(" ")
    t = " ".join(parts[:12])
    if len(t) > 80:
        t = t[:80].rstrip()
    return t

def _resolve_href_to_path(href, base_dir):
    href = unquote(href or "")
    if "#" in href:
        f, frag = href.split("#", 1)
    else:
        f, frag = href, None
    p = os.path.normpath(os.path.join(base_dir, f))
    return p, frag

def _parse_nav_xhtml(nav_path):
    entries = []
    base_dir = os.path.dirname(nav_path)
    with open(nav_path, "r", encoding="utf-8") as f:
        soup = BeautifulSoup(f, "html.parser")
    nav = soup.find("nav", attrs={"epub:type": "toc"}) or soup.find("nav", attrs={"role": "doc-toc"}) or soup.find("nav", id="toc") or soup.find("nav")
    if not nav:
        return entries
    container = nav.find("ol") or nav
    def walk(node):
        for li in node.find_all("li", recursive=False):
            a = li.find("a", href=True)
            if a:
                title = re.sub(r"\s+", " ", a.get_text(separator=" ", strip=True))
                href = a["href"]
                p, frag = _resolve_href_to_path(href, base_dir)
                entries.append((p, frag, title))
            child_ol = li.find("ol", recursive=False)
            if child_ol:
                walk(child_ol)
    walk(container)
    return entries

def _parse_ncx(ncx_path):
    entries = []
    base_dir = os.path.dirname(ncx_path)
    try:
        tree = ET.parse(ncx_path)
        r = tree.getroot()
        nav_map = None
        for el in r.iter():
            if el.tag.endswith("navMap"):
                nav_map = el
                break
        if not nav_map:
            return entries
        def collect(np):
            title = None
            src = None
            for ch in list(np):
                if ch.tag.endswith("navLabel"):
                    for t in ch.iter():
                        if t.tag.endswith("text") and t.text:
                            title = t.text.strip()
                            break
                elif ch.tag.endswith("content"):
                    src = ch.attrib.get("src")
            if src:
                p, frag = _resolve_href_to_path(src, base_dir)
                entries.append((p, frag, title or ""))
            for ch in list(np):
                if ch.tag.endswith("navPoint"):
                    collect(ch)
        for np in list(nav_map):
            if np.tag.endswith("navPoint"):
                collect(np)
    except Exception:
        return entries
    return entries

def _get_toc_entries_from_opf(opf_path):
    entries = []
    try:
        tree = ET.parse(opf_path)
        r = tree.getroot()
        opf_dir = os.path.dirname(opf_path)
        nav_href = None
        ncx_href = None
        for el in r.iter():
            if el.tag.endswith("item"):
                href = el.attrib.get("href")
                media_type = el.attrib.get("media-type", "")
                props = el.attrib.get("properties", "")
                if href and "nav" in props and not nav_href:
                    nav_href = href
                if href and media_type == "application/x-dtbncx+xml" and not ncx_href:
                    ncx_href = href
        if nav_href:
            nav_path = os.path.join(opf_dir, nav_href)
            if os.path.exists(nav_path):
                entries = _parse_nav_xhtml(nav_path)
        elif ncx_href:
            ncx_path = os.path.join(opf_dir, ncx_href)
            if os.path.exists(ncx_path):
                entries = _parse_ncx(ncx_path)
    except Exception:
        entries = []
    return [(p, frag, title) for (p, frag, title) in entries if p and p.lower().endswith((".xhtml", ".html")) and os.path.exists(p)]

def _segment_file_by_toc(file_path, points):
    with open(file_path, "r", encoding="utf-8") as f:
        raw = f.read()
    positions = []
    for gid, frag, title in points:
        pos = None
        if frag:
            pats = [
                rf'id\s*=\s*"{re.escape(frag)}"',
                rf"id\s*=\s*'{re.escape(frag)}'",
                rf'name\s*=\s*"{re.escape(frag)}"',
                rf"name\s*=\s*'{re.escape(frag)}'",
                rf'xml:id\s*=\s*"{re.escape(frag)}"',
                rf"xml:id\s*=\s*'{re.escape(frag)}'",
            ]
            for pat in pats:
                m = re.search(pat, raw)
                if m:
                    s = m.start()
                    tag_open = raw.rfind("<", 0, s)
                    pos = tag_open if tag_open != -1 else s
                    break
        if pos is None:
            pos = 0
        positions.append((gid, title, frag, pos))
    positions.sort(key=lambda x: x[3])
    segments = []
    for i, (gid, title, frag, start_pos) in enumerate(positions):
        end_pos = positions[i+1][3] if i+1 < len(positions) else len(raw)
        segment_html = raw[start_pos:end_pos]
        seg_soup = BeautifulSoup(segment_html, "html.parser")
        seg_text = seg_soup.get_text(separator="\n", strip=True)
        lines = [l.strip() for l in seg_text.splitlines() if l.strip()]
        segments.append((gid, title, lines))
    return segments

def convert_epub_to_markdown(epub_file_path, base_output_folder):
    """
    从EPUB文件中提取内容并保存为Markdown文件。
    每个章节一个MD文件，以及一个包含所有内容的完整MD文件。
    文件将保存在 base_output_folder 下的一个以书名命名的子目录中。

    参数:
        epub_file_path (str): EPUB文件的路径。
        base_output_folder (str): 保存Markdown文件的基础目录 (例如: '~/Desktop')。

    返回:
        tuple: (包含生成的MD文件路径的列表, 书籍输出文件夹的路径) 或 ([], "") 如果失败。
    """
    markdown_files = []
    complete_text_content = ""
    book_title = os.path.splitext(os.path.basename(epub_file_path))[0]

    # 创建一个临时目录来解压EPUB
    temp_extract_path = tempfile.mkdtemp()

    try:
        with zipfile.ZipFile(epub_file_path, 'r') as epub_zip:
            epub_zip.extractall(temp_extract_path)
            meta_title = None
            meta_authors = []
            meta_publisher = None
            opf_path = None
            for root_dir, _, files in os.walk(temp_extract_path):
                for file in files:
                    if file.endswith('.opf'):
                        opf_path = os.path.join(root_dir, file)
                        try:
                            tree = ET.parse(opf_path)
                            r = tree.getroot()
                            for el in r.iter():
                                if el.tag.endswith('title') and el.text:
                                    meta_title = el.text.strip()
                                elif el.tag.endswith('creator') and el.text:
                                    meta_authors.append(el.text.strip())
                                elif el.tag.endswith('publisher') and el.text:
                                    meta_publisher = el.text.strip()
                        except Exception:
                            pass
                        break
                if opf_path:
                    break
            if meta_title:
                book_title = meta_title
            safe_book_title = "".join(c if c.isalnum() or c in (' ', '_', '-') else '_' for c in book_title).rstrip()
            if not safe_book_title:
                safe_book_title = os.path.splitext(os.path.basename(epub_file_path))[0]
            final_output_dir = os.path.join(base_output_folder, safe_book_title)
            os.makedirs(final_output_dir, exist_ok=True)

            spine_files = []
            if opf_path:
                try:
                    tree = ET.parse(opf_path)
                    r = tree.getroot()
                    id_to_href = {}
                    for el in r.iter():
                        if el.tag.endswith('item'):
                            iid = el.attrib.get('id')
                            href = el.attrib.get('href')
                            if iid and href:
                                id_to_href[iid] = href
                    order_ids = []
                    for el in r.iter():
                        if el.tag.endswith('itemref'):
                            idref = el.attrib.get('idref')
                            if idref:
                                order_ids.append(idref)
                    opf_dir = os.path.dirname(opf_path)
                    for iid in order_ids:
                        href = id_to_href.get(iid)
                        if href:
                            p = os.path.join(opf_dir, href)
                            if os.path.exists(p) and p.lower().endswith(('.xhtml', '.html')):
                                spine_files.append(p)
                except Exception:
                    pass
            content_files = spine_files
            if not content_files:
                tmp = []
                for root, _, files in os.walk(temp_extract_path):
                    for file in files:
                        if file.endswith(('.xhtml', '.html')):
                            tmp.append(os.path.join(root, file))
                tmp.sort()
                content_files = tmp

            header_block = []
            header_block.append('---')
            header_block.append(f"title: {book_title}")
            if meta_authors:
                header_block.append(f"author: {', '.join(meta_authors)}")
            if meta_publisher:
                header_block.append(f"publisher: {meta_publisher}")
            header_block.append('---')
            header_block.append('')
            complete_text_content += "\n".join(header_block)

            chapter_data = []
            toc_entries = []
            if opf_path:
                try:
                    toc_entries = _get_toc_entries_from_opf(opf_path)
                except Exception:
                    toc_entries = []
            if toc_entries:
                gid = 1
                groups = {}
                order_files = []
                for p, frag, title in toc_entries:
                    if os.path.exists(p) and p.lower().endswith(('.xhtml', '.html')):
                        if p not in groups:
                            groups[p] = []
                            order_files.append(p)
                        groups[p].append((gid, frag, title))
                        gid += 1
                for fp in order_files:
                    segs = _segment_file_by_toc(fp, groups.get(fp, []))
                    for gid2, title2, lines2 in segs:
                        chapter_data.append((gid2, fp, title2, lines2))
            else:
                for idx, item_path in enumerate(content_files, 1):
                    with open(item_path, 'r', encoding='utf-8') as f:
                        soup = BeautifulSoup(f, 'html.parser')
                        text_content = soup.get_text(separator='\n', strip=True)
                    base_name = os.path.splitext(os.path.basename(item_path))[0]
                    book_title_lower = book_title.strip().lower()
                    headings = soup.find_all(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
                    cand = []
                    for h in headings:
                        t = h.get_text(separator=' ', strip=True)
                        if t:
                            t = re.sub(r"\s+", " ", t).strip()
                            cand.append(t)
                    cand = [t for t in cand if t.lower() != book_title_lower and t.lower() not in ("contents", "table of contents")]
                    auto_title = None
                    if cand:
                        t0 = cand[0]
                        if re.fullmatch(r"\d{1,3}", t0) or re.fullmatch(r"[IVXLCDM]+", t0):
                            if len(cand) >= 2 and len(cand[1]) > 2:
                                auto_title = f"{t0} {cand[1]}"
                            else:
                                auto_title = t0
                        else:
                            auto_title = t0
                    if not auto_title and soup.title and soup.title.string:
                        t = re.sub(r"\s+", " ", soup.title.string).strip()
                        if t and t.lower() != book_title_lower:
                            auto_title = t
                    if not auto_title:
                        auto_title = base_name
                    lines = [l.strip() for l in text_content.splitlines() if l.strip()]
                    chapter_data.append((idx, item_path, auto_title, lines))

            title_overrides = {}
            if not toc_entries:
                while True:
                    print("预览章节文件名:")
                    for idx, _, auto_title, lines in chapter_data:
                        t = title_overrides.get(idx, auto_title)
                        t = _short_title(t)
                        print(f"- {idx:03d} {t} ({len(lines)}行)")
                    print("是否使用上述自动选择？(y/n，回车默认为 y)")
                    use_auto = True
                    try:
                        ans = input().strip().lower()
                        if ans == 'n':
                            use_auto = False
                    except Exception:
                        use_auto = True
                    if use_auto:
                        break
                    print("请输入要调整标题的章节序号，例如 1 或 001：")
                    override_idx = None
                    try:
                        s = input().strip()
                        if s:
                            override_idx = int(s)
                    except Exception:
                        override_idx = None
                    if override_idx is None:
                        continue
                    found = False
                    for idx, _, auto_title, lines in chapter_data:
                        if idx == override_idx:
                            found = True
                            print("该章节前20行预览：")
                            preview_lines = lines[:20]
                            for i, l in enumerate(preview_lines, 1):
                                print(f"{i:02d} {l}")
                            print("请输入标题行范围，例如 '1-2' 或 '7'：")
                            print("也可以输入 'b' 返回重新选择章节序号")
                            override_title_text = None
                            try:
                                rng = input().strip()
                                if rng.lower() in ('b', 'back'):
                                    override_title_text = None
                                    break
                                if '-' in rng:
                                    a, b = rng.split('-', 1)
                                    a = int(a.strip())
                                    b = int(b.strip())
                                    if 1 <= a <= len(lines) and 1 <= b <= len(lines) and a <= b:
                                        sel = [lines[i-1] for i in range(a, b+1)]
                                        override_title_text = re.sub(r"\s+", " ", " ".join(sel)).strip()
                                elif rng.isdigit():
                                    k = int(rng)
                                    if 1 <= k <= len(lines):
                                        override_title_text = lines[k-1].strip()
                            except Exception:
                                override_title_text = None
                            if override_title_text:
                                if re.fullmatch(r"\d{1,3}", override_title_text) or re.fullmatch(r"[IVXLCDM]+", override_title_text):
                                    end_line = None
                                    if '-' in rng:
                                        try:
                                            end_line = int(rng.split('-', 1)[1].strip())
                                        except Exception:
                                            end_line = None
                                    else:
                                        try:
                                            end_line = int(rng)
                                        except Exception:
                                            end_line = None
                                    if end_line and end_line < len(lines):
                                        override_title_text = f"{override_title_text} {lines[end_line].strip()}"
                                title_overrides[idx] = override_title_text
                            break
                    if not found:
                        continue

            for idx, item_path, auto_title, lines in chapter_data:
                title_text = _short_title(title_overrides.get(idx, auto_title))
                safe_chapter_title = "".join(c if c.isalnum() or c in (' ', '_', '-') else '_' for c in title_text).rstrip()
                if len(safe_chapter_title) > 80:
                    safe_chapter_title = safe_chapter_title[:80].rstrip()
                if not safe_chapter_title:
                    safe_chapter_title = f"chapter_{len(markdown_files) + 1}"
                file_line_count = 1 + len(lines)
                md_file_name = f"{idx:03d}-{safe_chapter_title}_[{file_line_count}].md"
                md_file_path = os.path.join(final_output_dir, md_file_name)
                if not os.path.isdir(final_output_dir):
                    os.makedirs(final_output_dir, exist_ok=True)
                with open(md_file_path, 'w', encoding='utf-8') as md_file:
                    md_file.write(f"# {title_text} [{file_line_count}]\n\n")
                    md_file.write("\n".join(lines))
                markdown_files.append(md_file_path)
                complete_text_content += f"# {title_text} [{file_line_count}]\n\n{"\n".join(lines)}\n\n---\n\n"

        # 保存包含所有内容的完整Markdown文件
        # 使用 "_full" 后缀以避免与可能的章节文件名冲突
        complete_md_file_name = f"{safe_book_title}_full.md"
        complete_md_file_path = os.path.join(final_output_dir, complete_md_file_name)
        if not os.path.isdir(final_output_dir):
            os.makedirs(final_output_dir, exist_ok=True)
        with open(complete_md_file_path, 'w', encoding='utf-8') as complete_md_file:
            complete_md_file.write(complete_text_content)
        
        markdown_files.append(complete_md_file_path)
        
        return markdown_files, final_output_dir

    except Exception as e:
        print(f"处理EPUB '{epub_file_path}' 时出错: {e}")
        # 打印更详细的错误信息，有助于调试
        import traceback
        traceback.print_exc()
        return [], ""
    finally:
        # 清理临时目录
        if os.path.exists(temp_extract_path):
            shutil.rmtree(temp_extract_path)

# 主程序执行部分
if __name__ == "__main__":
    epub_files_to_process = []
    if len(sys.argv) > 1:
        for arg in sys.argv[1:]:
            if isinstance(arg, str) and arg.lower().endswith('.epub'):
                epub_files_to_process.append(arg)
        if not epub_files_to_process:
            print("错误: 未提供有效的EPUB文件路径。")
            sys.exit(1)
    else:
        print("将弹出原生macOS对话框进行多选，仅显示EPUB。")
        import subprocess
        applescript_epub = "\n".join([
            'set fileList to choose file of type {"org.idpf.epub-container"} with multiple selections allowed with prompt "请选择EPUB文件"',
            'set posixPaths to {}',
            'repeat with f in fileList',
            '    set end of posixPaths to POSIX path of f',
            'end repeat',
            "set AppleScript's text item delimiters to \"\\n\"",
            'return posixPaths as string'
        ])
        applescript_any = "\n".join([
            'set fileList to choose file with multiple selections allowed with prompt "请选择EPUB文件"',
            'set posixPaths to {}',
            'repeat with f in fileList',
            '    set end of posixPaths to POSIX path of f',
            'end repeat',
            "set AppleScript's text item delimiters to \"\\n\"",
            'return posixPaths as string'
        ])
        selected_paths = []
        proc = subprocess.run(["osascript", "-e", applescript_epub], capture_output=True, text=True)
        if proc.returncode == 0 and proc.stdout.strip():
            for p in [s.strip() for s in proc.stdout.strip().split("\n")]:
                if p.lower().endswith('.epub'):
                    selected_paths.append(p)
        if not selected_paths:
            proc2 = subprocess.run(["osascript", "-e", applescript_any], capture_output=True, text=True)
            if proc2.returncode == 0 and proc2.stdout.strip():
                for p in [s.strip() for s in proc2.stdout.strip().split("\n")]:
                    if p.lower().endswith('.epub'):
                        selected_paths.append(p)
        if not selected_paths:
            print("未选择EPUB文件或选择无效。请输入一个或多个EPUB文件路径（用空格或换行分隔），或按 Ctrl+C 取消：")
            entered_paths = []
            try:
                while True:
                    line = input().strip()
                    if not line:
                        break
                    for part in line.split():
                        p = part.strip().strip("'\"")
                        if p.lower().endswith('.epub'):
                            entered_paths.append(p)
            except KeyboardInterrupt:
                print("\n已取消。")
                sys.exit(0)
            if not entered_paths:
                print("未提供有效的EPUB文件路径。")
                sys.exit(1)
            epub_files_to_process = entered_paths
        else:
            epub_files_to_process = selected_paths
            print(f"已选择 {len(selected_paths)} 个EPUB文件。")


    epub_files_to_process = [p for p in epub_files_to_process if p and os.path.exists(p) and p.lower().endswith('.epub')]
    if not epub_files_to_process:
        print("错误: 所选文件无效、不存在或不是EPUB。")
        sys.exit(1)
    
    # Markdown文件将保存在用户桌面上的一个子目录中
    desktop_path = os.path.join(os.path.expanduser("~"), "Desktop")
    
    for epub_path in epub_files_to_process:
        print(f"正在处理EPUB文件: {epub_path}...")
        generated_files_list, output_book_folder = convert_epub_to_markdown(epub_path, desktop_path)
        if generated_files_list:
            print("\n成功! Markdown文件已保存在以下目录中：")
            print(output_book_folder)
            print("\n生成的文件列表:")
            for f_path in generated_files_list:
                try:
                    with open(f_path, 'r', encoding='utf-8') as rf:
                        first_line = rf.readline().strip()
                    print(f"- {os.path.basename(f_path)} | {first_line}")
                except Exception:
                    print(f"- {os.path.basename(f_path)}")
        else:
            print("\n未能从EPUB生成Markdown文件。请检查上面的错误信息。")
