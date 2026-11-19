/**
 * 客户端半的结构测试：不启浏览器，只验证模块契约与「没有说明书式文案」。
 *
 * `node tests/client.test.mjs`
 */
import { readFile } from 'node:fs/promises'

const rows = []
const check = (name, ok, detail = '') => {
  rows.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${detail}`}`)
}

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')

// --- 1. 模块契约 -----------------------------------------------------------
let captured
globalThis.window = { __ModuleLoader__: { load: (mod) => { captured = mod } } }
const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
}
await import(new URL('../client.js', import.meta.url).href)
  .catch((error) => check('client.js 可导入', false, error.message))

check('模块 id 正确', captured?.id === '@local/dsh-gpt-image', String(captured?.id))
const exported = captured?.factory((name) => {
  if (name === 'react') return React
  throw new Error(`unexpected require ${name}`)
})
check('导出 inject/apply', typeof exported?.apply === 'function' && Array.isArray(exported?.inject), (exported?.inject ?? []).join(','))
check('inject 含 slots 与 locale', ['slots', 'locale'].every((key) => exported.inject.includes(key)))

const registrations = []
const ctx = {
  effect: (fn) => fn(),
  locale: { register: () => () => {}, bind: () => (key) => key },
  slots: {
    inject: (name, callback) => callback(),
    register: (options, component) => { registrations.push({ name: options.name, options, component }); return () => {} },
  },
}
exported.apply(ctx)
const section = registrations.find((row) => row.name === 'settings.section')
const navIcon = registrations.find((row) => row.name === 'settings.section.icon')
check('注册 settings.section', section != null, section?.options?.id)
check('section id = gpt-image', section?.options?.id === 'gpt-image')
check('section 有面板组件', typeof section?.component === 'function')
check('注册导航图标插槽', navIcon != null && navIcon.options.id === 'gpt-image', navIcon?.options?.id ?? 'none')
check('导航图标组件可用', typeof navIcon?.component === 'function')
check('导航名不带连字符', section?.options?.label() === 'GPT Image', section?.options?.label?.())

// --- 2. 没有说明书式文案 ---------------------------------------------------
const prose = [
  '留空 =', '留空表示', '多个用逗号分隔', '相对会话工作目录', '0 = 不自动放大',
  '模型不收', '按本机能力挑', '如 3840', '逗号分隔',
]
const found = prose.filter((phrase) => source.includes(phrase))
check('没有说明书式提示文案', found.length === 0, found.join(' / '))

// --- 3. 只留图片模型 -------------------------------------------------------
const payload = {
  imageModels: ['gpt-image-2.6-flare', 'gpt-image-2.5'],
  models: ['gpt-5.6', 'auto', 'gpt-image-2.6-flare', 'gpt-image-2', 'text-embedding-3-large'],
}
const picked = exported.pickImageModels(payload)
check('过滤掉非图片模型', picked.every((id) => /image/i.test(id)), picked.join(','))
check('不含 auto 与 gpt-5.6', !picked.includes('auto') && !picked.includes('gpt-5.6'))
check('去重并保留 imageModels 顺序', picked[0] === 'gpt-image-2.6-flare' && picked.filter((id) => id === 'gpt-image-2.6-flare').length === 1, picked.join(','))
check('后端只给 models 时也能过滤', exported.pickImageModels({ models: ['gpt-5.6', 'auto', 'gpt-image-2'] }).join(',') === 'gpt-image-2')

// --- 4. 交互承担说明 -------------------------------------------------------
check('模型清单可点选', source.includes('gpi-tag') && source.includes('onToggleModel'))
check('模型来源切换（跟随/固定）', source.includes('follow') && source.includes('pinned'))
check('从 /models 读清单', source.includes("getJson('/models')"))
check('默认模型是下拉而非输入', source.includes("h('select'") && source.includes('defaultModel'))
check('放大目标用预设 + 数值', source.includes('targetOff') && source.includes("value: 2560") && source.includes("value: 3840"))
check('锐化是滑块', source.includes("type: 'range'"))
check('引擎不可用有标注', source.includes('unavailable.has(name)') && source.includes('t(\'unavailable\')'))
check('选中不可用引擎会红字提示', source.includes('gpi-note--bad gpi-note--nowrap'))
check('保存按钮随改动启用', source.includes('disabled: busy || !dirty'))
const headAt = source.indexOf('gpi-head-actions')
const saveAt = source.indexOf('onClick: props.onSave')
const rowsAt = source.indexOf("className: 'gpi-rows'")
check('保存按钮在面板右上', headAt > 0 && saveAt > headAt && saveAt < rowsAt, `head=${headAt} save=${saveAt} rows=${rowsAt}`)
check('Real-ESRGAN 行不再挂下载链接', !source.includes("rel: 'noreferrer'") && !source.includes("t('install')"))
check('面板不再有底部操作条', !source.includes('gpi-foot'))
check('缺引擎提示与按钮同行', !source.includes("flexBasis: '100%'") && source.includes('gpi-note--nowrap'))
check('宿主端过期有状态位', source.includes('staleHost'))
check('测试按钮并进 API Key 行', source.indexOf("t('apiKey')") < source.indexOf('onClick: props.onTest') && !source.includes("label: t('test')"))
check('测试用表单当前值', source.includes("postJson('/test', { baseUrl: form.baseUrl, apiKey: form.apiKey })"))
check('宿主端无 /test 时退到已保存配置', source.includes("getJson('/models')") && source.includes('testOfSaved'))
check('测试结果带延迟与模型数', source.includes('latencyMs') && source.includes('imageModels?.length'))

// --- 5. 安装指令：用户复制即可交办 ------------------------------------------
const promptReal = exported.installPrompt(['realesrgan'])
check('指令含官方下载地址', promptReal.includes('realesrgan-ncnn-vulkan-20220424-macos.zip'))
check('指令含解压与赋权', promptReal.includes('chmod +x') && promptReal.includes('unzip'))
check('指令含写回配置', promptReal.includes('gpt_image_config') && promptReal.includes('realesrganPath'))
check('指令含验证步骤', promptReal.includes('gpt_image_upscale'))
const promptMulti = exported.installPrompt(['ffmpeg', 'pillow'])
check('多引擎并列出命令', promptMulti.includes('brew install ffmpeg') && promptMulti.includes('pip install'), promptMulti.split('\n')[0])
check('无缺失时不出指令', exported.installPrompt([]) === '')
check('未知引擎被忽略', exported.installPrompt(['sips']) === '')

const promptWin = exported.installPrompt(['realesrgan', 'ffmpeg', 'pillow', 'magick'], 'win32')
check('Windows 指令用 PowerShell', promptWin.includes('Invoke-WebRequest') && promptWin.includes('Expand-Archive') && promptWin.includes('realesrgan-ncnn-vulkan.exe'))
check('Windows 装包走 winget', promptWin.includes('winget install --id Gyan.FFmpeg') && promptWin.includes('winget install --id ImageMagick.ImageMagick'))
check('Windows 用 py 而非 python3', promptWin.includes('py -m pip install'))
check('Windows 路径用反斜杠', promptWin.includes('$env:TEMP\\realesrgan.zip'), promptWin.split('\n')[3] ?? '')

const promptLinux = exported.installPrompt(['ffmpeg', 'magick'], 'linux')
check('Linux 走 apt', promptLinux.includes('sudo apt install -y ffmpeg') && promptLinux.includes('sudo apt install -y imagemagick'))

const promptMac = exported.installPrompt(['realesrgan'], 'darwin')
check('macOS 走 brew/unzip', promptMac.includes('unzip') && promptMac.includes('chmod +x'))

const form = {
  baseUrl: 'https://gateway.example',
  apiKey: '',
  defaultModel: 'gpt-image-2.6-flare',
  fixed: false,
  models: [],
  timeoutMs: 300000,
  autoFallback: true,
  sizeHintInPrompt: true,
  upscaleEngine: 'auto',
  upscaleTargetLongEdge: 0,
  upscaleSharpen: 0.5,
  realesrganPath: '',
  apiKeyConfigured: true,
  hostApi: 3,
}
const noop = () => {}
const catalogWin = ['realesrgan', 'ffmpeg', 'pillow', 'magick']
// --- 6. 图标：GPT 旋叶标记 ------------------------------------------------
const iconSvg = await readFile(new URL('../icon.svg', import.meta.url), 'utf8')
check('图标是合法 SVG 且体积合规', iconSvg.trimStart().startsWith('<svg') && Buffer.byteLength(iconSvg) < 256 * 1024, `${Buffer.byteLength(iconSvg)} bytes`)
check('图标无文字元素', !/<text|<tspan|<foreignObject/.test(iconSvg))
check('图标是 sub2api 提供的 logo', iconSvg.includes('s2a-brand') && iconSvg.includes('viewBox="0 0 512 512"'), iconSvg.slice(0, 60).replace(/\n/g, ' '))
check('图标无外部引用/脚本', !/href="http|<script|<image/.test(iconSvg))
check('图标保留互锁 S 主体', (iconSvg.match(/<path/g) ?? []).length >= 2)
const glyphRender = exported.PanelView({
  t: (key) => key,
  form: { ...form },
  initial: JSON.stringify(form),
  accountModels: ['gpt-image-2.6-flare'],
  engineList: ['ffmpeg'],
  catalog: ['realesrgan', 'ffmpeg', 'pillow', 'magick'],
  platform: 'darwin',
  probe: { state: 'idle', text: '' },
  status: { kind: '', text: '' },
  busy: false,
  loadError: null,
  onSet: noop, onFixed: noop, onToggleModel: noop, onRefresh: noop, onTest: noop, onSave: noop,
})
const logoNodes = []
const findLogo = (node) => {
  if (node == null || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach(findLogo); return }
  if (node.type?.name === 'Logo') logoNodes.push(node)
  findLogo(node.children)
}
findLogo(glyphRender)
check('设置页标题用插件图标', logoNodes.length === 1)

const logoTree = exported.Logo()
check('标题图标尺寸 20', logoTree?.props?.size === 20, JSON.stringify(logoTree?.props ?? {}))
check('标识是单色行内 SVG', source.includes("stroke: 'currentColor'") && (source.match(/MARK_PATHS = \[/) != null))
check('标识不带品牌绿', !/10A37F|19B98C|3EDCB0|s2a-brand|#12A57F/i.test(source))

const navTree = exported.NavIcon({ size: 16, active: false })
check('导航图标复用同一枚标记', navTree?.type?.name === 'Glyph', String(navTree?.type?.name))
check('导航图标按请求尺寸渲染', navTree?.props?.size === 16, JSON.stringify(navTree?.props ?? {}))
check('面板标题复用同一枚标记', exported.Logo()?.type?.name === 'Glyph')

// --- 7. 渲染层：不重复文案、不渲染 undefined --------------------------------
const tree = exported.PanelView({
  t: (key) => key,
  form,
  initial: JSON.stringify(form),
  accountModels: ['gpt-image-2.6-flare', 'gpt-image-2.5'],
  engineList: ['ffmpeg', 'pillow', 'magick'],
  catalog: catalogWin,
  platform: 'win32',
  probe: { state: 'idle', text: '' },
  status: { kind: '', text: '' },
  busy: false,
  loadError: null,
  onSet: noop, onFixed: noop, onToggleModel: noop, onRefresh: noop, onTest: noop, onSave: noop,
})

const types = []
const texts = []
const walk = (node) => {
  if (node == null || typeof node === 'boolean') return
  if (Array.isArray(node)) { node.forEach(walk); return }
  if (typeof node === 'string' || typeof node === 'number') { texts.push(String(node)); return }
  if (typeof node !== 'object') return
  types.push(typeof node.type === 'string' ? node.type : node.type?.name ?? 'component')
  walk(node.children)
}
walk(tree)

check('渲染树没有 undefined 组件', !types.includes('undefined') && !types.includes('component'), [...new Set(types)].join(','))
check('渲染出测试按钮', texts.includes('test'))
check('渲染出保存按钮', texts.includes('save'))
check('没有分组标题文案', !['endpoint', 'models', 'output', 'upscale'].some((key) => texts.includes(key)), texts.slice(0, 8).join('|'))
const rowLabels = []
const switches = []
const walkRows = (node) => {
  if (node == null || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach(walkRows); return }
  if (node.type?.name === 'Row') rowLabels.push(node.props.label)
  if (node.type?.name === 'Switch') switches.push(node.props)
  walkRows(node.children)
}
walkRows(tree)
const labelCount = (word) => rowLabels.filter((label) => label === word).length
check('设置表单不再显示或提交产物目录', labelCount('outputDir') === 0 && !source.includes('outputDir'))
check('安装指令使用绝对图片路径', promptReal.includes('图片文件绝对路径'))
check('字段标签各出现一次', ['baseUrl', 'apiKey', 'models', 'defaultModel', 'timeout', 'engine', 'target', 'sharpen'].every((key) => labelCount(key) === 1),
  ['baseUrl', 'apiKey', 'models', 'defaultModel', 'timeout', 'engine', 'target', 'sharpen'].map((key) => `${key}:${labelCount(key)}`).join(' '))
check('不再有分组标题', !rowLabels.includes('endpoint') && !rowLabels.includes('output') && !rowLabels.includes('upscale'), rowLabels.join(','))
check('布尔项用开关而非勾选框', switches.length === 2 && !source.includes("type: 'checkbox'"), `${switches.length} 个开关`)
check('引擎/来源/目标用下拉', (source.match(/gpi-select/g) ?? []).length >= 3, `${(source.match(/gpi-select/g) ?? []).length} 处`)
const selectNodes = []
const findSelect = (node) => {
  if (node == null || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach(findSelect); return }
  if (node.type?.name === 'Select') selectNodes.push(node.props)
  findSelect(node.children)
}
findSelect(tree)
check('下拉用 Select 组件', selectNodes.length >= 3, `${selectNodes.length} 个`)
check('默认模型下拉带账号模型', (selectNodes.find((item) => item.label === 'defaultModel')?.options ?? []).some((option) => option.id === 'gpt-image-2.6-flare'))

const busyTree = exported.PanelView({
  ...{ t: (key) => key, form: { ...form, hostApi: 0, fixed: true, models: ['gpt-image-2.6-flare'] }, initial: '{}' },
  accountModels: null,
  engineList: [],
  probe: { state: 'idle', text: '' },
  status: { kind: '', text: '' },
  busy: true,
  loadError: null,
  onSet: noop, onFixed: noop, onToggleModel: noop, onRefresh: noop, onTest: noop, onSave: noop,
})
const busyTexts = []
const walkTexts = (node) => {
  if (node == null) return
  if (Array.isArray(node)) { node.forEach(walkTexts); return }
  if (typeof node === 'string') { busyTexts.push(node); return }
  if (typeof node === 'object') walkTexts(node.children)
}
walkTexts(busyTree)
check('宿主端旧代码时提示重启', busyTexts.includes('staleHost'))
const copyNodes = []
const findCopy = (node) => {
  if (node == null || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach(findCopy); return }
  if (node.type?.name === 'CopyButton') copyNodes.push(node.props)
  findCopy(node.children)
}
findCopy(busyTree)
check('缺引擎时给复制入口', copyNodes.length === 1 && copyNodes[0].label === 'copyInstall', copyNodes[0]?.label ?? 'none')
check('Windows 上不出现 sips chip', !texts.includes('sips'), [...new Set(texts.filter((text) => /sips|magick/.test(text)))].join(','))
check('复制内容是安装指令', (copyNodes[0]?.text ?? '').includes('realesrgan-ncnn-vulkan-20220424-macos.zip'), (copyNodes[0]?.text ?? '').split('\n')[0])
const busySelects = []
const findBusySelect = (node) => {
  if (node == null || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach(findBusySelect); return }
  if (node.type?.name === 'Select') busySelects.push(node.props)
  findBusySelect(node.children)
}
findBusySelect(busyTree)
const emptyFixed = exported.PanelView({
  t: (key) => key,
  form: { ...form, fixed: true, models: [] },
  initial: JSON.stringify(form),
  accountModels: ['gpt-image-2.6-flare'],
  engineList: ['ffmpeg'],
  catalog: ['realesrgan', 'ffmpeg', 'pillow', 'magick'],
  platform: 'darwin',
  probe: { state: 'idle', text: '' },
  status: { kind: '', text: '' },
  busy: false,
  loadError: null,
  onSet: noop, onFixed: noop, onToggleModel: noop, onRefresh: noop, onTest: noop, onSave: noop,
})
const emptyTexts = []
const walkEmpty = (node) => {
  if (node == null) return
  if (Array.isArray(node)) { node.forEach(walkEmpty); return }
  if (typeof node === 'string') { emptyTexts.push(node); return }
  if (typeof node === 'object') walkEmpty(node.children)
}
walkEmpty(emptyFixed)
check('固定清单为空时提示', emptyTexts.includes('noneSelected'), emptyTexts.join('|').slice(0, 80))

// --- 8. 有 primitives 时复用 DSH 组件 --------------------------------------
const fakePrimitives = {
  Menu: function Menu() { return null },
  Switch: function PrimitiveSwitch() { return null },
  Button: function PrimitiveButton() { return null },
  IconChevronDownOutlineRegular: function Chevron() { return null },
}
const primitivesModule = await import(`data:text/javascript,${encodeURIComponent('export const x = 1')}`).catch(() => null)
// 重新载入 client 模块，让 require 命中假 primitives
let captured2
const prevWindow = globalThis.window
globalThis.window = { __ModuleLoader__: { load: (mod) => { captured2 = mod } } }
const requireWithPrimitives = (name) => {
  if (name === 'react') return React
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return fakePrimitives
  throw new Error(`unexpected require ${name}`)
}
const cacheBust = `?v=${Date.now()}`
await import(new URL('../client.js', import.meta.url).href + cacheBust).catch(() => {})
const exported2 = captured2?.factory(requireWithPrimitives)
const primTree = exported2?.PanelView({
  t: (key) => key,
  form: { ...form },
  initial: JSON.stringify(form),
  accountModels: ['gpt-image-2.6-flare'],
  engineList: ['ffmpeg'],
  catalog: ['realesrgan', 'ffmpeg', 'pillow', 'magick'],
  platform: 'darwin',
  probe: { state: 'idle', text: '' },
  status: { kind: '', text: '' },
  busy: false,
  loadError: null,
  onSet: noop, onFixed: noop, onToggleModel: noop, onRefresh: noop, onTest: noop, onSave: noop,
})
const primTypes = []
const walkPrim = (node) => {
  if (node == null || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach(walkPrim); return }
  primTypes.push(node.type?.name ?? (typeof node.type === 'string' ? node.type : '?'))
  walkPrim(node.children)
}
walkPrim(primTree)
const primSelect = exported2.Select({ value: 'a', label: 'x', options: [{ id: 'a', label: 'A' }], onChange: noop })
check('有 primitives 时下拉走 Menu', primSelect?.type?.name === 'Menu' || primSelect?.type === fakePrimitives.Menu, String(primSelect?.type?.name ?? primSelect?.type))
check('Menu 收到选项与当前值', primSelect?.props?.selectedId === 'a' && primSelect?.props?.items?.length === 1, JSON.stringify(primSelect?.props?.items ?? []))
check('有 primitives 时开关走 Switch', exported2.Switch({ on: true, onChange: noop })?.type === fakePrimitives.Switch)
check('有 primitives 时按钮走 Button', exported2.Button({ children: 'x' })?.type === fakePrimitives.Button)

// 无 primitives 时必须退到原生控件，不能整块崩掉
const fallbackSelect = exported.Select({ value: 'a', label: 'x', options: [{ id: 'a', label: 'A' }], onChange: noop })
check('无 primitives 时退回原生 select', fallbackSelect?.type === 'select', String(fallbackSelect?.type))
globalThis.window = prevWindow

const failed = rows.filter((row) => !row.ok)
console.log(`\n${rows.length - failed.length}/${rows.length} 通过`)
if (failed.length > 0) process.exitCode = 1