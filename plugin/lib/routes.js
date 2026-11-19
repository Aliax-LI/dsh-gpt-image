/**
 * 设置页用的宿主 HTTP 端点：读写配置、拉模型清单、报告放大能力。
 *
 * 为什么不用标准表单：dsh 的 Settings 只负责把 volatile 字段投影成「数据」，
 * 目前没有随包发布的客户端会据此自动建页，所以本插件自带一个 settings.section 页面，
 * 由这些端点提供数据。写入仍走 `settings.update` / `configEditor`，不手改 profile 文件。
 * @module gpt-image/lib/routes
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { listAccountModels, publicSettings, resolveSettings } from './api.js'
import { readConfig } from './config.js'
import { upscaleStatus } from './upscale.js'

/** 路由前缀。 */
export const PREFIX = '/gpt-image'

/** 协议版本：设置页据此判断宿主端是否已经是带放大字段的新代码。 */
export const ROUTES_API = 2

/** 插件图标：设置页标题直接复用同一份资源，列表与页面不会各画一套。 */
const ICON_PATH = fileURLToPath(new URL('../icon.svg', import.meta.url))

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

/**
 * 只接受本机来源，避免同网段页面改配置。
 * @param request - Node 请求对象。
 * @returns 是否可信。
 */
function isTrustedRequest(request) {
  const address = request.socket?.remoteAddress ?? ''
  if (!LOOPBACK.has(address)) return false
  const origin = request.headers?.origin
  if (typeof origin !== 'string' || origin === '') return true
  try {
    const parsed = new URL(origin)
    return ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
  } catch {
    return false
  }
}

function sendJson(response, status, body) {
  const text = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  response.end(text)
}

async function readBody(request, limit = 64 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > limit) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('请求体不是合法 JSON')
  }
}

/**
 * 找出本插件在 settings 里的命名空间：优先用 settings.describe() 里与入口 id 匹配的那个。
 * @param settings - settings 服务（可为空）。
 * @param entry - 当前 loader 入口。
 * @returns 命名空间字符串或 `undefined`。
 */
function settingsNamespace(settings, entry) {
  if (settings == null || entry == null) return undefined
  const target = entry.options?.id
  const descriptors = settings.describe()
  const match = descriptors.find((row) => row.ns === target)
    ?? descriptors.find((row) => String(row.ns).endsWith(`:${target}`))
    ?? descriptors.find((row) => String(row.ns).includes('gpt-image'))
  return match?.ns
}

/**
 * 注册设置页需要的端点。
 * @param webServer - `ctx.webServer`。
 * @param options - `{ config, entry, settings, editor }`。
 * @returns 清理函数。
 */
export function registerRoutes(webServer, options) {
  if (webServer == null || typeof webServer.register !== 'function') return () => {}
  const disposers = []

  // webServer 按 (kind, path) 去重：同一路径只能注册一次，所以方法在处理器内分流。
  const route = (path, handler) => {
    const dispose = webServer.register({
      kind: 'exact',
      path: `${PREFIX}${path}`,
      handler: async (request, response) => {
        if (!isTrustedRequest(request)) {
          sendJson(response, 403, { ok: false, error: 'forbidden' })
          return
        }
        if (request.method !== 'GET' && request.method !== 'POST') {
          response.writeHead(405, { allow: 'GET, POST' })
          response.end()
          return
        }
        try {
          const body = request.method === 'POST' ? await readBody(request) : {}
          const result = await handler(request.method, body)
          sendJson(response, 200, { ok: true, ...result })
        } catch (error) {
          sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    }, `gpt-image:${path}`)
    if (typeof dispose === 'function') disposers.push(dispose)
  }

  const saveConfig = async (body) => {
    const patch = {}
    if (typeof body.baseUrl === 'string' && body.baseUrl.trim() !== '') patch.baseUrl = body.baseUrl.trim()
    if (typeof body.apiKey === 'string' && body.apiKey.trim() !== '') patch.apiKey = body.apiKey.trim()
    if (typeof body.defaultModel === 'string' && body.defaultModel.trim() !== '') patch.defaultModel = body.defaultModel.trim()
    if (typeof body.modelsText === 'string') {
      patch.models = body.modelsText.split(/[,\s]+/).map((id) => id.trim()).filter((id) => id !== '')
    }
    if (typeof body.outputDir === 'string' && body.outputDir.trim() !== '') patch.outputDir = body.outputDir.trim()
    if (body.timeoutMs != null) patch.timeoutMs = Number(body.timeoutMs)
    if (typeof body.autoFallback === 'boolean') patch.autoFallback = body.autoFallback
    if (typeof body.upscaleEngine === 'string') patch.upscaleEngine = body.upscaleEngine
    if (body.upscaleTargetLongEdge != null) patch.upscaleTargetLongEdge = Number(body.upscaleTargetLongEdge)
    if (body.upscaleSharpen != null) patch.upscaleSharpen = Number(body.upscaleSharpen)
    if (typeof body.realesrganPath === 'string') patch.realesrganPath = body.realesrganPath.trim()
    if (typeof body.sizeHintInPrompt === 'boolean') patch.sizeHintInPrompt = body.sizeHintInPrompt
    if (Object.keys(patch).length === 0) throw new Error('没有要保存的字段')

    const settings = options.settings
    const ns = settingsNamespace(settings, options.entry)
    if (settings != null && ns != null) {
      await settings.update(ns, patch)
    } else if (options.editor != null && options.entry != null) {
      await options.editor.edit(options.entry, (current) => ({ ...current, ...patch }))
    } else {
      throw new Error('这个 profile 没有可用的配置写入通道')
    }
    const next = resolveSettings(readConfig(options.config), {})
    return { settings: publicSettings(next), saved: Object.keys(patch) }
  }


  route('/config', async (method, body) => {
    if (method === 'POST') return saveConfig(body)
    const settings = resolveSettings(readConfig(options.config), {})
    const ns = settingsNamespace(options.settings, options.entry)
    const masked = publicSettings(settings)
    return {
      api: ROUTES_API,
      ns: ns ?? null,
      settings: masked,
      // 表单要的是可编辑的完整字段；密钥只回是否已配置，不回明文。
      raw: {
        baseUrl: settings.baseUrl,
        apiKey: '',
        apiKeyConfigured: settings.apiKey !== '',
        defaultModel: settings.defaultModel,
        models: settings.models,
        modelsText: settings.models.join(', '),
        outputDir: settings.outputDir,
        timeoutMs: settings.timeoutMs,
        autoFallback: settings.autoFallback,
        upscaleEngine: settings.upscaleEngine,
        upscaleTargetLongEdge: settings.upscaleTargetLongEdge,
        upscaleSharpen: settings.upscaleSharpen,
        realesrganPath: settings.realesrganPath,
        sizeHintInPrompt: settings.hintIntoPrompt,
      },
      upscale: await upscaleStatus({ realesrganPath: settings.realesrganPath }),
    }
  })

  route('/test', async (method, body) => {
    if (method !== 'POST') throw new Error('测试接口只接受 POST')
    const saved = resolveSettings(readConfig(options.config), {})
    const baseUrl = typeof body.baseUrl === 'string' && body.baseUrl.trim() !== '' ? body.baseUrl.trim() : saved.baseUrl
    const apiKey = typeof body.apiKey === 'string' && body.apiKey.trim() !== '' ? body.apiKey.trim() : saved.apiKey
    if (apiKey === '') throw new Error('还没有 API Key')
    const probe = {
      ...saved,
      baseUrl,
      apiKey,
      // 测试是同步点击，别用出图那档超时。
      timeoutMs: Math.min(saved.timeoutMs, 20_000),
    }
    const started = Date.now()
    const ids = await listAccountModels(probe, AbortSignal.timeout(25_000))
    const imageModels = ids.filter((id) => /image/i.test(id) && !/^auto$/i.test(id))
    return {
      baseUrl,
      latencyMs: Date.now() - started,
      total: ids.length,
      imageModels,
      models: ids,
      usedSavedKey: !(typeof body.apiKey === 'string' && body.apiKey.trim() !== ''),
    }
  })

  route('/models', async () => {
    const settings = resolveSettings(readConfig(options.config), {})
    if (settings.apiKey === '') throw new Error('还没配置 API Key')
    const ids = await listAccountModels(settings, AbortSignal.timeout(20_000))
    return { models: ids, imageModels: ids.filter((id) => /image/i.test(id) && !/^auto$/i.test(id)) }
  })

  const iconDispose = webServer.register({
    kind: 'exact',
    path: `${PREFIX}/icon.svg`,
    handler: async (request, response) => {
      if (!isTrustedRequest(request)) {
        response.writeHead(403)
        response.end()
        return
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { allow: 'GET, HEAD' })
        response.end()
        return
      }
      try {
        const bytes = await readFile(ICON_PATH)
        response.writeHead(200, {
          'content-type': 'image/svg+xml; charset=utf-8',
          'cache-control': 'public, max-age=3600',
          'content-length': bytes.length,
        })
        response.end(request.method === 'HEAD' ? undefined : bytes)
      } catch {
        response.writeHead(404)
        response.end()
      }
    },
  }, 'gpt-image:icon')
  if (typeof iconDispose === 'function') disposers.push(iconDispose)

  return () => { for (const dispose of disposers) dispose() }
}