/** 探测 2.6 系列的输出格式参数：format / output_format / response_format 的取值面。 */
import { writeFile } from 'node:fs/promises'

const BASE = 'https://sub2api.e2mai3lzz.top'
const KEY = process.env.GPT_IMAGE_API_KEY ?? ''
if (KEY === '') throw new Error('先设置 GPT_IMAGE_API_KEY')
const PROMPT = 'a small brass gear on a dark gray concrete wall, macro, hard light'

const post = async (body, attempt = 0) => {
  try {
    const r = await fetch(`${BASE}/v1/images/generations`, {
      method: 'POST',
      headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const text = await r.text()
    let json; try { json = JSON.parse(text) } catch { json = undefined }
    return { status: r.status, json, text }
  } catch (error) {
    if (attempt < 3) { await new Promise((r) => setTimeout(r, 1500)); return post(body, attempt + 1) }
    return { status: 0, text: String(error?.cause?.code ?? error?.message) }
  }
}

const sniff = (bytes) => {
  if (bytes == null) return 'none'
  if (bytes[0] === 0x89) return 'png'
  if (bytes[0] === 0xff) return 'jpeg'
  if (bytes.subarray(0, 3).toString('latin1') === 'GIF') return 'gif'
  if (bytes.subarray(0, 4).toString('latin1') === 'RIFF') return 'webp'
  const head = bytes.subarray(0, 80).toString('utf8').trim()
  if (head.startsWith('<')) return `svg(${head.slice(0, 40)}…)`
  return `unknown(${bytes.subarray(0, 8).toString('hex')})`
}

const report = (row) => {
  if (row.status !== 200) {
    const message = row.json?.error?.message ?? row.text.slice(0, 160)
    return `HTTP ${row.status} · ${message}`
  }
  const item = row.json?.data?.[0] ?? {}
  if (item.url) return `HTTP 200 · url ${String(item.url).slice(0, 60)}`
  const bytes = item.b64_json ? Buffer.from(item.b64_json, 'base64') : undefined
  return `HTTP 200 · ${item.width}×${item.height} · ${sniff(bytes)} · ${bytes ? Math.round(bytes.length / 1024) : 0}KB`
}

const combos = [
  ['baseline', {}],
  ['format=bogus（验证是否校验）', { format: 'bogus' }],
  ['format=gif', { format: 'gif' }],
  ['format=svg', { format: 'svg' }],
  ['output_format=webp', { output_format: 'webp' }],
  ['output_format=gif', { output_format: 'gif' }],
  ['output_format=svg', { output_format: 'svg' }],
  ['response_format=url', { response_format: 'url' }],
]

for (const [label, extra] of combos) {
  const started = Date.now()
  const row = await post({ model: 'gpt-image-2.6-flare', prompt: PROMPT, size: '1024x1024', ...extra })
  console.log(`${label} → ${report(row)} (${((Date.now() - started) / 1000).toFixed(0)}s)`)
  if (row.status === 200 && extra.format === 'svg') {
    const bytes = row.json?.data?.[0]?.b64_json
    if (bytes) await writeFile('.probe/svg-check.svg', Buffer.from(bytes, 'base64'))
  }
}
