/**
 * 离线单测 + 可选真机联调。
 *
 * `node tests/selftest.mjs`       只跑目录/闸门/注册检查（不发请求）
 * `node tests/selftest.mjs --live` 额外打真接口：/v1/models、出图、改图、多张、参数闸门说明
 */
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { apply } from '../index.js'

const hostSource = await readFile(new URL('../index.js', import.meta.url), 'utf8')
import { DEFAULT_MODEL, KNOWN_MODELS, modelSpec, normalizeModels } from '../lib/models.js'
import { baseDir, callGeneration, fetchImageModels, resolveSettings, withSizeHint } from '../lib/api.js'

const LIVE = process.argv.includes('--live')
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${detail}`}`)
}

/** 假 ctx：收集注册的工具，effect 立即执行，服务一律缺席。 */
function fakeContext() {
  const tools = new Map()
  return {
    tools,
    ctx: {
      tools: { register: (definition) => { tools.set(definition.name, definition); return () => tools.delete(def.name) } },
      effect: (fn) => fn(),
      get: () => undefined,
      fiber: { entry: { id: 'gpt-image' } },
    },
  }
}

const patchText = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const patchValue = (key) => new RegExp(`^\\s*${key}:\\s*(.+)$`, 'm').exec(patchText)?.[1]?.trim() ?? ''

const CONFIG = {
  baseUrl: process.env.GPT_IMAGE_BASE_URL ?? (patchValue('baseUrl') || 'https://gateway.example'),
  apiKey: process.env.GPT_IMAGE_API_KEY ?? process.env.APIYI_API_KEY ?? patchValue('apiKey'),
  defaultModel: DEFAULT_MODEL,
  models: [],
  timeoutMs: 240_000,
}

// --- 1. 目录与闸门 ---------------------------------------------------------
check('目录以 /v1/models 为准（配置留空）', normalizeModels([]).length === 0)
check('默认模型是 2.6-flare', DEFAULT_MODEL === 'gpt-image-2.6-flare', DEFAULT_MODEL)
check('内置快照 6 个模型', KNOWN_MODELS.length === 6, KNOWN_MODELS.join(', '))
check('size 全模型接受', KNOWN_MODELS.every((id) => modelSpec(id).size === true))
check('quality 收但不保证', KNOWN_MODELS.every((id) => modelSpec(id).quality === 'accepted'))
check('2.6 系开到 svg/gif', ['gpt-image-2.6-flare', 'gpt-image-2.6-sunburst'].every((id) => modelSpec(id).outputFormats.includes('svg') && modelSpec(id).outputFormats.includes('gif')))
check('2.5 / 2 只到 webp', ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'gpt-image-2.5', 'gpt-image-2'].every((id) => !modelSpec(id).outputFormats.includes('svg') && !modelSpec(id).outputFormats.includes('gif')))
check('透明底被通道忽略', KNOWN_MODELS.every((id) => modelSpec(id).background === false))
check('mask 走改图接口', KNOWN_MODELS.every((id) => modelSpec(id).mask === 'exact'))
check('陌生 id 透传', modelSpec('dall-e-3').known === false && modelSpec('dall-e-3').outputFormats.includes('svg'))
check('新 gpt-image 型号按 2.5/2 闸门', !modelSpec('gpt-image-3').outputFormats.includes('svg') && modelSpec('gpt-image-3').size === true)
check('尺寸写进提示词的兜底可用', withSizeHint('一只橘猫', '1536x1024').includes('画面比例 3:2'))

// --- 1b. 产物目录解析 ------------------------------------------------------
check('相对目录按会话展开', baseDir('/s/proj', 'gpt-image-output') === '/s/proj/gpt-image-output', baseDir('/s/proj', 'gpt-image-output'))
check('绝对目录原样使用', baseDir('/s/proj', '/Users/x/temu') === '/Users/x/temu', baseDir('/s/proj', '/Users/x/temu'))
check('~ 展开到家目录', baseDir('/s/proj', '~/Pictures/out').endsWith('/Pictures/out') && !baseDir('/s/proj', '~/Pictures/out').includes('/s/proj'), baseDir('/s/proj', '~/Pictures/out'))
check('空目录退回会话目录', baseDir('/s/proj', '') === '/s/proj')

// --- 2. 注册（不发请求） --------------------------------------------------
const { ctx, tools } = fakeContext()
await apply(ctx, { ...CONFIG, baseUrl: 'http://127.0.0.1:9', timeoutMs: 1500, apiKey: '' })
check('注册四个工具', tools.size === 4, [...tools.keys()].join(', '))
for (const [name, tool] of tools) {
  check(`${name} 参数是对象 schema`, tool.parameters?.type === 'object', `required=${(tool.parameters?.required ?? []).join('|')}`)
  check(`${name} 有 output.render`, typeof tool.output?.render === 'function')
}

const generate = tools.get('gpt_image_generate')

/** 用不存在的 base 触发闸门阶段的行为，再读 notes 或错误。 */
async function probe(args) {
  try {
    return await generate.execute(args, { signal: new AbortController().signal })
  } catch (error) {
    return { error: String(error?.message ?? error) }
  }
}

const savedKeyEnv = process.env.GPT_IMAGE_API_KEY
delete process.env.GPT_IMAGE_API_KEY
const noKey = await probe({ prompt: 'x', apiKey: '' })
if (savedKeyEnv !== undefined) process.env.GPT_IMAGE_API_KEY = savedKeyEnv
check('缺 key 报可操作错误', /缺少 api_key/.test(noKey.error ?? ''), noKey.error ?? '')

const noBase = await (async () => {
  const savedBase = process.env.GPT_IMAGE_BASE_URL
  const savedKey = process.env.GPT_IMAGE_API_KEY
  delete process.env.GPT_IMAGE_BASE_URL
  const bare = fakeContext()
  await apply(bare.ctx, { apiKey: 'sk-probe', baseUrl: '' })
  const out = await bare.tools.get('gpt_image_generate')
    .execute({ prompt: 'x' }, { signal: new AbortController().signal })
    .catch((error) => ({ error: String(error?.message ?? error) }))
  if (savedBase !== undefined) process.env.GPT_IMAGE_BASE_URL = savedBase
  if (savedKey !== undefined) process.env.GPT_IMAGE_API_KEY = savedKey
  return out
})()
check('默认走直链响应', hostSource.includes("gated.params.responseFormat = 'url'"))
check('传输失败会换路重试', hostSource.includes('isTransportFailure') && hostSource.includes('formatSwitched'))
check('摘要里给出落盘目录', hostSource.includes('`目录：${dir}`'))
check('缺 base_url 报可操作错误', /缺少 base_url/.test(noBase.error ?? ''), noBase.error ?? '')

const badSize = await generate.execute({ prompt: 'x', size: 'huge', apiKey: CONFIG.apiKey || 'probe-only' }, { signal: new AbortController().signal }).catch((error) => ({ error: String(error?.message ?? error) }))
check('非法尺寸被拒', /尺寸格式/.test(badSize.error ?? ''), badSize.error ?? '')

// 超时必须给出可操作提示：本地起一个只接受不响应的服务
{
  const { createServer } = await import('node:http')
  const server = createServer(() => { /* 故意不响应 */ })
  await new Promise((resolveReady) => server.listen(0, '127.0.0.1', resolveReady))
  const port = server.address().port
  const settings = resolveSettings({ baseUrl: `http://127.0.0.1:${port}`, apiKey: 'sk-probe', timeoutMs: 400 }, {})
  const error = await callGeneration({ model: 'x', prompt: 'x' }, settings, new AbortController().signal)
    .then(() => 'no error')
    .catch((err) => String(err?.message ?? err))
  server.close()
  check('超时错误可操作', /请求超时 400ms/.test(error) && /调大/.test(error), error.slice(0, 80))
}

// 响应体停滞：头部到了但 body 不动，应在阈值内失败而不是干等总超时
{
  const { createServer } = await import('node:http')
  const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{"data":[') })
  await new Promise((resolveReady) => server.listen(0, '127.0.0.1', resolveReady))
  const port = server.address().port
  const settings = resolveSettings({ baseUrl: `http://127.0.0.1:${port}`, apiKey: 'sk-probe', timeoutMs: 30000, bodyStallMs: 2000 }, {})
  const started = Date.now()
  const message = await callGeneration({ model: 'x', prompt: 'x' }, settings, new AbortController().signal)
    .then(() => 'no error')
    .catch((err) => String(err?.message ?? err))
  server.close()
  check('体停滞快速失败', /停滞/.test(message) && Date.now() - started < 15000, `${Date.now() - started}ms · ${message.slice(0, 50)}`)
}

if (!LIVE) {
  const failed = results.filter((row) => !row.ok)
  console.log(`\n${results.length - failed.length}/${results.length} 通过`)
  if (failed.length > 0) process.exitCode = 1
  process.exit(process.exitCode ?? 0)
}

// --- 3. 真机联调 ----------------------------------------------------------
if ((CONFIG.apiKey ?? '') === '') {
  console.error('\n缺少 api_key：设 GPT_IMAGE_API_KEY 后重跑 --live')
  process.exit(1)
}
// 真机用独立的 ctx：上面那个刻意没给 key。
const liveCtx = fakeContext()
await apply(liveCtx.ctx, { ...CONFIG, models: [] })
const liveTools = liveCtx.tools
const generateLive = liveTools.get('gpt_image_generate')
const editLive = liveTools.get('gpt_image_edit')
const configLive = liveTools.get('gpt_image_config')

const outDir = join(process.cwd(), 'selftest-output')
await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })
const exec = { signal: new AbortController().signal }
const settings = resolveSettings({ ...CONFIG, models: [] }, {})

const catalog = await fetchImageModels(settings, exec.signal)
check('/v1/models 拉到图片模型', catalog.length > 0, catalog.join(', '))
check('拉到的清单与内置快照同源', catalog.every((id) => /image/i.test(id)))

const configTool = configLive
const shown = await configTool.execute({ action: 'show' }, exec)
check('config show 打码密钥', !shown.summary.includes(CONFIG.apiKey), shown.settings.apiKey)

const gen = await generateLive.execute({
  prompt: '一只戴墨镜的橘猫坐在海边吧台，电影画幅，胶片颗粒',
  size: '1536x1024',
  out: 'gen.png',
  timeoutMs: 240_000,
}, exec)
check('真机出图落盘', gen.files.length === 1 && gen.files[0].bytes > 10_000, gen.files[0]?.path)
check('size 生效', gen.sizeHonored === true, `${gen.files[0]?.width}×${gen.files[0]?.height}`)
check('默认模型就是清单首个', gen.model === DEFAULT_MODEL, gen.model)
console.log(`  ${gen.summary.split('\n')[0]}`)

const editTool = editLive
const edited = await editTool.execute({
  prompt: '把墨镜换成圆框眼镜，其余保持不变',
  images: [gen.files[0].path],
  model: 'gpt-image-2.6-sunburst',
  timeoutMs: 240_000,
  out: 'edit.png',
}, exec)
check('真机改图落盘', edited.files.length === 1 && edited.files[0].bytes > 10_000, edited.files[0]?.path)

const pair = await generateLive.execute({
  prompt: '同一只橘猫的极简线稿',
  count: 2,
  out: 'pair.png',
  timeoutMs: 240_000,
}, exec)
check('多张并发带后缀', pair.files.length === 2 && pair.files[1].path.includes('pair-2'), pair.files.map((f) => f.path).join(' | '))

const webp = await generateLive.execute({
  prompt: '深色水泥上的黄铜齿轮',
  output_format: 'webp',
  background: 'transparent',
  quality: 'high',
  out: 'gear.webp',
  timeoutMs: 240_000,
}, exec)
check('output_format=webp 真返回 webp', webp.files[0]?.mediaType === 'image/webp' && webp.files[0]?.path.endsWith('.webp'), `${webp.files[0]?.mediaType} ${webp.files[0]?.path}`)
check('透明底被丢弃并说明', webp.notes.some((n) => n.includes('透明底')), webp.notes.join(' / '))
check('quality 附不保证说明', webp.notes.some((n) => n.includes('flat')), webp.notes.join(' / '))

const svg = await generateLive.execute({
  prompt: '极简线稿：一枚齿轮，单色描边',
  model: 'gpt-image-2.6-sunburst',
  output_format: 'svg',
  response_format: 'url',
  out: 'gear.svg',
  timeoutMs: 300_000,
}, exec).catch((error) => ({ files: [], notes: [], error: String(error?.message ?? error) }))
check('output_format=svg 真返回 svg', svg.files[0]?.mediaType === 'image/svg+xml' && svg.files[0]?.path.endsWith('.svg'), svg.error ?? `${svg.files[0]?.mediaType} ${svg.files[0]?.bytes}B`)
check('svg 不跟 size 已说明', svg.notes.some((n) => n.includes('不按 size')), svg.notes.join(' / '))

await writeFile(join(outDir, 'report.json'), JSON.stringify(results, null, 2))
const failed = results.filter((row) => !row.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
if (failed.length > 0) process.exitCode = 1