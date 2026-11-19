/**
 * OpenAI 兼容图片接口的传输层：配置解析、请求构造、响应落地。
 * @module gpt-image/lib/api
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'

import { extensionOf, imageSize, sniffMediaType } from './image.js'
import { DEFAULT_MODEL, normalizeModels } from './models.js'

/** 缺省服务地址。 */
export const DEFAULT_BASE_URL = 'https://sub2api.e2mai3lzz.top'
/** 缺省产物目录（相对会话工作目录）。 */
export const DEFAULT_OUTPUT_DIR = 'gpt-image-output'
/** 缺省超时：官逆出图常见 30–90s，2K/4K 更久。 */
export const DEFAULT_TIMEOUT_MS = 300_000

const firstString = (...values) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return undefined
}

const envModels = () => {
  const raw = firstString(process.env.GPT_IMAGE_MODELS)
  return raw == null ? undefined : raw.split(',').map((item) => item.trim()).filter((item) => item !== '')
}

/**
 * 解析生效配置。优先级：工具参数 > 插件行 config > 环境变量 > 缺省值。
 * @param pluginConfig - 插件行 `config`。
 * @param args - 工具参数里的显式覆盖（`baseUrl` / `apiKey` / `model` / `timeoutMs`）。
 * @returns 生效配置。
 */
export function resolveSettings(pluginConfig = {}, args = {}) {
  const models = args.models != null
    ? normalizeModels(args.models, [])
    : normalizeModels(pluginConfig.models ?? envModels(), [])
  return {
    baseUrl: firstString(args.baseUrl, pluginConfig.baseUrl, process.env.GPT_IMAGE_BASE_URL, DEFAULT_BASE_URL),
    apiKey: firstString(args.apiKey, pluginConfig.apiKey, process.env.GPT_IMAGE_API_KEY, process.env.APIYI_API_KEY, '') ?? '',
    models,
    defaultModel: firstString(args.model, pluginConfig.defaultModel, process.env.GPT_IMAGE_MODEL, DEFAULT_MODEL),
    outputDir: firstString(pluginConfig.outputDir, process.env.GPT_IMAGE_OUTPUT_DIR, DEFAULT_OUTPUT_DIR),
    timeoutMs: positiveInt(args.timeoutMs ?? pluginConfig.timeoutMs, DEFAULT_TIMEOUT_MS),
    hintIntoPrompt: pluginConfig.sizeHintInPrompt !== false,
    autoFallback: pluginConfig.autoFallback !== false && process.env.GPT_IMAGE_NO_FALLBACK == null,
    upscaleEngine: firstString(pluginConfig.upscaleEngine, process.env.GPT_IMAGE_UPSCALE, 'auto'),
    upscaleTargetLongEdge: positiveInt(pluginConfig.upscaleTargetLongEdge, 0),
    upscaleSharpen: Number.isFinite(Number(pluginConfig.upscaleSharpen)) ? Number(pluginConfig.upscaleSharpen) : 0.5,
    realesrganPath: firstString(pluginConfig.realesrganPath, process.env.GPT_IMAGE_REALESRGAN, '') ?? '',
  }
}

const positiveInt = (value, fallback) => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

/**
 * 打码后的配置快照，供 `gpt_image_config` 与自检输出。
 * @param settings - 生效配置。
 * @returns 可安全展示的配置。
 */
export function publicSettings(settings) {
  return {
    baseUrl: settings.baseUrl,
    apiKey: maskKey(settings.apiKey),
    apiKeyConfigured: settings.apiKey !== '',
    models: settings.models,
    defaultModel: settings.defaultModel,
    outputDir: settings.outputDir,
    timeoutMs: settings.timeoutMs,
  }
}

/**
 * 密钥打码：保留头尾，长度不足时全遮。
 * @param key - 原始密钥。
 * @returns 展示用字符串。
 */
export function maskKey(key) {
  if (key === '') return '（未配置）'
  if (key.length <= 12) return '****'
  return `${key.slice(0, 5)}…${key.slice(-4)}`
}

/**
 * 拼端点：baseUrl 已带 `/v1` 时不再重复。
 * @param baseUrl - 服务地址。
 * @param path - 以 `/` 开头的接口路径。
 * @returns 完整 URL。
 */
export function endpointUrl(baseUrl, path) {
  const base = String(baseUrl).replace(/\/+$/, '')
  return /\/v\d+$/.test(base) ? `${base}${path}` : `${base}/v1${path}`
}

/**
 * 把调用方的取消信号与本地超时合成一个。
 * @param signal - 调用方的 AbortSignal。
 * @param timeoutMs - 超时毫秒。
 * @returns `{signal, dispose}`。
 */
function withTimeout(signal, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`请求超时 ${timeoutMs}ms`)), timeoutMs)
  const forward = () => controller.abort(signal?.reason)
  if (signal != null) {
    if (signal.aborted) forward()
    else signal.addEventListener('abort', forward, { once: true })
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer)
      if (signal != null) signal.removeEventListener('abort', forward)
    },
  }
}

/** 服务端已给出明确失败（HTTP 错误 / 非 JSON）：不重试，直接上抛。 */
class ApiFailure extends Error {}

/**
 * 发送请求并把错误翻译成可读消息。
 * @param url - 目标 URL。
 * @param init - fetch 初始化。
 * @param settings - 生效配置。
 * @param signal - 取消信号。
 * @returns 解析后的响应体。
 */
async function send(url, init, settings, signal) {
  for (let attempt = 0; ; attempt += 1) {
    const scoped = withTimeout(signal, settings.timeoutMs)
    try {
      const response = await fetch(url, { ...init, signal: scoped.signal })
      // 长响应体也要在预算内读完：CDN 偶发掐连接，读 body 阶段同样要能重试。
      const text = await response.text()
      if (!response.ok) throw new ApiFailure(describeFailure(response.status, text, url))
      try {
        return JSON.parse(text)
      } catch {
        throw new ApiFailure(`图片接口返回非 JSON（${response.status}）：${text.slice(0, 300)}`)
      }
    } catch (error) {
      if (error instanceof ApiFailure) throw error
      const aborted = scoped.signal.aborted
      const reason = describeNetworkError(error)
      if (aborted) throw new Error(`图片接口超时或被取消：${url}（${reason}）`)
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        continue
      }
      throw new Error(`图片接口连接失败（已重试一次）：${url}（${reason}）`)
    } finally {
      scoped.dispose()
    }
  }
}

/**
 * 展开 fetch 的连接错误，把 undici 的 cause 链带出来。
 * @param error - fetch 抛出的错误。
 * @returns 一句原因。
 */
function describeNetworkError(error) {
  const parts = [error?.message ?? String(error)]
  let cause = error?.cause
  let depth = 0
  while (cause != null && depth < 3) {
    const code = cause.code ?? cause.errno
    const message = cause.message ?? cause.syscall
    if (code != null || message != null) parts.push([code, message].filter((item) => item != null).join(' '))
    cause = cause.cause
    depth += 1
  }
  return parts.filter((part) => String(part).trim() !== '').join(' · ')
}

/**
 * 把 HTTP 失败体翻译成一句能直接照做的中文。
 * @param status - HTTP 状态码。
 * @param text - 响应正文。
 * @param url - 请求地址。
 * @returns 错误消息。
 */
function describeFailure(status, text, url) {
  let detail = text.slice(0, 500)
  let code = ''
  try {
    const body = JSON.parse(text)
    const error = body?.error ?? body
    code = String(error?.code ?? error?.type ?? '')
    detail = String(error?.message ?? detail)
  } catch {
    // 非 JSON 原样保留。
  }
  const scope = `[${status}${code === '' ? '' : ` ${code}`}] ${detail}`
  if (status === 401 || status === 403) return `${scope}\n检查 api_key 是否有效、是否属于当前 base_url 的分组。`
  if (code === 'model_not_found' || status === 404) {
    return `${scope}\n该模型不在当前密钥的分组里：用 gpt_image_config({action:"models"}) 或 action:"show" 换一个本账号可用的模型。`
  }
  if (status === 429) return `${scope}\n触发了限流：降低并发（count）或稍后重试。`
  return `${scope}\n请求地址：${url}`
}

/** 图片模型清单缓存：避免每次出图都多打一次 /v1/models。 */
const catalogCache = new Map()
const CATALOG_TTL_MS = 10 * 60_000

/**
 * 以账号 `/v1/models` 为准取图片模型清单（10 分钟缓存）。
 * @param settings - 生效配置。
 * @param signal - 取消信号。
 * @returns 图片模型 id 数组；请求失败时返回空数组。
 */
export async function fetchImageModels(settings, signal) {
  const cacheKey = `${settings.baseUrl}|${settings.apiKey.slice(-8)}`
  const hit = catalogCache.get(cacheKey)
  if (hit != null && Date.now() - hit.at < CATALOG_TTL_MS) return hit.models
  try {
    const ids = await listAccountModels(settings, signal)
    const models = ids.filter((id) => /image/i.test(id) && !/^auto$/i.test(id))
    catalogCache.set(cacheKey, { at: Date.now(), models })
    return models
  } catch {
    return []
  }
}

/** 一次调用的请求体（与服务端 form 字段同构）。 */
const buildBody = (request) => {
  const body = { model: request.model, prompt: request.prompt }
  if (request.size != null) body.size = request.size
  if (request.quality != null) body.quality = request.quality
  if (request.background != null) body.background = request.background
  // 网关认的是 output_format；`format` 会被静默忽略，所以字段名不能写错。
  if (request.outputFormat != null) body.output_format = request.outputFormat
  if (request.responseFormat != null) body.response_format = request.responseFormat
  return body
}

/**
 * 调用文生图接口。
 * @param request - `{model, prompt, size, quality, background, format}`。
 * @param settings - 生效配置。
 * @param signal - 取消信号。
 * @returns 服务端响应体。
 */
export async function callGeneration(request, settings, signal) {
  return send(endpointUrl(settings.baseUrl, '/images/generations'), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${settings.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(buildBody(request)),
  }, settings, signal)
}

/**
 * 调用改图接口（multipart）。
 * @param request - `{model, prompt, size, quality, background, format, images:[path], mask?}`。
 * @param settings - 生效配置。
 * @param signal - 取消信号。
 * @returns 服务端响应体。
 */
export async function callEdit(request, settings, signal) {
  const form = new FormData()
  form.append('model', request.model)
  form.append('prompt', request.prompt)
  if (request.size != null) form.append('size', String(request.size))
  if (request.quality != null) form.append('quality', String(request.quality))
  if (request.background != null) form.append('background', String(request.background))
  if (request.outputFormat != null) form.append('output_format', String(request.outputFormat))
  if (request.responseFormat != null) form.append('response_format', String(request.responseFormat))
  for (const file of request.images) {
    const bytes = await readFile(file)
    form.append('image[]', new Blob([bytes], { type: sniffMediaType(bytes) ?? 'image/png' }), basename(file))
  }
  if (request.mask != null) {
    const bytes = await readFile(request.mask)
    form.append('mask', new Blob([bytes], { type: sniffMediaType(bytes) ?? 'image/png' }), basename(request.mask))
  }
  return send(endpointUrl(settings.baseUrl, '/images/edits'), {
    method: 'POST',
    headers: { authorization: `Bearer ${settings.apiKey}` },
    body: form,
  }, settings, signal)
}

/**
 * 读取账号可见模型（用于排错与切换）。
 * @param settings - 生效配置。
 * @param signal - 取消信号。
 * @returns 模型 id 数组。
 */
export async function listAccountModels(settings, signal) {
  const payload = await send(endpointUrl(settings.baseUrl, '/models'), {
    method: 'GET',
    headers: { authorization: `Bearer ${settings.apiKey}` },
  }, settings, signal)
  const rows = Array.isArray(payload?.data) ? payload.data : []
  return rows.map((row) => row?.id).filter((id) => typeof id === 'string')
}

/**
 * 从响应体取出每一项的字节与元信息。
 * @param payload - 服务端响应体。
 * @param signal - 取消信号（用于下载 url 形式的结果）。
 * @returns 图片条目数组。
 */
export async function collectItems(payload, signal) {
  const rows = Array.isArray(payload?.data) ? payload.data : []
  if (rows.length === 0) {
    throw new Error(`图片接口没有返回图片：${JSON.stringify(payload).slice(0, 300)}`)
  }
  const items = []
  for (const row of rows) {
    let bytes
    if (typeof row?.b64_json === 'string' && row.b64_json !== '') {
      bytes = Buffer.from(row.b64_json, 'base64')
    } else if (typeof row?.url === 'string' && row.url !== '') {
      bytes = await downloadResult(row.url, signal)
    } else {
      throw new Error('响应项既没有 b64_json 也没有 url')
    }
    items.push({
      bytes,
      revisedPrompt: typeof row.revised_prompt === 'string' ? row.revised_prompt : undefined,
      reportedWidth: Number.isFinite(row?.width) ? row.width : undefined,
      reportedHeight: Number.isFinite(row?.height) ? row.height : undefined,
    })
  }
  return items
}

const stamp = () => {
  const now = new Date()
  const pad = (n, w = 2) => String(n).padStart(w, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

/**
 * 决定每张图的落盘路径。
 * @param out - 调用方给的输出名或路径（可为空）。
 * @param context - `{cwd, outputDir, mode, index, count, extension}`。
 * @returns 绝对路径。
 */
function targetPath(out, context) {
  const { cwd, outputDir, mode, index, count, extension } = context
  const suffix = count > 1 ? `-${index + 1}` : ''
  if (out == null || out.trim() === '') {
    return join(cwd, outputDir, `${mode}-${stamp()}${suffix}.${extension}`)
  }
  const raw = out.trim()
  const hasDir = raw.includes('/') || raw.includes('\\')
  const base = hasDir ? (isAbsolute(raw) ? raw : resolve(cwd, raw)) : join(cwd, outputDir, raw)
  const ext = extname(base)
  if (ext !== '') {
    return `${base.slice(0, -ext.length)}${suffix}.${extension}`
  }
  return `${base}${suffix}.${extension}`
}

/**
 * 下载 url 形式的结果；CDN 偶发 DNS/连接抖动，退避重试两次再报错。
 * @param url - 结果直链。
 * @param signal - 取消信号。
 * @returns 图片字节。
 */
async function downloadResult(url, signal) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(url, { signal })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      if (signal?.aborted) throw error
      if (attempt >= 2) {
        throw new Error(`下载远端结果失败：${url}（${describeNetworkError(error)}）`)
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)))
    }
  }
}

/**
 * 写盘并回报每张图的路径与尺寸。
 * @param items - `collectItems` 的结果。
 * @param context - `{cwd, outputDir, mode, out, format}`。
 * @returns 落盘记录数组。
 */
export async function saveItems(items, context) {
  const files = []
  for (const [index, item] of items.entries()) {
    const mediaType = sniffMediaType(item.bytes) ?? 'image/png'
    const extension = extensionOf(mediaType)
    const path = targetPath(context.out, { ...context, index, count: items.length, extension })
    await mkdir(dirOf(path), { recursive: true })
    await writeFile(path, item.bytes)
    const size = imageSize(item.bytes)
    files.push({
      path,
      bytes: item.bytes.length,
      width: item.reportedWidth ?? size.width,
      height: item.reportedHeight ?? size.height,
      mediaType,
      revisedPrompt: item.revisedPrompt ?? null,
    })
  }
  return files
}

const dirOf = (path) => path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))) || '.'

/**
 * 把 `WxH` 归一化成小写 `x`；`auto` 原样返回。
 * @param value - 调用方给的尺寸。
 * @returns 归一化尺寸或 `undefined`。
 */
export function normalizeSize(value) {
  if (value == null || value === '') return undefined
  const raw = String(value).trim().toLowerCase().replace('×', 'x')
  if (raw === 'auto') return 'auto'
  if (!/^\d{2,5}x\d{2,5}$/.test(raw)) {
    throw new Error(`尺寸格式应为 宽x高（如 1536x1024）或 auto，收到：${value}`)
  }
  return raw
}

const ASPECT_LABEL = {
  '1:1': '正方形构图',
  '4:3': '横版构图',
  '3:2': '横版构图',
  '16:9': '宽横版构图',
  '3:4': '竖版构图',
  '2:3': '竖版构图',
  '9:16': '竖屏构图',
  '4:5': '竖版构图',
  '5:4': '横版构图',
}

const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b))

/**
 * 把尺寸翻译成提示词尾句；不接受 `size` 的官逆模型靠它控画幅。
 * @param prompt - 原始提示词。
 * @param size - 归一化尺寸。
 * @returns 追加了画幅描述的提示词。
 */
export function withSizeHint(prompt, size) {
  const match = /^(\d+)\s*x\s*(\d+)$/.exec(size ?? '')
  if (match == null) return prompt
  const width = Number(match[1])
  const height = Number(match[2])
  const divisor = gcd(width, height)
  const ratio = `${width / divisor}:${height / divisor}`
  const label = ASPECT_LABEL[ratio] ?? (width > height ? '横版构图' : height > width ? '竖版构图' : '正方形构图')
  const base = String(prompt).trim().replace(/[。.\s]+$/, '')
  if (base.includes('画面比例')) return base
  return `${base}。画面比例 ${ratio}（${label}），主体居中，四周留白，无文字无水印。`
}