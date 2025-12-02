# Read With Your Kids

一个帮助家长和孩子一起阅读英文原版图书的 Web 应用。支持上传 EPUB、段落级互动、AI 翻译与插画、语音朗读，以及亲子讨论记录，提升亲子共读的效率与乐趣。

## 主要功能

- 书籍管理：展示已上传书籍列表，支持选择并开始阅读
- 章节与段落导航：页眉左侧显示书名，右侧选择章节与段落，并支持上一/下一段落跳转
- 段落合并与扩展：上下扩展按钮（可缩小时出现反向缩小），支持多段合并浏览
- 段落多选：在段落卡片右上角悬停出现复选框，选中后常显，可对多段批量执行操作
- 语音朗读：
  - 使用豆包 TTS 合成语音，播放箭头一键生成与播放，播放中点击可停止
  - 合成结果保存到最后一个被选段落，卡片中显示播放入口
  - 音色选单内置常用音色，并支持自定义音色 ID
- 翻译：
  - 执行按钮（双向箭头）按所选段落合并文本进行翻译
  - 设置按钮切换提供商与模型（OpenRouter/Gemini），结果展示在段落卡片中
- 绘图：
  - 执行按钮（画笔）按所选段落合并文本生成插画
  - 设置按钮编辑提示词模板与模型，插画展示在段落卡片中
- 亲子讨论：支持家长/孩子身份记录讨论，批量模式落在最后一个被选段落
- 工具条：右栏面板上方独立容器，四个互斥按钮（语音/翻译/图片/讨论），一次只显示一个面板

## 快速开始

```bash
npm install
npm run dev
```

浏览器打开 `http://localhost:5173/`，在首页上传 EPUB 文件并开始阅读。

## 环境配置

使用 `.env` 配置：

- 豆包 TTS（语音合成）：
  - `VITE_VOLC_TTS_APP_ID`
  - `VITE_VOLC_TTS_TOKEN`
  - 可选：`VITE_VOLC_TTS_VOICE_TYPE`、`VITE_VOLC_TTS_LANGUAGE`、`VITE_VOLC_TTS_CLUSTER`
- Supabase（可选，云端存储）：
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`

注意：`.env` 与 `.env.*` 已加入 `.gitignore`，不会被提交。请不要将任何密钥放入仓库。

快速配置步骤：

1. 复制示例文件并编辑：
   ```bash
   cp env.example .env
   ```
2. 将你的 AppID、Token 等填入 `.env` 中的占位符
3. 重启开发服务：`npm run dev`

## 语音合成 API

- 提供商：火山引擎豆包语音合成（大模型 TTS）
- 推荐接口（本地优先）：`https://openspeech.bytedance.com/api/v1/tts`
- 开发代理：本地通过 `vite` 代理使用路径 `/openspeech/api/v1/tts`
- 鉴权方式：请求头 `x-api-key: <你的密钥>`；请求体 `app` 仅需 `cluster`
- 必填字段：`app.cluster`、`user.uid`、`audio.voice_type`、`request.text`、`request.reqid`
- 注意事项：每次 `reqid` 唯一；文本按 UTF-8 超过 1024 字节会被截断；`language` 自动按文本判断（含中文为 `cn`）；HTTP 模式下 `operation` 为 `query`

请求体示例：

```json
{
  "app": {
    "cluster": "volcano_tts"
  },
  "user": { "uid": "uid-<uuid>" },
  "audio": {
    "voice_type": "BV700_streaming",
    "encoding": "mp3",
    "compression_rate": 1,
    "rate": 24000,
    "speed_ratio": 1.0,
    "volume_ratio": 1.0,
    "pitch_ratio": 1.0,
    "emotion": "neutral",
    "language": "cn"
  },
  "request": {
    "reqid": "<uuid>",
    "text": "要朗读的文本",
    "text_type": "plain",
    "operation": "query",
    "silence_duration": "125"
  }
}
```

示例 `curl`（V1 + x-api-key）：

```bash
curl -L -X POST 'https://openspeech.bytedance.com/api/v1/tts' \
  -H 'x-api-key: <你的密钥>' \
  -H 'Content-Type: application/json' \
  -d '{
    "app": { "cluster": "volcano_tts" },
    "user": { "uid": "豆包语音" },
    "audio": { "voice_type": "BV001", "encoding": "mp3", "speed_ratio": 1.0, "volume_ratio": 1.0, "pitch_ratio": 1.0 },
    "request": { "reqid": "<uuid>", "text": "示例文本", "operation": "query" }
  }'
```

响应体关键字段：`data` 为 Base64 编码音频数据。前端会转换为 `data:audio/<encoding>;base64,<data>` 并直接播放。

服务端代理（可选）：`POST /api/tts`。请求 JSON：`{ text: string, overrides?: { voice_type, language, rate, speed_ratio, volume_ratio, pitch_ratio, encoding } }`。代理从环境变量读取 `VOLC_TTS_APP_ID`、`VOLC_TTS_TOKEN`、`VOLC_TTS_CLUSTER` 并代发至豆包 TTS，返回 `{ audioUrl, provider: 'doubao' }`。

更多细节参考官方文档：`https://www.volcengine.com/docs/6561/1257584?lang=zh`

## 使用说明

1. 上传 EPUB 后在右栏选择章节与段落
2. 段落右上角悬停出现复选框，选中后可批量执行：
   - 语音：播放箭头生成并播放，播放中点击停止
   - 翻译：执行按钮进行合并翻译；设置切换提供商与模型
   - 绘图：执行按钮生成插画；设置编辑提示词与模型
3. 讨论面板可按家长/孩子身份添加记录；批量结果落在最后一个被选段落

## 开发脚本

- `npm run dev`：本地开发
- `npm run check`：TypeScript 构建检查
- `npm run lint`：ESLint 检查（可选）

## 安全与隐私

- 环境变量不会被提交；若曾经上传过 `.env`，请及时轮换密钥
- 建议使用最小权限的密钥进行本地开发

## 技术栈

- Vite + React + TypeScript
- TailwindCSS
- Supabase（可选）
- 豆包 TTS / OpenRouter / Gemini
