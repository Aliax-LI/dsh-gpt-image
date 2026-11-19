/**
 * 模型目录与逐模型参数闸门。
 *
 * 清单以账号 `GET /v1/models` 为准（本插件不维护自己的模型白名单）；下面这张表只标注
 * 「这个模型实际吃什么参数」。能力标注来自 2026-11-19 对 `https://sub2api.e2mai3lzz.top`
 * 的实测，不是从型号名字猜的：
 *
 * - `size`：实测 `1536x1024` / `1024x1536` 原样生效，收。
 * - `quality`：传 `xhigh` / `low` 都不报错，但官逆 flat 计价下无法验证画质差异，属"收但不保证"。
 * - 输出格式：参数名是 **`output_format`**，不是 `format`——`format` 连 `bogus` 都被静默忽略。
 *   实测 `output_format`：2.6 系三家（png/jpeg/webp/gif/svg）全开；2.5 与 2 只开
 *   png/jpeg/webp，`gif` / `svg` 直接 400（`GIF/SVG output is not enabled for this image model`）。
 *   `gif` / `svg` 出图不按 `size`（实测 1024x1024 请求得到 437×384 gif、1200×900 svg）。
 * - `background`：传 `transparent` 返回的 PNG 是 colorType 2（无 alpha），不出透明底，所以不发。
 * - `response_format`：`url` 生效（返回 CDN 直链），插件会下载后落盘。
 * - `mask`：改图接口接受 mask 字段（见 `MASK_SUPPORT`）。
 *
 * 目录外的模型一律走透传：调用方给什么就发什么，报错按网关为准。
 * @module gpt-image/lib/models
 */

/** 缺省模型：2.6 官逆，flare 较快，出图与批量优先。 */
export const DEFAULT_MODEL = 'gpt-image-2.6-flare'

/** `/v1/models` 里出现过的图片模型快照（拉不到实时清单时的兜底）。 */
export const KNOWN_MODELS = [
  'gpt-image-2.6-flare',
  'gpt-image-2.6-sunburst',
  'gpt-image-2.5-flare',
  'gpt-image-2.5-sunburst',
  'gpt-image-2.5',
  'gpt-image-2',
]

/** 别名 → 真实模型 id。 */
export const MODEL_ALIASES = {}

/** 实测：2.6 系全开；2.5 / 2 只到 webp，gif 与 svg 报 400。 */
const ALL_FORMATS = ['png', 'jpeg', 'webp', 'gif', 'svg']

/** 实测：改图接口接受 mask 字段（`exact` = 按蒙版区改，`whole` = 只整图重绘）。 */
const MASK_SUPPORT = 'exact'

/** 型号族说明，用于给模型看的目录文案。 */
const FAMILIES = [
  { match: /sunburst$/, label: 'sunburst', note: '编辑精度优先：改图、多图融合、按蒙版修首选' },
  { match: /flare$/, label: 'flare', note: '速度优先：日常出图、批量草图' },
  { match: /^gpt-image-2\.6$/, label: '2.6 官逆', note: '2.6 主线' },
  { match: /^gpt-image-2\.5$/, label: '2.5 官逆', note: '2.5 基础档' },
  { match: /^gpt-image-2$/, label: '2 官逆', note: '上一代，参数面最窄' },
  { match: /^gpt-image-/, label: '官逆', note: '' },
]

/**
 * 解析模型 id（含别名）到能力表。
 * @param model - 模型 id。
 * @returns 能力表；目录外的模型返回透传策略。
 */
export function modelSpec(model) {
  const id = MODEL_ALIASES[model] ?? model
  const family = FAMILIES.find((item) => item.match.test(id))
  const known = KNOWN_MODELS.includes(id)
  if (!known && family == null) {
    return {
      id,
      label: '目录外模型（参数透传）',
      note: '不在 /v1/models 快照里：不裁剪参数，失败按网关报错为准。',
      size: true,
      quality: true,
      outputFormats: [...ALL_FORMATS],
      background: true,
      mask: MASK_SUPPORT,
      known: false,
    }
  }
  const is26 = /^gpt-image-2\.6/.test(id)
  return {
    id,
    label: family?.label ?? '图片模型',
    note: family?.note ?? '',
    size: true,
    quality: 'accepted',
    outputFormats: is26 ? [...ALL_FORMATS] : ['png', 'jpeg', 'webp'],
    background: false,
    mask: MASK_SUPPORT,
    known,
  }
}

/**
 * 归一化模型清单：去空、去重；空清单保持为空，表示"以 /v1/models 为准"。
 * @param value - 配置或工具参数里的模型清单。
 * @param fallback - 清单为空或非法时的回落值。
 * @returns 归一化后的数组。
 */
export function normalizeModels(value, fallback = KNOWN_MODELS) {
  if (!Array.isArray(value)) return [...fallback]
  const seen = new Set()
  const out = []
  for (const raw of value) {
    if (typeof raw !== 'string') continue
    const id = raw.trim()
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/**
 * 生成给模型看的模型目录说明。
 * @param models - 当前可用模型清单。
 * @param defaultModel - 默认模型 id。
 * @returns 多行文本。
 */
export function describeModels(models, defaultModel) {
  return models.map((id) => {
    const spec = modelSpec(id)
    const mark = id === defaultModel ? '（默认）' : spec.known ? '' : '（目录外）'
    const caps = [
      spec.size ? 'size' : '',
      spec.quality === 'accepted' ? 'quality（收但不保证生效）' : spec.quality ? 'quality' : '',
      `output_format: ${spec.outputFormats.join('/')}`,
      spec.mask === 'exact' ? 'mask 局部重绘' : spec.mask === 'whole' ? 'mask 整图重绘' : '',
    ].filter((item) => item !== '')
    return `- \`${id}\`${mark} ${spec.label}${spec.note === '' ? '' : ` · ${spec.note}`} · 接受：${caps.join(' / ')}`
  }).join('\n')
}