/**
 * 插件配置：字段全部 `.volatile()`，所以设置页改完即时生效、不重启插件。
 *
 * 为什么不是普通字段：dsh 的 Settings 只投影 volatile 字段（见 `@deepseek-ai/dsh-settings`），
 * 而 base_url / api_key 这类值改了没必要重启整个插件。
 * @module gpt-image/lib/config
 */
import z from '@deepseek-ai/schemastery'

import { DEFAULT_BASE_URL, DEFAULT_OUTPUT_DIR, DEFAULT_TIMEOUT_MS } from './api.js'
import { DEFAULT_MODEL, KNOWN_MODELS } from './models.js'
import { UPSCALE_ENGINES } from './upscale.js'

/** 缺省值，设置页与工具描述都从这里取。 */
export const DEFAULTS = {
  baseUrl: DEFAULT_BASE_URL,
  apiKey: '',
  defaultModel: DEFAULT_MODEL,
  models: [],
  outputDir: DEFAULT_OUTPUT_DIR,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  bodyStallMs: 30000,
  autoFallback: true,
  upscaleEngine: 'auto',
  upscaleTargetLongEdge: 0,
  upscaleSharpen: 0.5,
  realesrganPath: '',
  sizeHintInPrompt: true,
}

const engineSchema = z.union(
  UPSCALE_ENGINES.map((value) => z.const(value)),
)

/** 插件行配置 schema。 */
export const Config = z.object({
  baseUrl: z.string().description('OpenAI 兼容接口地址（不含 /v1 也可）').default(DEFAULTS.baseUrl).volatile(),
  apiKey: z.string().role('secret').description('接口密钥').default(DEFAULTS.apiKey).volatile(),
  defaultModel: z.string().description('默认模型 id').default(DEFAULTS.defaultModel).volatile(),
  models: z.array(z.string()).description('固定模型清单；留空表示以账号 /v1/models 为准').default(DEFAULTS.models).volatile(),
  outputDir: z.string().description('产物目录（相对工作目录）').default(DEFAULTS.outputDir).volatile(),
  timeoutMs: z.number().step(1).min(1000).max(3_600_000).description('单次请求超时（毫秒）').default(DEFAULTS.timeoutMs).volatile(),
  bodyStallMs: z.number().step(1000).min(3000).max(600000).description('响应体多久没有新数据就判失败（毫秒）').default(DEFAULTS.bodyStallMs).volatile(),
  autoFallback: z.boolean().description('默认模型不可用时自动换一个账号可用模型').default(DEFAULTS.autoFallback).volatile(),
  upscaleEngine: engineSchema.description('放大引擎：auto / realesrgan / ffmpeg / pillow / sips / off').default(DEFAULTS.upscaleEngine).volatile(),
  upscaleTargetLongEdge: z.number().step(1).min(0).max(8192).description('生成后自动放大的目标长边像素；0 = 不自动放大').default(DEFAULTS.upscaleTargetLongEdge).volatile(),
  upscaleSharpen: z.number().min(0).max(1.5).description('Lanczos 放大后的锐化强度（0 = 关；0.5 默认）').default(DEFAULTS.upscaleSharpen).volatile(),
  realesrganPath: z.string().description('realesrgan-ncnn-vulkan 可执行文件路径（留空用 PATH）').default(DEFAULTS.realesrganPath).volatile(),
  sizeHintInPrompt: z.boolean().description('模型不收 size 时把画幅写进提示词').default(DEFAULTS.sizeHintInPrompt).volatile(),
})

const read = (field, fallback) => {
  const value = field != null && typeof field.get === 'function' ? field.get() : field
  if (value === undefined || value === null) return fallback
  if (typeof value === 'string' && value.trim() === '' && fallback !== '') return fallback
  return value
}

/**
 * 把（可能是 volatile 引用的）配置读成普通对象。
 * @param raw - `apply(ctx, config)` 收到的配置。
 * @returns 普通对象，字段齐全。
 */
export function readConfig(raw = {}) {
  const models = read(raw.models, DEFAULTS.models)
  return {
    baseUrl: read(raw.baseUrl, DEFAULTS.baseUrl),
    apiKey: read(raw.apiKey, DEFAULTS.apiKey),
    defaultModel: read(raw.defaultModel, DEFAULTS.defaultModel),
    models: Array.isArray(models) ? models.filter((id) => typeof id === 'string' && id.trim() !== '') : [],
    outputDir: read(raw.outputDir, DEFAULTS.outputDir),
    timeoutMs: Number(read(raw.timeoutMs, DEFAULTS.timeoutMs)),
    bodyStallMs: Number(read(raw.bodyStallMs, DEFAULTS.bodyStallMs)),
    autoFallback: read(raw.autoFallback, DEFAULTS.autoFallback) !== false,
    upscaleEngine: read(raw.upscaleEngine, DEFAULTS.upscaleEngine),
    upscaleTargetLongEdge: Number(read(raw.upscaleTargetLongEdge, DEFAULTS.upscaleTargetLongEdge)),
    upscaleSharpen: Number(read(raw.upscaleSharpen, DEFAULTS.upscaleSharpen)),
    realesrganPath: read(raw.realesrganPath, DEFAULTS.realesrganPath),
    sizeHintInPrompt: read(raw.sizeHintInPrompt, DEFAULTS.sizeHintInPrompt) !== false,
  }
}

/**
 * 供设置页展示的字段元信息。
 * @returns 字段描述数组。
 */
export function describeFields() {
  return [
    { key: 'baseUrl', label: '接口地址', kind: 'text', hint: 'OpenAI 兼容 base_url，含 /v1 与否都可以' },
    { key: 'apiKey', label: 'API Key', kind: 'secret', hint: '留空表示保持已存密钥' },
    { key: 'defaultModel', label: '默认模型', kind: 'model', hint: `账号清单为空时退回 ${KNOWN_MODELS[0]}` },
    { key: 'models', label: '固定模型清单', kind: 'list', hint: '留空 = 以账号 /v1/models 为准' },
    { key: 'outputDir', label: '产物目录', kind: 'text', hint: '相对会话工作目录' },
    { key: 'timeoutMs', label: '请求超时(ms)', kind: 'number' },
    { key: 'autoFallback', label: '模型自动回退', kind: 'boolean' },
    { key: 'upscaleEngine', label: '放大引擎', kind: 'engine', hint: 'auto 按本机能力挑最好的' },
    { key: 'upscaleTargetLongEdge', label: '生成后自动放大到长边(px)', kind: 'number', hint: '0 = 不自动放大；如 3840 = 4K' },
    { key: 'upscaleSharpen', label: '放大后锐化', kind: 'number', hint: '0–1.5，Lanczos 放大偏软，0.5 较自然' },
    { key: 'realesrganPath', label: 'Real-ESRGAN 路径', kind: 'text', hint: '留空则在 PATH 里找 realesrgan-ncnn-vulkan' },
    { key: 'sizeHintInPrompt', label: '画幅写入提示词', kind: 'boolean' },
  ]
}