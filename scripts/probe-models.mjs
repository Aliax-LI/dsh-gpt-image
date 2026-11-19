/**
 * 能力探测：对账号 /v1/models 里的图片模型逐项试参数，记录真实接受度。
 * 用法：node scripts/probe-models.mjs
 */
import { writeFile } from 'node:fs/promises'

const BASE = 'https://sub2api.e2mai3lzz.top'
const KEY = process.env.GPT_IMAGE_API_KEY ?? ''
if (KEY === '') throw new Error('先设置 GPT_IMAGE_API_KEY')
const PROMPT = 'a single red apple on a plain white table, top light, minimal, no text'

const post = async (path, body, attempt = 0) => {
  try {
    const response = await fetch(`${BASE}/v1${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const text = await response.text()
    let json
    try { json = JSON.parse(text) } catch { json = undefined }
    return { status: response.status, json, text }
  } catch (error) {
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)))
      return post(path, body, attempt + 1)
    }
    return { status: 0, json: undefined, text: `连接失败：${error?.cause?.code ?? error?.message}` }
  }
}

const describe = (result) => {
  if (result.status !== 200) {
    const message = result.json?.error?.message ?? result.text.slice(0, 200)
    return `HTTP ${result.status} · ${message}`
  }
  const item = result.json?.data?.[0] ?? {}
  const bytes = item.b64_json ? Buffer.from(item.b64_json, 'base64') : undefined
  const magic = bytes ? bytes.subarray(0, 12) : undefined
  const kind = magic == null
    ? 'no-bytes'
    : magic[0] === 0x89 ? 'png'
      : magic[0] === 0xff ? 'jpeg'
        : magic.subarray(8, 12).toString('latin1') === 'WEBP' ? 'webp' : 'unknown'
  return `HTTP 200 · ${item.width}×${item.height} · ${kind} · ${bytes ? Math.round(bytes.length / 1024) : 0}KB`
}

const combos = [
  ['gpt-image-2.6-flare', { size: '1536x1024' }],
  ['gpt-image-2.6-flare', { quality: 'xhigh' }],
  ['gpt-image-2.6-flare', { format: 'webp' }],
  ['gpt-image-2.6-flare', { background: 'transparent' }],
  ['gpt-image-2.6-sunburst', { size: '1024x1536', quality: 'high' }],
  ['gpt-image-2.5-flare', { size: '1536x1024', quality: 'low' }],
  ['gpt-image-2.5-sunburst', { format: 'jpeg' }],
  ['gpt-image-2.5', { size: '1024x1536' }],
  ['gpt-image-2', { quality: 'xhigh' }],
  ['gpt-image-2', { quality: 'high' }],
  ['gpt-image-2', { background: 'transparent' }],
]

const rows = []
for (const [model, params] of combos) {
  const started = Date.now()
  const result = await post('/images/generations', { model, prompt: PROMPT, ...params })
  const row = { model, params, seconds: ((Date.now() - started) / 1000).toFixed(1), result: describe(result) }
  rows.push(row)
  console.log(`${model} ${JSON.stringify(params)} → ${row.result} (${row.seconds}s)`)
}

await writeFile(new URL('./evidence/capability.json', import.meta.url), JSON.stringify(rows, null, 2))
console.log(`\n${rows.length} 组已记录到 .probe/capability.json`)