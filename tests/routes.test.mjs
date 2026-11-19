/**
 * 设置页端点的离线测试：不启 DSH，直接把 registerRoutes 挂到假 webServer 上跑。
 *
 * `node tests/routes.test.mjs`        只测 GET/POST（不联网）
 * `node tests/routes.test.mjs --live` 额外跑一次真出图 + 4K 放大
 */
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { apply } from '../index.js'
import { readConfig } from '../lib/config.js'
import { registerRoutes } from '../lib/routes.js'

const LIVE = process.argv.includes('--live')
const rows = []
const check = (name, ok, detail = '') => {
  rows.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${detail}`}`)
}

const KEY = process.env.GPT_IMAGE_API_KEY ?? 'sk-local-test-key'
const CONFIG = {
  baseUrl: 'https://gateway.example',
  apiKey: KEY,
  defaultModel: 'gpt-image-2.6-flare',
  models: [],
  outputDir: 'route-test-output',
  timeoutMs: 240_000,
  autoFallback: true,
  upscaleEngine: 'auto',
  upscaleTargetLongEdge: 0,
  upscaleSharpen: 0.5,
  realesrganPath: '',
  sizeHintInPrompt: true,
}

// --- 假 webServer / 假 settings -------------------------------------------
const routes = new Map()
const webServer = {
  register: (definition) => {
    routes.set(definition.path, definition.handler)
    return () => routes.delete(definition.path)
  },
}

const writes = []
const settings = {
  describe: () => [{ ns: 'gpt-image', autoGenerate: false, schema: {}, value: {}, revision: 1, applies: 'live' }],
  update: async (ns, patch) => { writes.push({ ns, patch }) },
}

const dispose = registerRoutes(webServer, {
  config: CONFIG,
  entry: { options: { id: 'gpt-image' } },
  settings,
  editor: null,
})

/** 造一对最小的 req/res。 */
const callRoute = async (path, method, body) => {
  const handler = routes.get(path)
  if (handler == null) throw new Error(`没有注册路由 ${path}`)
  const request = {
    method,
    headers: body == null ? {} : { 'content-type': 'application/json' },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      if (body != null) yield Buffer.from(JSON.stringify(body))
    },
  }
  let status = 0
  let payload = ''
  const response = {
    writeHead: (code) => { status = code },
    end: (text) => { payload = text ?? '' },
  }
  await handler(request, response)
  return { status, body: payload === '' ? {} : JSON.parse(payload) }
}

check('注册了四个端点', routes.size === 4, [...routes.keys()].join(', '))

const got = await callRoute('/gpt-image/config', 'GET')
check('GET /config 正常', got.status === 200 && got.body.ok === true, `ns=${got.body.ns}`)
check('GET /config 带放大字段', ['upscaleEngine', 'upscaleTargetLongEdge', 'upscaleSharpen', 'realesrganPath'].every((key) => key in got.body.raw), Object.keys(got.body.raw ?? {}).join(','))
check('GET /config 不回明文密钥', got.body.raw.apiKey === '' && got.body.raw.apiKeyConfigured === true, String(got.body.raw.apiKeyConfigured))
check('GET /config 报告本机放大能力', Array.isArray(got.body.upscale?.engines), (got.body.upscale?.engines ?? []).join('/'))

const saved = await callRoute('/gpt-image/config', 'POST', {
  baseUrl: 'https://example.com',
  modelsText: 'gpt-image-2.6-flare, gpt-image-2.6-sunburst',
  upscaleEngine: 'ffmpeg',
  upscaleTargetLongEdge: 3840,
  upscaleSharpen: 0.6,
})
check('POST /config 走 settings.update', saved.status === 200 && writes.length === 1, JSON.stringify(writes[0]?.ns))
check('POST 解析模型清单', (writes[0]?.patch?.models ?? []).length === 2, (writes[0]?.patch?.models ?? []).join(','))
check('POST 带上放大设置', writes[0]?.patch?.upscaleTargetLongEdge === 3840 && writes[0]?.patch?.upscaleSharpen === 0.6)

const empty = await callRoute('/gpt-image/config', 'POST', {})
check('空 patch 被拒', empty.body.ok === false, empty.body.error ?? '')

const testOk = await callRoute('/gpt-image/test', 'POST', {
  baseUrl: 'http://127.0.0.1:9',
  apiKey: 'sk-unreachable-probe',
})
check('POST /test 返回可读错误', testOk.body.ok === false && /连接失败|ECONN|fetch/.test(testOk.body.error ?? ''), testOk.body.error ?? '')

// 没有 key 的配置：/test 必须直接拒绝，不能拿环境里的 key 去试
const savedKeyEnv = process.env.GPT_IMAGE_API_KEY
delete process.env.GPT_IMAGE_API_KEY
const bareRoutes = new Map()
registerRoutes({
  register: (definition) => { bareRoutes.set(definition.path, definition.handler); return () => {} },
}, { config: { ...CONFIG, apiKey: '' }, entry: { options: { id: 'gpt-image' } }, settings, editor: null })
let bareBody = ''
await bareRoutes.get('/gpt-image/test')(
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ baseUrl: 'https://example.com', apiKey: '' })) },
  },
  { writeHead: () => {}, end: (text) => { bareBody = text ?? '' } },
)
const bare = bareBody === '' ? {} : JSON.parse(bareBody)
check('/test 无可用 key 时拒绝', bare.ok === false && /API Key/.test(bare.error ?? ''), bare.error ?? '')
if (savedKeyEnv !== undefined) process.env.GPT_IMAGE_API_KEY = savedKeyEnv

dispose()
await new Promise((resolve) => setTimeout(resolve, 100))
registerRoutes(webServer, { config: CONFIG, entry: { options: { id: 'gpt-image' } }, settings, editor: null })

let iconType = ''
let iconBody = ''
await routes.get('/gpt-image/icon.svg')(
  { method: 'GET', headers: {}, socket: { remoteAddress: '127.0.0.1' } },
  {
    writeHead: (code, headers) => { iconType = `${code} ${headers?.['content-type'] ?? ''}` },
    end: (bytes) => { iconBody = bytes == null ? '' : Buffer.from(bytes).toString('utf8') },
  },
)
check('图标端点返回 SVG', iconType.startsWith('200 image/svg+xml'), iconType)
check('图标内容就是插件图标', iconBody.includes('sub2api') || iconBody.includes('s2a-bg'), `${iconBody.length} 字符`)

dispose()
check('清理后路由注销', routes.size === 0)

// --- 配置读取 --------------------------------------------------------------
const plain = readConfig(CONFIG)
check('readConfig 读普通对象', plain.upscaleEngine === 'auto' && plain.upscaleTargetLongEdge === 0)
const refLike = readConfig({ ...CONFIG, baseUrl: { get: () => 'https://ref.example' }, apiKey: { get: () => '' } })
check('readConfig 读 volatile 引用', refLike.baseUrl === 'https://ref.example', refLike.baseUrl)
check('空密钥不会被默认值顶掉', refLike.apiKey === '')

if (!LIVE) {
  const failed = rows.filter((row) => !row.ok)
  console.log(`\n${rows.length - failed.length}/${rows.length} 通过`)
  if (failed.length > 0) process.exitCode = 1
  process.exit(process.exitCode ?? 0)
}

// --- 真机：出图 + 4K 放大 ---------------------------------------------------
const outDir = join(process.cwd(), 'route-test-output')
await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

const tools = new Map()
const ctx = {
  tools: { register: (definition) => { tools.set(definition.name, definition); return () => {} } },
  effect: (fn) => fn(),
  get: () => undefined,
  fiber: { entry: { id: 'gpt-image', options: { id: 'gpt-image' } } },
}
await apply(ctx, { ...CONFIG, outputDir: 'route-test-output' })
const exec = { signal: new AbortController().signal }

const generated = await tools.get('gpt_image_generate').execute({
  prompt: 'one brass gear on dark concrete, macro, hard light',
  size: '1536x1024',
  target_long_edge: 3840,
  upsampleNote: undefined,
  out: 'gear-full.png',
  timeoutMs: 300_000,
}, exec)
const file = generated.files[0]
check('出图 + 自动放大到 4K', file?.width === 3840 && file?.height === 2560, `${file?.width}×${file?.height}`)
check('放大留了来源记录', file?.upscaledFrom?.width === 1536, JSON.stringify(file?.upscaledFrom ?? {}))
check('放大说明写进 notes', generated.notes.some((note) => note.includes('→')), generated.notes.join(' / ').slice(0, 120))

const upscaled = await tools.get('gpt_image_upscale').execute({
  path: file.path,
  target_long_edge: 5120,
  engine: 'pillow',
  sharpen: 0,
}, exec)
check('独立放大工具可用', upscaled.width === 5120, `${upscaled.width}×${upscaled.height} · ${upscaled.engine}`)

const tooBig = await tools.get('gpt_image_upscale').execute({ path: file.path, factor: 9 }, exec)
  .then(() => ({ error: '' }))
  .catch((error) => ({ error: String(error?.message ?? error) }))
check('倍数超限被拒', /超过上限/.test(tooBig.error), tooBig.error)

const svg = await tools.get('gpt_image_upscale').execute({ path: 'gpt-image-output/gear.svg', target_long_edge: 4000 }, exec)
check('SVG 跳过并说明', svg.skipped === true, svg.summary?.split('\n')[0] ?? '')

const failed = rows.filter((row) => !row.ok)
console.log(`\n${rows.length - failed.length}/${rows.length} 通过`)
if (failed.length > 0) process.exitCode = 1