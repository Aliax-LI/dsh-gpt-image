/**
 * GPT Image 官逆出图插件：文生图、改图/局部重绘/多图融合，走 OpenAI 兼容的
 * `/v1/images/generations` 与 `/v1/images/edits`。
 *
 * 模型清单**以账号 `GET /v1/models` 为准**，插件不自带白名单；内置表只记录每个模型
 * 实际吃什么参数（实测得出：size 生效、quality 收但不保证、format 与 transparent
 * 被通道忽略、mask 走改图接口）。目录外的模型走透传，报错按网关为准。
 * @module @local/dsh-gpt-image
 */
import { access } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'

import {
  callEdit,
  callGeneration,
  collectItems,
  endpointUrl,
  fetchImageModels,
  listAccountModels,
  normalizeSize,
  publicSettings,
  resolveSettings,
  saveItems,
  withSizeHint,
} from './lib/api.js'
import { DEFAULT_MODEL, KNOWN_MODELS, describeModels, modelSpec } from './lib/models.js'
import { Config, readConfig } from './lib/config.js'
import { UPSCALE_ENGINES, upscaleGenerated, upscaleImage, upscaleStatus } from './lib/upscale.js'
import { registerRoutes } from './lib/routes.js'

export const name = 'gpt-image'
export const inject = ['tools']

/** 配置 schema：字段全是 volatile，设置页改完即时生效。 */
export { Config }

const MAX_IMAGES = 16
const MAX_COUNT = 5
const BACKGROUNDS = ['auto', 'opaque', 'transparent']
const QUALITIES = ['low', 'medium', 'high', 'xhigh', 'max', 'auto']
const OUTPUT_FORMATS = ['png', 'jpeg', 'webp', 'gif', 'svg']
const RESPONSE_FORMATS = ['b64_json', 'url']

/** 输出契约：三个工具共用的落盘结果形状。 */
const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    files: { type: 'array', items: { type: 'object', additionalProperties: true } },
    notes: { type: 'array', items: { type: 'string' } },
  },
  additionalProperties: true,
}

const clamp = (value, min, max, fallback) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

/**
 * 渲染结果：一段摘要（含每张图路径与尺寸）。
 * @param _args - 调用参数（未使用）。
 * @param value - 工具返回值。
 * @returns 文本内容块。
 */
const renderResult = (_args, value) => [{ type: 'text', text: String(value?.summary ?? '') }]

/**
 * 注册出图 / 改图 / 配置三个工具。
 * @param ctx - 插件上下文。
 * @param config - 插件行 config：`baseUrl` / `apiKey` / `models` / `defaultModel` / `outputDir` / `timeoutMs`。
 */
export async function apply(ctx, config = {}) {
  const current = () => resolveSettings(readConfig(config), {})
  const base = current()
  // 目录以 /v1/models 为准；激活时拉一次用于工具描述，拉不到就用实测快照。
  const live = base.models.length > 0
    ? base.models
    : await fetchImageModels({ ...base, timeoutMs: 8000 }, AbortSignal.timeout(9000)).catch(() => [])
  const catalog = live.length > 0 ? live : KNOWN_MODELS
  const defaultModel = catalog.includes(base.defaultModel) ? base.defaultModel : (catalog[0] ?? DEFAULT_MODEL)
  const catalogLine = catalog.includes(base.defaultModel)
    ? ''
    : `\n注意：配置的默认模型 ${base.defaultModel} 不在账号清单里，实际默认用 ${defaultModel}。`

  const cwdOf = async (exec) => {
    const workingDirectory = ctx.get('workingDirectory')
    if (workingDirectory != null && exec?.agent != null) {
      try {
        return await workingDirectory.ensure(exec.agent, exec.signal)
      } catch {
        // 目录恢复失败时退回进程目录，别让出图任务连带失败。
      }
    }
    return process.cwd()
  }

  /**
   * 按模型能力裁剪参数；被丢弃的字段转成 notes 回给调用方。
   * @param request - 原始工具参数。
   * @param spec - 模型能力表。
   * @returns `{prompt, params, notes, maskSupport}`。
   */
  const gate = (request, spec) => {
    const notes = []
    let prompt = String(request.prompt ?? '').trim()
    const params = {}

    const size = normalizeSize(request.size)
    if (size != null) {
      if (spec.size) params.size = size
      else {
        prompt = withSizeHint(prompt, size)
        notes.push(`\`${spec.id}\` 不接受 size：已把画幅「${size}」写进提示词。`)
      }
    }

    if (request.quality != null) {
      if (!QUALITIES.includes(request.quality)) {
        throw new Error(`quality 只能是 ${QUALITIES.join(' / ')}`)
      }
      if (spec.quality === 'accepted') {
        params.quality = request.quality
        notes.push(`quality=${request.quality} 已随请求发出；该通道 flat 计价，实测不报错但画质差异无法保证。`)
      } else if (spec.quality) {
        params.quality = request.quality
      } else {
        notes.push(`\`${spec.id}\` 不接受 quality，已忽略 ${request.quality}。`)
      }
    }

    if (request.background != null) {
      if (!BACKGROUNDS.includes(request.background)) {
        throw new Error(`background 只能是 ${BACKGROUNDS.join(' / ')}`)
      }
      if (spec.background) params.background = request.background
      else if (request.background !== 'auto') {
        notes.push(`该通道不出透明底（实测 transparent 返回无 alpha 的 RGB png），已忽略 background=${request.background}。`)
      }
    }

    // 网关只认 output_format；`format` 连非法值都会被静默忽略，所以当成别名接住再改名发送。
    const requestedFormat = request.output_format ?? request.format
    if (requestformatAliased(request)) {
      notes.push('`format` 不是网关参数（实测连 bogus 都被静默忽略），已改用 `output_format` 发送。')
    }
    if (requestedFormat != null) {
      if (!OUTPUT_FORMATS.includes(requestedFormat)) {
        throw new Error(`output_format 只能是 ${OUTPUT_FORMATS.join(' / ')}`)
      }
      if (spec.outputFormats.includes(requestedFormat)) {
        params.outputFormat = requestedFormat
        if (requestedFormat === 'gif' || requestedFormat === 'svg') {
          const actual = requestedFormat === 'gif' ? '约 411×410' : '1200×900'
          notes.push(`output_format=${requestedFormat} 不按 size 出图（实测 1024x1024 请求得到${actual}），画幅以返回为准。`)
        }
      } else if (requestedFormat !== 'png') {
        notes.push(`\`${spec.id}\` 只开到 ${spec.outputFormats.join(' / ')}：${requestedFormat} 会被网关 400（* output is not enabled for this image model），已改按 png 出图。`)
      }
    }

    if (request.response_format != null) {
      if (!RESPONSE_FORMATS.includes(request.response_format)) {
        throw new Error(`response_format 只能是 ${RESPONSE_FORMATS.join(' / ')}`)
      }
      params.responseFormat = request.response_format
    }

    let maskSupport = 'none'
    if (request.mask != null) {
      if (spec.mask === 'exact') maskSupport = 'exact'
      else if (spec.mask === 'whole') {
        maskSupport = 'whole'
        notes.push('该模型的 mask 只做整图重绘：蒙版随请求发出，但不要期待只改蒙版区。')
      } else notes.push(`\`${spec.id}\` 不接受 mask，已忽略。`)
    }

    return { prompt, params, notes, maskSupport }
  }

  const requestformatAliased = (request) => request.format != null && request.output_format == null

  const resolveInput = async (path, cwd, label) => {
    const target = isAbsolute(path) ? path : resolve(cwd, path)
    try {
      await access(target)
    } catch {
      throw new Error(`${label}不存在：${target}`)
    }
    return target
  }

  /** 客户端并发出多张，服务端一律不发 n。 */
  const runPool = async (count, task) => {
    const results = new Array(count)
    const lane = async (offset) => {
      for (let index = offset; index < count; index += 2) results[index] = await task(index)
    }
    await Promise.all(Array.from({ length: Math.min(2, count) }, (_, index) => lane(index)))
    return results
  }

  /**
   * 取本次调用可用的模型清单：配置有就用配置，没配置就现场问 /v1/models。
   * @param settings - 生效配置。
   * @param signal - 取消信号。
   * @returns 模型 id 数组。
   */
  const resolveCatalog = async (settings, signal) => {
    if (settings.models.length > 0) return settings.models
    const live = await fetchImageModels(settings, signal)
    return live.length > 0 ? live : KNOWN_MODELS
  }

  /**
   * 选一个本账号真的能用的模型：先看清单里谁在 `/v1/models` 里，再退回任何 image 模型。
   * @param settings - 生效配置。
   * @param signal - 取消信号。
   * @param unavailable - 刚刚 404 的模型 id。
   * @returns 可用模型 id，或 `undefined`。
   */
  const pickFallback = async (settings, signal, unavailable) => {
    try {
      const ids = await listAccountModels(settings, signal)
      const configured = settings.models.filter((id) => id !== unavailable && ids.includes(id))
      if (configured.length > 0) return configured[0]
      return ids.find((id) => id !== unavailable && /image/i.test(id) && !/^auto$/i.test(id))
    } catch {
      return undefined
    }
  }

  /**
   * 出图/改图共用执行体。
   * @param request - 工具参数。
   * @param exec - 工具运行上下文。
   * @param mode - `'gen'` 或 `'edit'`。
   * @returns 工具返回值。
   */
  const run = async (request, exec, mode) => {
    const settings = resolveSettings(readConfig(config), request)
    if (settings.apiKey === '') {
      throw new Error('缺少 api_key：写入插件配置的 apiKey，或设置环境变量 GPT_IMAGE_API_KEY，或在调用时传 apiKey。')
    }
    const catalog = await resolveCatalog(settings, exec.signal)
    const explicitModel = typeof request.model === 'string' && request.model.trim() !== ''
    const requestedModel = explicitModel ? request.model.trim() : (catalog.includes(settings.defaultModel) ? settings.defaultModel : catalog[0] ?? DEFAULT_MODEL)
    const notes = []
    const cwd = await cwdOf(exec)
    const count = clamp(request.count, 1, MAX_COUNT, 1)
    const started = Date.now()

    /**
     * 按给定模型把参数过一遍闸门，并解析改图输入。
     * @param modelId - 本次实际发送的模型 id。
     * @returns 本次请求的计划。
     */
    const prepare = async (modelId) => {
      const spec = modelSpec(modelId)
      const localNotes = []
      if (!catalog.includes(modelId)) {
        localNotes.push(`\`${modelId}\` 不在账号模型清单里（${catalog.join(', ')}）；仍按该 id 发送。`)
      }
      const gated = gate(request, spec)
      localNotes.push(...gated.notes)

      let images = []
      let maskPath
      if (mode === 'edit') {
        const list = Array.isArray(request.images)
          ? request.images.filter((item) => typeof item === 'string' && item.trim() !== '')
          : []
        if (list.length === 0) throw new Error('改图需要至少一张输入图片：传 images 数组')
        if (list.length > MAX_IMAGES) throw new Error(`一次最多 ${MAX_IMAGES} 张输入图片，收到 ${list.length} 张`)
        images = await Promise.all(list.map((item) => resolveInput(item, cwd, '输入图片')))
        if (request.mask != null && gated.maskSupport !== 'none') {
          maskPath = await resolveInput(request.mask, cwd, '蒙版图片')
        }
      }
      return { model: modelId, spec, prompt: gated.prompt, params: gated.params, images, maskPath, notes: localNotes }
    }

    /**
     * 按计划打接口（多张时客户端并发）。
     * @param plan - `prepare` 的结果。
     * @returns 服务端响应体数组。
     */
    const fire = async (plan) => runPool(count, async () => {
      const call = {
        model: plan.model,
        prompt: plan.prompt,
        size: plan.params.size,
        quality: plan.params.quality,
        background: plan.params.background,
        outputFormat: plan.params.outputFormat,
        responseFormat: plan.params.responseFormat,
        images: plan.images,
        mask: plan.maskPath,
      }
      return mode === 'edit'
        ? callEdit(call, settings, exec.signal)
        : callGeneration(call, settings, exec.signal)
    })

    let plan = await prepare(requestedModel)
    let payloads
    try {
      payloads = await fire(plan)
    } catch (error) {
      const message = String(error?.message ?? error)
      const fallback = settings.autoFallback && !explicitModel && /model_not_found/.test(message)
        ? await pickFallback(settings, exec.signal, plan.model)
        : undefined
      if (fallback == null) throw error
      notes.push(`\`${plan.model}\` 在当前账号不可用（model_not_found），已回退到 \`${fallback}\`。`)
      plan = await prepare(fallback)
      payloads = await fire(plan)
    }
    notes.push(...plan.notes)

    const gather = async (list) => {
      const collected = []
      for (const payload of list) {
        const batch = await collectItems(payload, exec.signal)
        collected.push(...batch)
      }
      return collected
    }

    let items
    try {
      items = await gather(payloads)
    } catch (error) {
      const message = String(error?.message ?? error)
      // CDN 不可达时 url 结果拿不到：改用 b64_json 重取一次，别让出图白跑。
      if (plan.params.responseFormat === 'url' && /下载远端结果失败/.test(message)) {
        notes.push('response_format=url 的结果下载不下来（CDN 不可达），已改用 b64_json 重取一次。')
        plan = { ...plan, params: { ...plan.params, responseFormat: undefined } }
        payloads = await fire(plan)
        items = await gather(payloads)
      } else throw error
    }

    const apiFiles = await saveItems(items, {
      cwd,
      outputDir: settings.outputDir,
      mode,
      out: typeof request.out === 'string' ? request.out : undefined,
    })
    // 官逆到不了 4K：给了目标长边就在落盘后接放大链路。
    const targetLongEdge = request.target_long_edge != null
      ? clamp(request.target_long_edge, 0, 8192, 0)
      : settings.upscaleTargetLongEdge
    let files = apiFiles
    if (targetLongEdge > 0) {
      const applied = await upscaleGenerated(apiFiles, {
        targetLongEdge,
        engine: request.upscale ?? settings.upscaleEngine,
        realesrganPath: settings.realesrganPath,
        sharpen: request.sharpen ?? settings.upscaleSharpen,
      })
      files = applied.files
      notes.push(...applied.notes)
    }

    const elapsedMs = Date.now() - started
    const usage = payloads[0]?.usage ?? null
    const requestedSize = plan.params.size ?? null
    const sizeHonored = requestedSize == null || requestedSize === 'auto'
      ? null
      : apiFiles.every((file) => {
        const [width, height] = requestedSize.split('x').map(Number)
        return file.width > 0 && Math.abs(file.width - width) / width <= 0.1
          && Math.abs(file.height - height) / height <= 0.1
      })

    const lines = [
      `${mode === 'edit' ? '改图' : '出图'}完成：${files.length} 张 · ${plan.model} · ${(elapsedMs / 1000).toFixed(1)}s`,
      ...files.map((file, index) => `${index + 1}. ${file.path}（${file.width}×${file.height}，${Math.round(file.bytes / 1024)} KB）`),
    ]
    if (apiFiles.length > count) {
      notes.push(`count 请求 ${count} 张，网关一次返回了 ${apiFiles.length} 张：已全部落盘。`)
    }

    const requestedFormat = plan.params.outputFormat
    if (requestedFormat != null) {
      const expected = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' }[requestedFormat]
      const actual = [...new Set(apiFiles.map((file) => file.mediaType))]
      if (expected != null && !(actual.length === 1 && actual[0] === expected)) {
        const matched = apiFiles.filter((file) => file.mediaType === expected).length
        const others = actual.filter((type) => type !== expected).join(' / ')
        notes.push(matched === 0
          ? `请求 output_format=${requestedFormat}，网关实际返回 ${actual.join(' / ')}：该格式这次没生效，格式与画幅以落盘文件为准。`
          : `请求 output_format=${requestedFormat}，其中 ${apiFiles.length - matched}/${apiFiles.length} 张回落到 ${others}（网关侧抖动），格式与画幅以落盘文件为准。`)
      }
    }

    if (sizeHonored === false) {
      lines.push(`尺寸未按 ${requestedSize} 生效，实际见上图宽高；该通道以出图结果为准。`)
    }
    if (notes.length > 0) lines.push(`说明：\n- ${notes.join('\n- ')}`)
    if (files.some((file) => file.revisedPrompt != null)) {
      lines.push(`重写后的提示词：${files.find((file) => file.revisedPrompt != null).revisedPrompt}`)
    }

    return {
      summary: lines.join('\n'),
      mode,
      model: plan.model,
      requestedSize,
      sizeHonored,
      prompt: plan.prompt,
      files,
      notes,
      usage,
      elapsedMs,
    }
  }

  const commonParameters = (mode) => ({
    type: 'object',
    additionalProperties: false,
    properties: {
      prompt: {
        type: 'string',
        description: mode === 'edit'
          ? '改图指令：改什么、保留什么、风格与光线要求。多图时用「图1/图2」指代输入顺序。'
          : '画面描述：主体、构图、光线、材质、风格。'
          ,
      },
      model: {
        type: 'string',
        description: `模型 id，默认 ${defaultModel}。账号当前可用：${catalog.join(', ')}。${catalogLine}`,
      },
      ...mode === 'edit'
        ? {
          images: {
            type: 'array',
            items: { type: 'string' },
            description: `输入图片路径，1–${MAX_IMAGES} 张，按顺序即「图1/图2」。相对路径按会话工作目录解析。`,
          },
          mask: {
            type: 'string',
            description: '可选蒙版图（PNG 带 alpha），只对第一张输入图生效，走改图接口的 mask 字段。',
          },
        }
        : {},
      size: {
        type: 'string',
        description: '输出尺寸，如 1024x1024、1536x1024、1024x1536、3840x2160；auto 交给服务端。实测该账号按 size 出图。',
      },
      quality: {
        type: 'string',
        enum: QUALITIES,
        description: '画质档。该通道接受但不保证生效（flat 计价），不传即按模型默认。',
      },
      background: {
        type: 'string',
        enum: BACKGROUNDS,
        description: '背景处理；该通道不出透明底（实测 transparent 返回无 alpha），传了会被忽略并说明。',
      },
      output_format: {
        type: 'string',
        enum: OUTPUT_FORMATS,
        description: '输出格式（网关参数名是 output_format）。2.6 系支持 png/jpeg/webp/gif/svg；2.5 与 2 只到 webp，gif/svg 会被拒。gif/svg 不按 size 出图。',
      },
      response_format: {
        type: 'string',
        enum: RESPONSE_FORMATS,
        description: '响应形态：b64_json（默认）或 url（网关返回 CDN 直链，插件下载后落盘）。',
      },
      count: {
        type: 'integer',
        description: `一次出几张，1–${MAX_COUNT}，默认 1。客户端并发，服务端不计 n。`,
      },
      out: {
        type: 'string',
        description: '输出名或路径：纯文件名落到工作目录下的 gpt-image-output/；带目录则按该路径。多张时自动加 -1/-2 后缀。',
      },
      timeoutMs: { type: 'integer', description: `单次请求超时，默认 ${base.timeoutMs}。` },
      target_long_edge: {
        type: 'integer',
        description: '生成后把长边放大到这个像素（如 3840=4K）；0 或省略＝按配置，配置也是 0 就不放大。官逆出不到 4K，靠这一步补齐。',
      },
      upscale: {
        type: 'string',
        enum: UPSCALE_ENGINES,
        description: '放大引擎：auto 按本机能力挑（realesrgan > ffmpeg > pillow > magick > sips）；off 关闭。Lanczos 只补尺寸，Real-ESRGAN 才合成细节。',
      },
      sharpen: {
        type: 'number',
        description: '放大后锐化强度 0–1.5（默认取配置 0.5）：Lanczos 放大偏软，轻度 unsharp 更接近原生 4K。',
      },
    },
    required: mode === 'edit' ? ['prompt', 'images'] : ['prompt'],
  })

  const register = (definition) => ctx.effect(() => ctx.tools.register(definition))

  register({
    name: 'gpt_image_generate',
    description: [
      '文生图：用 GPT Image 官逆通道把提示词画成图片并存到工作目录。用户说画、生成、出图、做海报/插画/封面时用它。',
      `模型清单以账号 /v1/models 为准，当前：${catalog.join(', ')}；默认 ${defaultModel}。`,
      '实测参数面：size 按需生效；output_format 支持 png/jpeg/webp，2.6 系另加 gif/svg（gif/svg 不跟 size）；quality 接受但不保证；transparent 不出透明底；mask 走改图。',
      '默认只出 1 张，用户明确要多张才用 count（≤5）。默认把图片存到工作目录的 gpt-image-output/，纯文件名即可。',
      '要 4K 大图：先按 size 出到原生上限（短边 ≤1536），再传 target_long_edge=3840 走本机放大链路（Lanczos 保真 / Real-ESRGAN 补细节）。',
      '返回每张图的绝对路径与像素尺寸；被丢弃的参数会在 notes 里说明原因。',
    ].join('\n'),
    parameters: commonParameters('gen'),
    output: { schema: OUTPUT_SCHEMA, render: renderResult },
    isConcurrencySafe: () => true,
    presentCall: (args) => ({
      card: 'generic',
      title: `出图 · ${args?.model ?? defaultModel}`,
      kind: 'other',
      rawInput: { prompt: args?.prompt, size: args?.size, count: args?.count },
    }),
    execute: (args, exec) => run(args ?? {}, exec, 'gen'),
  })

  register({
    name: 'gpt_image_edit',
    description: [
      '改图：用 GPT Image 官逆通道按指令编辑、重绘、换风格、融合多张输入图片（≤16 张），并落到工作目录。',
      '改图、修图、换背景、换风格、多图融合、局部重绘都用它；纯文字出图用 gpt_image_generate。',
      'mask 只对第一张图生效，随 /v1/images/edits 的 mask 字段发出；改图建议用 2.6-sunburst 或 2.5-sunburst（编辑精度优先）。',
      '尺寸与参数面同出图：size 生效、quality 不保证、output_format 按模型族限制、透明底无效。返回每张图的绝对路径与像素尺寸。',
    ].join('\n'),
    parameters: commonParameters('edit'),
    output: { schema: OUTPUT_SCHEMA, render: renderResult },
    isConcurrencySafe: () => true,
    presentCall: (args) => ({
      card: 'generic',
      title: `改图 · ${args?.model ?? defaultModel}`,
      kind: 'other',
      rawInput: { prompt: args?.prompt, images: args?.images, count: args?.count },
    }),
    execute: (args, exec) => run(args ?? {}, exec, 'edit'),
  })

  register({
    name: 'gpt_image_upscale',
    description: [
      '把已有图片放大到目标长边或倍数，补上「官逆出不到 4K」这个缺口。',
      '引擎：realesrgan（AI，补细节，需装 realesrgan-ncnn-vulkan）> ffmpeg（真 Lanczos3，无幻觉）> pillow（Lanczos）> magick（ImageMagick -resize/-unsharp）> sips（仅 macOS）。auto 按本机能力挑，macOS / Windows / Linux 同一套逻辑。',
      '注意：sharp 不在候选里——它放大时 lanczos3 会退化成 cubic，等于只是双三次插值。SVG 矢量与 GIF 动图默认跳过。',
      '倍数上限 4×；要更大先按更大 size 重新出图再放大。',
    ].join('\n'),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string', description: '输入图片路径（相对路径按会话工作目录解析）。' },
        target_long_edge: { type: 'integer', description: '目标长边像素，如 3840（4K）。' },
        factor: { type: 'number', description: '或按倍数放大（1–4），与 target_long_edge 二选一。' },
        engine: { type: 'string', enum: UPSCALE_ENGINES, description: '放大引擎，默认取配置。' },
        sharpen: { type: 'number', description: 'Lanczos 放大后的锐化强度 0–1.5，默认取配置（0.5）。' },
        out: { type: 'string', description: '输出路径；省略则与原文件同目录、文件名加 @长边。' },
      },
      required: ['path'],
    },
    output: { schema: OUTPUT_SCHEMA, render: renderResult },
    isConcurrencySafe: () => true,
    presentCall: (args) => ({ card: 'generic', title: `放大 · ${args?.target_long_edge ?? args?.factor ?? 'auto'}`, kind: 'other' }),
    async execute(args, exec) {
      const settings = resolveSettings(readConfig(config), args)
      const cwd = await cwdOf(exec)
      const target = isAbsolute(args.path) ? args.path : resolve(cwd, args.path)
      try {
        await access(target)
      } catch {
        throw new Error(`输入图片不存在：${target}`)
      }
      const out = typeof args.out === 'string' && args.out.trim() !== ''
        ? (isAbsolute(args.out) ? args.out : resolve(cwd, args.out))
        : undefined
      const result = await upscaleImage({
        path: target,
        targetLongEdge: args.target_long_edge,
        factor: args.factor,
        engine: args.engine ?? settings.upscaleEngine,
        out,
        realesrganPath: settings.realesrganPath,
        sharpen: args.sharpen ?? settings.upscaleSharpen,
      })
      if (result.skipped) {
        return { summary: `未放大：${result.reason}\n路径：${result.path}`, skipped: true, ...result }
      }
      return {
        summary: [
          `放大完成：${result.width}×${result.height}（${result.factor}×，引擎 ${result.engine}）`,
          `${result.path}（${Math.round((result.bytes ?? 0) / 1024)} KB）`,
          result.notes.length > 0 ? `说明：\n- ${result.notes.join('\n- ')}` : '',
        ].filter((line) => line !== '').join('\n'),
        ...result,
      }
    },
  })

  register({
    name: 'gpt_image_config',
    description: [
      '查看或修改 GPT Image 插件配置（base_url / api_key / models / 默认模型 / 产物目录 / 超时），并列出账号实际可用的模型。',
      'action="show" 看当前生效配置（密钥打码）；action="models" 拉取 base_url 上的 /v1/models 图片模型清单；action="set" 写入配置并热重载。',
      '出图报 model_not_found 或 401 时先用它查证，再换模型或换密钥。',
    ].join('\n'),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['show', 'models', 'set'], description: '读取、列模型、或写入配置。' },
        baseUrl: { type: 'string', description: 'set 时：服务地址，如 https://example.com。' },
        apiKey: { type: 'string', description: 'set 时：API 密钥。' },
        models: { type: 'array', items: { type: 'string' }, description: 'set 时：允许的模型清单；留空表示以 /v1/models 为准。' },
        defaultModel: { type: 'string', description: 'set 时：默认模型 id。' },
        outputDir: { type: 'string', description: 'set 时：产物目录（相对工作目录）。' },
        timeoutMs: { type: 'integer', description: 'set 时：单次请求超时毫秒。' },
      },
      required: ['action'],
    },
    output: { schema: OUTPUT_SCHEMA, render: renderResult },
    isConcurrencySafe: () => true,
    presentCall: (args) => ({ card: 'generic', title: `图片接口配置 · ${args?.action ?? 'show'}`, kind: 'other' }),
    async execute(args, exec) {
      const action = String(args?.action ?? 'show')
      const settings = resolveSettings(readConfig(config), {})
      const effective = await resolveCatalog(settings, exec.signal)

      if (action === 'show') {
        const current = publicSettings({ ...settings, models: effective })
        return {
          summary: [
            '当前 GPT Image 配置：',
            `- base_url：${current.baseUrl}`,
            `- api_key：${current.apiKey}（${current.apiKeyConfigured ? '已配置' : '未配置'}）`,
            `- 默认模型：${settings.defaultModel}`,
            `- 模型来源：${settings.models.length > 0 ? '插件配置 models' : '账号 /v1/models'}`,
            `- 模型清单：\n${describeModels(effective, settings.defaultModel)}`,
            `- 产物目录：${current.outputDir}`,
            `- 超时：${current.timeoutMs}ms`,
            `- 自动回退：${settings.autoFallback ? '开' : '关'}`,
          ].join('\n'),
          settings: current,
        }
      }

      if (action === 'models') {
        if (settings.apiKey === '') throw new Error('缺少 api_key，无法列模型')
        const ids = await listAccountModels(settings, exec.signal)
        const image = ids.filter((id) => /image/i.test(id) && !/^auto$/i.test(id))
        const missing = settings.models.filter((id) => !ids.includes(id))
        return {
          summary: [
            `${endpointUrl(settings.baseUrl, '/models')} 返回 ${ids.length} 个模型，其中图片模型 ${image.length} 个：`,
            image.length > 0 ? image.map((id) => `- ${id}`).join('\n') : '（没有 image 字样的模型）',
            missing.length > 0
              ? `注意：配置里的 ${missing.join(', ')} 不在该账号清单内，调用会报 model_not_found。`
              : '配置清单与账号清单一致。',
            '全部模型：' + ids.join(', '),
          ].join('\n'),
          models: ids,
          imageModels: image,
          missing,
        }
      }

      if (action !== 'set') throw new Error(`未知 action：${action}（show / models / set）`)

      const editor = ctx.get('configEditor')
      const entry = ctx.fiber?.entry
      if (editor == null || entry == null) {
        throw new Error('当前 profile 没有可用的 configEditor：请直接改 profile 的 cordis.patch.yml 里 gpt-image 行的 config。')
      }
      const patch = {}
      if (typeof args.baseUrl === 'string' && args.baseUrl.trim() !== '') patch.baseUrl = args.baseUrl.trim()
      if (typeof args.apiKey === 'string' && args.apiKey.trim() !== '') patch.apiKey = args.apiKey.trim()
      if (Array.isArray(args.models)) {
        patch.models = args.models.map((id) => String(id).trim()).filter((id) => id !== '')
      }
      if (typeof args.defaultModel === 'string' && args.defaultModel.trim() !== '') patch.defaultModel = args.defaultModel.trim()
      if (typeof args.outputDir === 'string' && args.outputDir.trim() !== '') patch.outputDir = args.outputDir.trim()
      if (args.timeoutMs != null) patch.timeoutMs = clamp(args.timeoutMs, 1000, 3_600_000, settings.timeoutMs)
      if (Object.keys(patch).length === 0) throw new Error('set 需要至少一个字段：baseUrl / apiKey / models / defaultModel / outputDir / timeoutMs')

      await editor.edit(entry, (current) => ({ ...current, ...patch }))
      const next = resolveSettings(readConfig(config), patch)
      const shown = publicSettings({ ...next, models: next.models.length > 0 ? next.models : effective })
      return {
        summary: [
          '配置已写入 profile 并热重载：',
          `- base_url：${shown.baseUrl}`,
          `- api_key：${shown.apiKey}`,
          `- 默认模型：${shown.defaultModel}`,
          `- 模型清单：${shown.models.join(', ') || '（以 /v1/models 为准）'}`,
          `- 产物目录：${shown.outputDir}`,
          `- 超时：${shown.timeoutMs}ms`,
        ].join('\n'),
        settings: shown,
      }
    },
  })

  // 只有在真实 cordis Context 上才注册子上下文；测试用的假 ctx 跳过这一段。
  if (typeof ctx.inject === 'function') {
    const entry = ctx.fiber?.entry
    ctx.inject(['webServer'], (host) => {
      host.effect(() => registerRoutes(host.webServer, {
        config,
        entry,
        settings: ctx.get('settings'),
        editor: ctx.get('configEditor'),
      }), 'gpt-image: settings routes')
    })

    ctx.inject(['settings'], (scoped) => {
      // 本插件自带设置页，关掉自动生成页以免出现空壳表单。
      scoped.effect(() => scoped.settings.configure({ auto: false }, ctx.fiber), 'gpt-image: settings policy')
    })
  }
}