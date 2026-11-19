/**
 * 放大链路：官逆出图天然到不了 4K，这里把结果推到目标长边。
 *
 * 引擎取舍（依据引擎能力与官方文档，不按直觉）：
 * - `ffmpeg`：`scale=…:flags=lanczos` 是**真 Lanczos3**，放大不退化；无外部依赖时首选。
 * - `pillow`：`Image.LANCZOS`（Pillow 的 Lanczos 重采样），与 ffmpeg 同族，输出略有差异。
 * - `magick`：ImageMagick 的 `-resize ... -unsharp`，macOS / Windows / Linux 都能装。
 * - `sips`：仅 macOS 自带（CoreGraphics 重采样），没有 ffmpeg / Pillow / ImageMagick 时兜底。
 *
 * 平台探测全部走纯 Node（扫 PATH + PATHEXT），不依赖 `which`／`where`，所以
 * macOS、Windows、Linux 同一套代码都能跑；命令一律用解析出的绝对路径 spawn。
 * - `realesrgan`：Real-ESRGAN（ncnn-vulkan 可执行文件或 Python 版）会**合成新细节**，
 *   2–4 倍观感最好，但需要额外装模型；装了才自动启用。
 *
 * Lanczos 只做重采样，放大后偏软；默认在重采样后加一道轻度 unsharp（scharr 无，5×5 高斯）
 * 把锐度拉回接近原生 4K 的观感，`sharpen` 为 0 时关闭。
 *
 * 注意 sharp 不在候选里：它的文档写明 "When upsampling, these kernels map to
 * nearest, linear and cubic interpolators"，`lanczos3` / `mks2021` 放大时都退化成 cubic。
 * @module gpt-image/lib/upscale
 */
import { spawn } from 'node:child_process'
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'

import { extensionOf, imageSize, sniffMediaType } from './image.js'

/** 放大引擎清单，`auto` 表示探测后挑最好的。 */
export const UPSCALE_ENGINES = ['auto', 'realesrgan', 'ffmpeg', 'pillow', 'magick', 'sips', 'off']

/** 每个平台实际可用的引擎候选（顺序即优先级，auto 取第一个可用的）。 */
export function engineCatalog(platform = process.platform) {
  const shared = ['realesrgan', 'ffmpeg', 'pillow', 'magick']
  return platform === 'darwin' ? [...shared, 'sips'] : shared
}

/** 单次放大的倍数上限：再高只会糊，不如重新出图。 */
const MAX_FACTOR = 4

const run = (command, args, options = {}) => new Promise((resolve) => {
  let child
  try {
    child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options })
  } catch (error) {
    resolve({ ok: false, stdout: '', stderr: String(error?.message ?? error) })
    return
  }
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk) => { stdout += chunk })
  child.stderr?.on('data', (chunk) => { stderr += chunk })
  child.on('error', (error) => resolve({ ok: false, stdout, stderr: String(error?.message ?? error) }))
  child.on('close', (code) => resolve({ ok: code === 0, stdout, stderr }))
})

const exists = async (path) => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * 在 PATH 里找可执行文件：纯 Node 实现，Windows 上按 PATHEXT 补扩展名。
 * @param command - 命令名（不带扩展名）。
 * @param options - `{ platform, pathEnv, exts }`，测试可注入。
 * @returns 绝对路径或 `undefined`。
 */
export async function resolveExecutable(command, options = {}) {
  const platform = options.platform ?? process.platform
  const pathEnv = options.pathEnv ?? process.env.PATH ?? ''
  const separator = platform === 'win32' ? ';' : ':'
  const exts = platform === 'win32'
    ? (options.exts ?? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')).split(';').filter(Boolean)
    : ['']
  const names = platform === 'win32' && /\.(exe|cmd|bat|com)$/i.test(command)
    ? [command]
    : exts.map((ext) => (ext === '' ? command : `${command}${ext.toLowerCase()}`))
  for (const dir of pathEnv.split(separator).filter((item) => item !== '')) {
    for (const name of names) {
      const candidate = join(dir.replace(/^"|"$/g, ''), name)
      if (await exists(candidate)) return candidate
    }
  }
  return undefined
}

const which = (command) => resolveExecutable(command)

/** 探测结果缓存：探测涉及 spawn，别每次出图都跑一遍。 */
let probeCache

/**
 * 探测本机可用的放大引擎。
 * @param overrides - `{ realesrganPath }` 来自配置的显式路径。
 * @returns `{ engines, preferred, python, notes }`。
 */
export async function probeEngines(overrides = {}) {
  const cacheKey = JSON.stringify(overrides)
  if (probeCache != null && probeCache.key === cacheKey && Date.now() - probeCache.at < 5 * 60_000) {
    return probeCache.value
  }
  const notes = []
  const engines = []

  const realesrganPath = overrides.realesrganPath
    ?? process.env.GPT_IMAGE_REALESRGAN
    ?? await which('realesrgan-ncnn-vulkan')
  if (realesrganPath != null && realesrganPath !== '' && await exists(realesrganPath)) {
    engines.push('realesrgan')
  } else {
    notes.push('未找到 realesrgan-ncnn-vulkan：AI 放大不启用（Lanczos 只补尺寸，不合成细节）。')
  }

  const ffmpeg = await which('ffmpeg')
  if (ffmpeg != null) engines.push('ffmpeg')
  else notes.push('未找到 ffmpeg：改用 Pillow / ImageMagick / sips 做重采样放大。')

  // Windows 上 Python 通常是 python 而不是 python3。
  const python = await which('python3') ?? await which('python')
  let pillow = false
  if (python != null) {
    const probe = await run(python, ['-c', 'import PIL; print(PIL.__version__)'])
    pillow = probe.ok
  }
  if (pillow) engines.push('pillow')

  if (await which('magick') != null) engines.push('magick')

  if (process.platform === 'darwin' && await exists('/usr/bin/sips')) engines.push('sips')

  const preferred = engines[0] ?? 'off'
  const value = {
    engines,
    preferred,
    catalog: engineCatalog(),
    platform: process.platform,
    python: pillow ? python : undefined,
    realesrganPath,
    notes,
  }
  probeCache = { key: cacheKey, at: Date.now(), value }
  return value
}

const engineFor = async (requested, overrides) => {
  const probe = await probeEngines(overrides)
  if (requested === 'off') return { engine: 'off', probe }
  if (requested === 'auto' || requested == null || requested === '') {
    return { engine: probe.preferred, probe }
  }
  if (!probe.engines.includes(requested)) {
    return { engine: probe.preferred, probe, fallbackFrom: requested }
  }
  return { engine: requested, probe }
}

/**
 * 把一张图放大到目标长边或指定倍数。
 * @param request - `{ path, targetLongEdge?, factor?, engine?, out?, quality? }`。
 * @returns 放大结果记录。
 */
export async function upscaleImage(request) {
  const source = request.path
  const bytes = await readFile(source)
  const mediaType = sniffMediaType(bytes) ?? 'image/png'
  const size = imageSize(bytes)
  const factor = request.factor != null ? Number(request.factor) : undefined
  const target = request.targetLongEdge != null ? Number(request.targetLongEdge) : undefined

  if (mediaType === 'image/svg+xml') {
    return { skipped: true, reason: 'SVG 是矢量，天然无损，不需要放大。', path: source, mediaType }
  }
  if (mediaType === 'image/gif') {
    return { skipped: true, reason: 'GIF（可能是动图）不做逐帧放大，避免丢帧。', path: source, mediaType }
  }
  if (size.width < 1 || size.height < 1) {
    return { skipped: true, reason: '读不到像素尺寸，跳过放大。', path: source, mediaType }
  }

  if (factor != null && factor > MAX_FACTOR) {
    throw new Error(`放大倍数 ${factor}× 超过上限 ${MAX_FACTOR}×：先按更大 size 重新出图，再放大。`)
  }
  const longEdge = Math.max(size.width, size.height)
  const wanted = target != null && target > longEdge
    ? target
    : factor != null && factor > 1
      ? Math.min(Math.round(longEdge * factor), Math.round(longEdge * MAX_FACTOR))
      : undefined

  if (wanted == null) {
    return {
      skipped: true,
      reason: `当前已经 ${size.width}×${size.height}，不短于目标，无需放大。`,
      path: source,
      mediaType,
      width: size.width,
      height: size.height,
    }
  }

  const actualFactor = wanted / longEdge
  if (actualFactor > MAX_FACTOR) {
    throw new Error(`放大倍数 ${actualFactor.toFixed(2)}× 超过上限 ${MAX_FACTOR}×：先按更大 size 重新出图，再放大。`)
  }

  const scale = wanted / longEdge
  const width = Math.round(size.width * scale)
  const height = Math.round(size.height * scale)
  const extension = extensionOf(mediaType)
  const out = request.out ?? `${source.slice(0, source.length - extname(source).length)}@${wanted}.${extension}`

  const sharpen = request.sharpen == null ? 0.5 : Math.max(0, Math.min(1.5, Number(request.sharpen)))
  const { engine, probe, fallbackFrom } = await engineFor(request.engine, { realesrganPath: request.realesrganPath })
  const notes = []
  if (fallbackFrom != null) {
    notes.push(`请求的 ${fallbackFrom} 不可用，改用 ${engine}。`)
  }

  const record = { engine: engine === 'off' ? 'none' : engine, source, out, width, height, factor: Number(scale.toFixed(3)), mediaType, sharpen, notes }

  if (engine === 'off') {
    return { ...record, skipped: true, reason: '放大引擎关闭（或本机没有可用引擎）。', path: source }
  }

  await mkdir(dirname(out), { recursive: true })
  if (engine === 'realesrgan') {
    const result = await run(probe.realesrganPath, ['-i', source, '-o', out, '-s', '4', '-n', 'realesrgan-x4plus'])
    if (!result.ok) {
      notes.push(`Real-ESRGAN 失败（${result.stderr.trim().slice(0, 160)}），回退 ffmpeg Lanczos。`)
      const fallback = probe.engines.find((name) => name !== 'realesrgan') ?? 'off'
      const ffmpeg = fallback
      const retry = await renderWith(ffmpeg, { source, out, width, height, probe, mediaType, sharpen })
      if (!retry.ok) throw new Error(`Real-ESRGAN 与 ${ffmpeg} 都失败：${retry.stderr.slice(0, 200)}`)
      record.engine = ffmpeg
    }
  } else {
    const result = await renderWith(engine, { source, out, width, height, probe, mediaType, sharpen })
    if (!result.ok) throw new Error(`${engine} 放大失败：${result.stderr.trim().slice(0, 240)}`)
  }

  const resultBytes = await readFile(out).catch(() => null)
  const resultSize = resultBytes == null ? { width: 0, height: 0 } : imageSize(resultBytes)
  return {
    ...record,
    path: out,
    bytes: resultBytes?.length ?? 0,
    width: resultSize.width || width,
    height: resultSize.height || height,
    skipped: false,
  }
}

/**
 * 用具体引擎写出一张放大图。
 * @param engine - `ffmpeg` / `pillow` / `magick` / `sips`。
 * @param job - `{ source, out, width, height, probe, mediaType }`。
 * @returns spawn 结果。
 */
async function renderWith(engine, job) {
  if (engine === 'ffmpeg') {
    const ffmpeg = await which('ffmpeg')
    const amount = Number(job.sharpen ?? 0)
    // 先 Lanczos 重采样，再轻度 unsharp 找回锐度；sharpen=0 时只有重采样。
    const filter = amount > 0
      ? `scale=${job.width}:${job.height}:flags=lanczos,unsharp=5:5:${amount.toFixed(2)}:5:5:0`
      : `scale=${job.width}:${job.height}:flags=lanczos`
    return run(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', job.source,
      '-vf', filter,
      job.out,
    ])
  }
  if (engine === 'pillow') {
    const script = [
      'import sys',
      'from PIL import Image',
      'src, dst, w, h = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])',
      'im = Image.open(src)',
      'im = im.convert("RGBA") if im.mode in ("RGBA", "LA", "P") else im.convert("RGB")',
      'im = im.resize((w, h), Image.LANCZOS)',
      'amount = float(sys.argv[5])',
      'if amount > 0:',
      '    from PIL import ImageFilter',
      '    im = im.filter(ImageFilter.UnsharpMask(radius=1.6, percent=int(amount * 120), threshold=2))',
      'im.save(dst)',
    ].join('\n')
    return run(job.probe.python ?? 'python3', ['-c', script, job.source, job.out, String(job.width), String(job.height), String(job.sharpen ?? 0)])
  }
  if (engine === 'magick') {
    const magick = await which('magick')
    const args = [job.source, '-resize', `${job.width}x${job.height}!`]
    if (Number(job.sharpen ?? 0) > 0) args.push('-unsharp', `0x1+${Number(job.sharpen).toFixed(2)}+0`)
    args.push(job.out)
    return run(magick, args)
  }
  if (engine === 'sips') {
    const sips = await which('sips') ?? '/usr/bin/sips'
    return run(sips, ['-z', String(job.height), String(job.width), job.source, '--out', job.out])
  }
  return { ok: false, stdout: '', stderr: `未知引擎 ${engine}` }
}

/**
 * 生成后自动放大：只在给了目标长边且当前不够大时动手。
 * @param files - 落盘记录数组。
 * @param options - `{ targetLongEdge, engine, realesrganPath }`。
 * @returns `{ files, notes }`，files 里被放大的条目会换成新路径。
 */
export async function upscaleGenerated(files, options) {
  if (options?.targetLongEdge == null && options?.engine !== 'realesrgan') return { files, notes: [] }
  const target = options.targetLongEdge
  const notes = []
  const out = []
  for (const file of files) {
    try {
      const result = await upscaleImage({
        path: file.path,
        targetLongEdge: target,
        engine: options.engine ?? 'auto',
        realesrganPath: options.realesrganPath,
        sharpen: options.sharpen,
      })
      if (result.skipped) {
        notes.push(`${basename(file.path)}：${result.reason}`)
        out.push(file)
        continue
      }
      notes.push(`${basename(file.path)} → ${basename(result.path)}（${file.width}×${file.height} → ${result.width}×${result.height}，${result.engine}）`)
      out.push({
        ...file,
        path: result.path,
        bytes: result.bytes,
        width: result.width,
        height: result.height,
        upscaledFrom: { path: file.path, width: file.width, height: file.height, engine: result.engine },
      })
    } catch (error) {
      notes.push(`${basename(file.path)} 放大失败：${String(error?.message ?? error)}`)
      out.push(file)
    }
  }
  return { files: out, notes }
}

/**
 * 把放大后的字节写盘（供测试与外部调用复用）。
 * @param path - 目标路径。
 * @param bytes - 文件字节。
 * @returns 写入的路径。
 */
export async function writeBytes(path, bytes) {
  await writeFile(path, bytes)
  return path
}

/**
 * 报告本机放大能力，供设置页与 `gpt_image_upscale` 的 info 使用。
 * @param overrides - `{ realesrganPath }`。
 * @returns 探测结果。
 */
export async function upscaleStatus(overrides = {}) {
  const probe = await probeEngines(overrides)
  return {
    engines: probe.engines,
    preferred: probe.preferred,
    catalog: probe.catalog ?? engineCatalog(probe.platform),
    platform: probe.platform ?? process.platform,
    python: probe.python ?? null,
    realesrgan: probe.realesrganPath ?? null,
    notes: probe.notes,
  }
}

export { MAX_FACTOR, stat }