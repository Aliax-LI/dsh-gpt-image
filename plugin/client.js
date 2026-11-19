// gpt-image 客户端半：设置页面板。
// 视觉与交互跟随设置页原生样式：左标签 + 右控件、细分隔线、开关与下拉；不使用品牌绿。
window.__ModuleLoader__.load({
  id: '@local/dsh-gpt-image',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'gpt-image'

    // DSH 自带的 UI 组件包由 shell 在运行时提供；拿不到时退回原生控件，不让整块面板崩掉。
    const primitives = (() => {
      try {
        return require('@deepseek-ai/dsh-client-ui-primitives') ?? {}
      } catch {
        return {}
      }
    })()
    const Menu = primitives.Menu
    const PrimitiveSwitch = primitives.Switch
    const PrimitiveButton = primitives.Button
    const ChevronDown = primitives.IconChevronDownOutlineRegular

    const zh = {
      title: 'GPT Image',
      baseUrl: '接口地址',
      apiKey: 'API Key',
      apiKeySet: '留空不改',
      defaultModel: '默认模型',
      source: '模型来源',
      follow: '跟随账号',
      pinned: '固定清单',
      models: '模型清单',
      refresh: '刷新',
      noneSelected: '至少选一个模型',
      outputDir: '产物目录',
      timeout: '超时（ms）',
      autoFallback: '模型不可用时自动换一个',
      sizeHint: '画幅写进提示词',
      engine: '放大引擎',
      target: '目标长边',
      targetOff: '关',
      custom: '自定义',
      sharpen: '锐化',
      realesrganPath: 'Real-ESRGAN 路径',
      copyInstall: '复制安装指令',
      copied: '已复制',
      missing: '缺 ',
      unavailable: '本机不可用',
      save: '保存',
      saving: '保存中',
      saved: '已保存',
      dirty: '有未保存改动',
      loadFailed: '读取失败',
      saveFailed: '保存失败',
      staleHost: '宿主端待重启',
      configured: '已配置',
      notConfigured: '未配置',
      test: '测试',
      testing: '测试中',
      testOk: '通过',
      testOfSaved: '已保存配置',
    }

    const en = {
      title: 'GPT Image',
      baseUrl: 'Base URL',
      apiKey: 'API key',
      apiKeySet: 'leave empty to keep',
      defaultModel: 'Default model',
      source: 'Model source',
      follow: 'Follow account',
      pinned: 'Pinned list',
      models: 'Model list',
      refresh: 'Refresh',
      noneSelected: 'Pick at least one model',
      outputDir: 'Output directory',
      timeout: 'Timeout (ms)',
      autoFallback: 'Swap in another model when unavailable',
      sizeHint: 'Write the frame into the prompt',
      engine: 'Upscale engine',
      target: 'Target long edge',
      targetOff: 'Off',
      custom: 'Custom',
      sharpen: 'Sharpen',
      realesrganPath: 'Real-ESRGAN path',
      copyInstall: 'Copy install prompt',
      copied: 'Copied',
      missing: 'missing ',
      unavailable: 'not on this machine',
      save: 'Save',
      saving: 'Saving',
      saved: 'Saved',
      dirty: 'Unsaved changes',
      loadFailed: 'Failed to load',
      saveFailed: 'Save failed',
      staleHost: 'host half needs a restart',
      configured: 'configured',
      notConfigured: 'not configured',
      test: 'Test',
      testing: 'Testing',
      testOk: 'ok',
      testOfSaved: 'saved config',
    }

    const CSS = `
.gpi{--gpi-line:var(--dsw-alias-border-l1,#ececec);--gpi-ink:var(--dsw-alias-label-primary,#171717);--gpi-soft:var(--dsw-alias-label-secondary,#8a8a8a);--gpi-quiet:var(--dsw-alias-label-tertiary,#a1a1aa);--gpi-bg:var(--dsw-alias-bg-layer-1,#fff);--gpi-field:var(--dsw-alias-bg-layer-2,#f4f4f5);--gpi-accent:var(--dsw-alias-label-primary,#171717);--gpi-danger:#b91c1c;color:var(--gpi-ink);font-size:13px;line-height:1.5;display:block;width:100%;max-width:780px;margin:0 auto;padding:6px 2px 36px;box-sizing:border-box}
.gpi *{box-sizing:border-box}
.gpi-head{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:9px;padding:10px 0 12px;background:var(--dsw-alias-bg-layer-1,#fff);border-bottom:1px solid var(--gpi-line)}
.gpi-head-actions{margin-left:auto;display:flex;align-items:center;gap:10px;min-width:0}
.gpi-logo{flex:0 0 auto;color:currentColor}
.gpi-h1{margin:0;font-size:16px;font-weight:600;letter-spacing:.01em}
.gpi-pill{display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 8px;border-radius:999px;font-size:11px;color:var(--gpi-soft);background:var(--gpi-field)}
.gpi-pill i{width:5px;height:5px;border-radius:50%;background:currentColor;display:block;opacity:.55}
.gpi-rows{display:flex;flex-direction:column;margin-top:4px}
.gpi-row{display:grid;grid-template-columns:168px minmax(0,1fr);gap:16px;align-items:center;padding:13px 0;border-top:1px solid var(--gpi-line)}
.gpi-row:first-child{border-top:0;padding-top:4px}
.gpi-row--stack{align-items:start}
.gpi-k{color:var(--gpi-ink);font-size:13.5px}
.gpi-v{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap;justify-content:flex-start}
.gpi-row:not(.gpi-row--stack) .gpi-v{justify-content:flex-end}
.gpi-field{height:36px;max-width:340px;width:100%;padding:0 12px;border:1px solid transparent;border-radius:10px;background:var(--gpi-field);color:inherit;font:inherit;font-size:13px;transition:background .12s ease,border-color .12s ease,box-shadow .12s ease}
.gpi-field:focus{outline:0;background:var(--gpi-bg);border-color:var(--gpi-quiet);box-shadow:0 0 0 3px rgba(0,0,0,.05)}
.gpi-field--mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
.gpi-field--num{max-width:132px}
.gpi-select{display:inline-flex;align-items:center;justify-content:space-between;gap:12px;height:36px;min-width:200px;max-width:280px;padding:0 14px;border:0;border-radius:var(--dsw-radius-md,10px);background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-2,#f4f4f5));color:inherit;font:inherit;font-size:14px;line-height:22px;cursor:pointer}
.gpi-select:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#ececee)}
.gpi-select:disabled{opacity:.5;cursor:default}
.gpi-select-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gpi-select--native{appearance:auto}
.gpi-switch{width:38px;height:22px;border:0;border-radius:999px;background:#e4e4e7;position:relative;cursor:pointer;padding:0;flex:0 0 auto}
.gpi-switch[data-on='true']{background:var(--gpi-accent)}
.gpi-switch i{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .16s ease;display:block}
.gpi-switch[data-on='true'] i{transform:translateX(16px)}
.gpi-btn{height:32px;padding:0 13px;border-radius:9px;border:1px solid var(--gpi-line);background:var(--gpi-bg);color:inherit;font:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap}
.gpi-btn:hover:not(:disabled){border-color:var(--gpi-quiet)}
.gpi-btn:disabled{opacity:.45;cursor:default}
.gpi-btn--primary{background:var(--gpi-accent);border-color:transparent;color:var(--dsw-alias-label-on-accent,#fff)}
.gpi-tags{display:flex;flex-wrap:wrap;gap:6px}
.gpi-tag{height:30px;padding:0 11px;border:0;border-radius:8px;background:var(--gpi-field);color:var(--gpi-ink);font:inherit;font-size:12px;cursor:pointer;transition:background .12s ease,color .12s ease}
.gpi-tag:hover:not([data-static='true']){background:#ebebed}
.gpi-tag[data-on='true']:not([data-static='true']){background:var(--gpi-accent);color:var(--dsw-alias-label-on-accent,#fff)}
.gpi-tag[data-static='true']{cursor:default;color:var(--gpi-soft)}
.gpi-tag code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px}
.gpi-range{width:200px;max-width:100%;accent-color:var(--gpi-accent)}
.gpi-val{min-width:24px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--gpi-soft)}
.gpi-note{font-size:12px;color:var(--gpi-soft)}
.gpi-note--bad{color:var(--gpi-danger)}
.gpi-note--nowrap{white-space:nowrap}
`

    const FALLBACK_CATALOG = ['realesrgan', 'ffmpeg', 'pillow', 'magick']
    const TARGETS = [
      { label: 'targetOff', value: 0 },
      { label: '2K', value: 2560 },
      { label: '4K', value: 3840 },
    ]

    const unique = (ids) => [...new Set(ids.filter((id) => typeof id === 'string' && id !== ''))]

    // 清单只认图片模型：宿主给 imageModels 就用它，否则退到全量再按名字过滤；auto 不是图片模型。
    const pickImageModels = (data) => unique([...(data?.imageModels ?? []), ...(data?.models ?? [])])
      .filter((id) => /image/i.test(id) && !/^auto$/i.test(id))

    const getJson = async (path) => {
      const response = await fetch(`/gpt-image${path}`, { credentials: 'same-origin' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.ok === false) throw new Error(data.error ?? `HTTP ${response.status}`)
      return data
    }

    const postJson = async (path, body) => {
      const response = await fetch(`/gpt-image${path}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.ok === false) {
        const error = new Error(data.error ?? `HTTP ${response.status}`)
        error.status = response.status
        throw error
      }
      return data
    }

    /** 各平台的安装命令；只列缺的那个，用户复制粘贴即可交办。 */
    const INSTALL_STEPS = {
      darwin: {
        realesrgan: [
          'Real-ESRGAN（ncnn-vulkan，AI 放大，会合成细节；官方 macOS 包是 Intel 版，Apple Silicon 走 Rosetta）',
          'curl -L -o /tmp/realesrgan-macos.zip https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-macos.zip',
          'mkdir -p ~/tools/realesrgan && unzip -o /tmp/realesrgan-macos.zip -d ~/tools/realesrgan && chmod +x ~/tools/realesrgan/realesrgan-ncnn-vulkan',
          '~/tools/realesrgan/realesrgan-ncnn-vulkan -h',
        ],
        ffmpeg: ['ffmpeg（真 Lanczos3 重采样）', 'brew install ffmpeg', 'ffmpeg -version'],
        pillow: ['Pillow（Python 端 Lanczos + unsharp）', 'python3 -m pip install --user --upgrade pillow', 'python3 -c "import PIL; print(PIL.__version__)"'],
        magick: ['ImageMagick（-resize + -unsharp）', 'brew install imagemagick', 'magick -version'],
      },
      win32: {
        realesrgan: [
          'Real-ESRGAN（ncnn-vulkan，AI 放大，会合成细节）',
          "Invoke-WebRequest -Uri 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-windows.zip' -OutFile $env:TEMP\\realesrgan.zip",
          "Expand-Archive -Force $env:TEMP\\realesrgan.zip $env:USERPROFILE\\tools\\realesrgan",
          '& "$env:USERPROFILE\\tools\\realesrgan\\realesrgan-ncnn-vulkan.exe" -h',
        ],
        ffmpeg: ['ffmpeg（真 Lanczos3 重采样）', 'winget install --id Gyan.FFmpeg --accept-package-agreements --accept-source-agreements', 'ffmpeg -version'],
        pillow: ['Pillow（Python 端 Lanczos + unsharp）', 'py -m pip install --user --upgrade pillow', 'py -c "import PIL; print(PIL.__version__)"'],
        magick: ['ImageMagick（-resize + -unsharp）', 'winget install --id ImageMagick.ImageMagick --accept-package-agreements --accept-source-agreements', 'magick -version'],
      },
      linux: {
        realesrgan: [
          'Real-ESRGAN（ncnn-vulkan，AI 放大，会合成细节）',
          'curl -L -o /tmp/realesrgan-ubuntu.zip https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-ubuntu.zip',
          'mkdir -p ~/tools/realesrgan && unzip -o /tmp/realesrgan-ubuntu.zip -d ~/tools/realesrgan && chmod +x ~/tools/realesrgan/realesrgan-ncnn-vulkan',
          '~/tools/realesrgan/realesrgan-ncnn-vulkan -h',
        ],
        ffmpeg: ['ffmpeg（真 Lanczos3 重采样）', 'sudo apt install -y ffmpeg', 'ffmpeg -version'],
        pillow: ['Pillow（Python 端 Lanczos + unsharp）', 'python3 -m pip install --user --upgrade pillow', 'python3 -c "import PIL; print(PIL.__version__)"'],
        magick: ['ImageMagick（-resize + -unsharp）', 'sudo apt install -y imagemagick', 'magick -version'],
      },
    }

    const PLATFORM_LABEL = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }

    /** 宿主没下发平台时，从浏览器侧猜一个。 */
    const guessPlatform = () => {
      try {
        const raw = `${navigator.userAgentData?.platform ?? ''} ${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`
        if (/win/i.test(raw)) return 'win32'
        if (/mac|darwin/i.test(raw)) return 'darwin'
        return 'linux'
      } catch {
        return 'darwin'
      }
    }

    /**
     * 生成一段可直接交给 agent 的安装指令。
     * @param missing - 本机缺失的引擎名。
     * @param platform - `darwin` / `win32` / `linux`。
     * @returns 多行文本；没有缺失时返回空串。
     */
    const installPrompt = (missing, platform = 'darwin') => {
      const table = INSTALL_STEPS[platform] ?? INSTALL_STEPS.darwin
      const steps = missing.filter((name) => table[name] != null)
      if (steps.length === 0) return ''
      const os = PLATFORM_LABEL[platform] ?? platform
      const exe = platform === 'win32' ? 'realesrgan-ncnn-vulkan.exe' : 'realesrgan-ncnn-vulkan'
      const lines = [`帮我把 dsh-gpt-image 插件的放大引擎补齐（${os}），缺的是：${steps.join(' / ')}。`]
      for (const name of steps) {
        lines.push('', `## ${table[name][0]}`)
        for (const command of table[name].slice(1)) lines.push(command)
      }
      lines.push(
        '',
        '## 写回插件配置（装完再做）',
        steps.includes('realesrgan')
          ? `gpt_image_config({ action: "set", realesrganPath: "<上面 ${exe} 的绝对路径>" })`
          : 'gpt_image_config({ action: "show" })   # 确认该引擎已出现在可用列表',
        '',
        '## 验证',
        'gpt_image_upscale({ path: "gpt-image-output/gear.png", factor: 2 })',
        '',
        '装好把结果告诉我：哪些引擎现在可用、验证那张图的宽高。',
      )
      return lines.join('\n')
    }

    /** 与插件图标同款的互锁 S 标记，单色（currentColor），与设置页其它导航图标一致。 */
    const MARK_PATHS = [
      'm19.25 7.65-2.55-3.2a1.33 1.33 0 0 0-1.03-.5H8.58c-.34 0-.67.13-.91.37L4.15 7.65c-.93.88-.6 1.52.65 2.3l9.55 5.97',
      'm4.75 16.35 2.55 3.2c.25.31.63.5 1.03.5h7.09c.34 0 .67-.13.91-.37l3.52-3.33c.93-.88.6-1.52-.65-2.3L9.65 8.08',
    ]

    /** 单色标记；`size` 决定边长，颜色继承 currentColor。 */
    function Glyph(props) {
      const size = props?.size ?? 20
      return h('svg', {
        className: 'gpi-logo',
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        'aria-hidden': 'true',
        focusable: 'false',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.9,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }, MARK_PATHS.map((d) => h('path', { key: d.slice(0, 12), d })))
    }

    /** 设置导航里的小图标：同一枚举标记。 */
    function NavIcon(props) {
      return h(Glyph, { size: props?.size ?? 16 })
    }

    /** 面板标题标识。 */
    function Logo() {
      return h(Glyph, { size: 20 })
    }

    /** 按钮：优先用 primitives.Button（与设置页同款），否则退回本地样式。 */
    function Button(props) {
      if (typeof PrimitiveButton === 'function') {
        return h(PrimitiveButton, {
          variant: props.variant ?? 'outline',
          size: props.size ?? 'sm',
          disabled: props.disabled === true,
          title: props.title,
          onClick: props.onClick,
        }, props.children)
      }
      return h('button', {
        type: 'button',
        className: `gpi-btn${props.variant === 'primary' ? ' gpi-btn--primary' : ''}`,
        disabled: props.disabled === true,
        title: props.title,
        onClick: props.onClick,
      }, props.children)
    }

    /** 复制按钮：主路径用 clipboard，失败退回 textarea + execCommand。 */
    function CopyButton(props) {
      const [done, setDone] = React.useState(false)
      const copy = async () => {
        const text = props.text
        try {
          await navigator.clipboard.writeText(text)
        } catch {
          const area = document.createElement('textarea')
          area.value = text
          area.style.position = 'fixed'
          area.style.opacity = '0'
          document.body.appendChild(area)
          area.select()
          try { document.execCommand('copy') } finally { area.remove() }
        }
        setDone(true)
        setTimeout(() => setDone(false), 1800)
      }
      return h(Button, { onClick: copy }, done ? props.copiedLabel : props.label)
    }

    /**
     * 下拉：有 primitives.Menu 就用它（与设置页同一套弹层/勾选样式），否则退回原生 select。
     * @param props - `{ value, options: [{id,label}], onChange, disabled, label }`。
     */
    function Select(props) {
      const [open, setOpen] = React.useState(false)
      const current = props.options.find((item) => item.id === props.value)
      const selectedLabel = current?.label ?? props.value ?? ''
      if (typeof Menu !== 'function') {
        return h('select', {
          className: 'gpi-select gpi-select--native',
          value: props.value,
          disabled: props.disabled === true,
          'aria-label': props.label,
          onChange: (event) => props.onChange(event.target.value),
        }, props.options.map((item) => h('option', { key: item.id, value: item.id }, item.label)))
      }
      return h(Menu, {
        open,
        onClose: () => setOpen(false),
        portal: true,
        align: 'end',
        selectedId: props.value,
        items: props.options.map((item) => ({ id: item.id, label: item.label })),
        onSelect: (id) => { setOpen(false); props.onChange(id) },
        anchor: h('button', {
          type: 'button',
          className: 'gpi-select',
          disabled: props.disabled === true,
          'aria-label': props.label,
          'aria-haspopup': 'menu',
          'aria-expanded': open,
          onClick: () => setOpen(!open),
        },
        h('span', { className: 'gpi-select-label' }, selectedLabel),
        ChevronDown != null ? h(ChevronDown, { size: 14 }) : null),
      })
    }

    /** 一行设置：左标签 + 右控件，和设置页其它行同一节奏。 */
    function Row(props) {
      return h('div', { className: `gpi-row${props.stack ? ' gpi-row--stack' : ''}` },
        h('span', { className: 'gpi-k' }, props.label),
        h('div', { className: 'gpi-v' }, props.children))
    }

    /** 开关：设置页用 primitives.Switch，取不到时才用手写的那套。 */
    function Switch(props) {
      if (typeof PrimitiveSwitch === 'function') {
        return h(PrimitiveSwitch, {
          checked: props.on === true,
          label: props.label,
          onChange: (next) => props.onChange(next),
        })
      }
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': props.on === true ? 'true' : 'false',
        'data-on': props.on === true ? 'true' : 'false',
        className: 'gpi-switch',
        onClick: () => props.onChange(props.on !== true),
      }, h('i', null))
    }

    /** 模型标签：静态模式是只读的当前清单，可编辑模式是开关。 */
    function Tags(props) {
      if (props.items.length === 0) return h('span', { className: 'gpi-note' }, '—')
      return h('div', { className: 'gpi-tags' }, props.items.map((id) => h('button', {
        key: id,
        type: 'button',
        className: 'gpi-tag',
        'data-on': props.staticMode === true || props.selected.includes(id) ? 'true' : 'false',
        'data-static': props.staticMode === true ? 'true' : 'false',
        disabled: props.staticMode === true,
        onClick: props.staticMode === true ? undefined : () => props.onToggle(id),
      }, h('code', null, id))))
    }

    /**
     * 纯展示层：给定状态就渲染，不持有 state，方便结构测试。
     * @param props - `{ t, form, initial, accountModels, engineList, catalog, platform, probe, status, busy, on* }`。
     */
    function PanelView(props) {
      const { t, form, initial, accountModels, engineList, probe, status, busy } = props
      if (props.loadError != null) {
        return h('div', { className: 'gpi' }, h('style', null, CSS),
          h('div', { className: 'gpi-head' }, h(Logo, null), h('h2', { className: 'gpi-h1' }, t('title'))),
          h('p', { className: 'gpi-note gpi-note--bad' }, `${t('loadFailed')}：${props.loadError}`))
      }
      if (form == null) return h('div', { className: 'gpi' }, h('style', null, CSS))

      const dirty = JSON.stringify(form) !== initial
      const stale = form.hostApi !== 2
      const catalog = Array.isArray(props.catalog) && props.catalog.length > 0 ? props.catalog : FALLBACK_CATALOG
      const unavailable = new Set(catalog.filter((name) => !engineList.includes(name)))
      const known = unique([...(accountModels ?? []), ...form.models, form.defaultModel ?? ''])
      const visibleModels = accountModels == null ? form.models : unique([...accountModels, ...form.models])
      const targetValue = Number(form.upscaleTargetLongEdge)
      const preset = TARGETS.some((item) => item.value === targetValue) ? String(targetValue) : 'custom'
      const missing = [...unavailable]

      return h('div', { className: 'gpi' },
        h('style', null, CSS),

        h('div', { className: 'gpi-head' },
          h(Logo, null),
          h('h2', { className: 'gpi-h1' }, t('title')),
          h('span', { className: 'gpi-pill' },
            h('i', null), form.apiKeyConfigured ? t('configured') : t('notConfigured')),
          h('div', { className: 'gpi-head-actions' },
            status.text !== '' || dirty
              ? h('span', { className: `gpi-note${status.kind === 'bad' ? ' gpi-note--bad' : ''}` },
                status.text !== '' ? status.text : t('dirty'))
              : null,
            stale ? h('span', { className: 'gpi-note gpi-note--bad' }, t('staleHost')) : null,
            h(Button, {
              variant: 'primary',
              disabled: busy || !dirty,
              onClick: props.onSave,
            }, busy ? t('saving') : t('save')))),

        h('div', { className: 'gpi-rows' },

          h(Row, { label: t('baseUrl') },
            h('input', {
              className: 'gpi-field gpi-field--mono',
              value: form.baseUrl,
              spellCheck: false,
              placeholder: 'https://api.example.com',
              onChange: (event) => props.onSet({ baseUrl: event.target.value }),
            })),

          h(Row, { label: t('apiKey') },
            h('input', {
              className: 'gpi-field gpi-field--mono',
              type: 'password',
              value: form.apiKey,
              spellCheck: false,
              placeholder: form.apiKeyConfigured ? t('apiKeySet') : '',
              onChange: (event) => props.onSet({ apiKey: event.target.value }),
            }),
            h(Button, {
              disabled: probe.state === 'running',
              onClick: props.onTest,
            }, probe.state === 'running' ? t('testing') : t('test')),
            probe.text === ''
              ? null
              : h('span', {
                className: `gpi-note gpi-note--nowrap${probe.state === 'bad' ? ' gpi-note--bad' : ''}`,
              }, probe.text)),

          h(Row, { label: t('models'), stack: true },
            h(Select, {
              value: form.fixed ? 'pinned' : 'follow',
              label: t('models'),
              options: [{ id: 'follow', label: t('follow') }, { id: 'pinned', label: t('pinned') }],
              onChange: (id) => props.onFixed(id === 'pinned'),
            }),
            h(Button, { title: t('refresh'), onClick: props.onRefresh }, '↻'),
            h(Tags, {
              items: visibleModels,
              selected: form.models,
              onToggle: props.onToggleModel,
              staticMode: !form.fixed,
            }),
            form.fixed && form.models.length === 0
              ? h('span', { className: 'gpi-note gpi-note--bad' }, t('noneSelected'))
              : null),

          h(Row, { label: t('defaultModel') },
            h(Select, {
              value: form.defaultModel,
              label: t('defaultModel'),
              options: known.map((id) => ({ id, label: id })),
              onChange: (id) => props.onSet({ defaultModel: id }),
            })),

          h(Row, { label: t('outputDir') },
            h('input', {
              className: 'gpi-field gpi-field--mono',
              value: form.outputDir,
              placeholder: 'gpt-image-output',
              onChange: (event) => props.onSet({ outputDir: event.target.value }),
            })),

          h(Row, { label: t('timeout') },
            h('input', {
              className: 'gpi-field gpi-field--num',
              type: 'number',
              min: 1000,
              step: 1000,
              value: form.timeoutMs,
              onChange: (event) => props.onSet({ timeoutMs: Number(event.target.value) }),
            })),

          h(Row, { label: t('autoFallback') },
            h(Switch, { on: form.autoFallback, onChange: (next) => props.onSet({ autoFallback: next }) })),

          h(Row, { label: t('sizeHint') },
            h(Switch, { on: form.sizeHintInPrompt, onChange: (next) => props.onSet({ sizeHintInPrompt: next }) })),

          h(Row, { label: t('engine') },
            h(Select, {
              value: form.upscaleEngine,
              label: t('engine'),
              options: ['auto', ...catalog, 'off'].map((name) => ({
                id: name,
                label: unavailable.has(name) ? `${name} · ${t('unavailable')}` : name,
              })),
              onChange: (id) => props.onSet({ upscaleEngine: id }),
            }),
            missing.length > 0
              ? h(CopyButton, {
                text: installPrompt(missing, props.platform ?? 'darwin'),
                label: t('copyInstall'),
                copiedLabel: t('copied'),
              })
              : null,
            unavailable.has(form.upscaleEngine)
              ? h('span', { className: 'gpi-note gpi-note--bad gpi-note--nowrap' }, `${form.upscaleEngine} · ${t('unavailable')}`)
              : null,
            missing.length > 0
              ? h('span', { className: 'gpi-note gpi-note--nowrap' }, `${t('missing')}${missing.join(' / ')}`)
              : null),

          h(Row, { label: t('target') },
            h(Select, {
              value: preset,
              label: t('target'),
              options: TARGETS
                .map((item) => ({ id: String(item.value), label: item.label === 'targetOff' ? t('targetOff') : item.label }))
                .concat({ id: 'custom', label: t('custom') }),
              onChange: (id) => {
                if (id === 'custom') props.onSet({ upscaleTargetLongEdge: targetValue === 0 ? 2048 : targetValue })
                else props.onSet({ upscaleTargetLongEdge: Number(id) })
              },
            }),
            preset === 'custom'
              ? h('input', {
                className: 'gpi-field gpi-field--num',
                type: 'number',
                min: 0,
                step: 16,
                value: form.upscaleTargetLongEdge,
                onChange: (event) => props.onSet({ upscaleTargetLongEdge: Number(event.target.value) }),
              })
              : null),

          h(Row, { label: t('sharpen') },
            h('input', {
              className: 'gpi-range',
              type: 'range',
              min: 0,
              max: 1.5,
              step: 0.1,
              value: form.upscaleSharpen,
              onChange: (event) => props.onSet({ upscaleSharpen: Number(event.target.value) }),
            }),
            h('span', { className: 'gpi-val' }, Number(form.upscaleSharpen).toFixed(1))),

          form.upscaleEngine === 'realesrgan' || unavailable.has('realesrgan')
            ? h(Row, { label: t('realesrganPath') },
              h('input', {
                className: 'gpi-field gpi-field--mono',
                value: form.realesrganPath,
                spellCheck: false,
                placeholder: 'realesrgan-ncnn-vulkan',
                onChange: (event) => props.onSet({ realesrganPath: event.target.value }),
              }))
            : null),

      )
    }

    function Panel(props) {
      const t = (key) => (typeof props?.t === 'function' ? props.t(key) : (zh[key] ?? key))
      const [ready, setReady] = React.useState(false)
      const [loadError, setLoadError] = React.useState(null)
      const [form, setForm] = React.useState(null)
      const [initial, setInitial] = React.useState('')
      const [accountModels, setAccountModels] = React.useState(null)
      const [engineList, setEngineList] = React.useState([])
      const [catalog, setCatalog] = React.useState(FALLBACK_CATALOG)
      const [platform, setPlatform] = React.useState(guessPlatform())
      const [status, setStatus] = React.useState({ kind: '', text: '' })
      const [busy, setBusy] = React.useState(false)
      const [probe, setProbe] = React.useState({ state: 'idle', text: '' })

      const load = React.useCallback(async () => {
        try {
          const data = await getJson('/config')
          const raw = data.raw ?? {}
          const next = {
            baseUrl: raw.baseUrl ?? '',
            apiKey: '',
            defaultModel: raw.defaultModel ?? '',
            fixed: (raw.models ?? []).length > 0,
            models: raw.models ?? [],
            outputDir: raw.outputDir ?? '',
            timeoutMs: raw.timeoutMs ?? 300000,
            autoFallback: raw.autoFallback !== false,
            sizeHintInPrompt: raw.sizeHintInPrompt !== false,
            upscaleEngine: raw.upscaleEngine ?? 'auto',
            upscaleTargetLongEdge: raw.upscaleTargetLongEdge ?? 0,
            upscaleSharpen: raw.upscaleSharpen ?? 0.5,
            realesrganPath: raw.realesrganPath ?? '',
            apiKeyConfigured: raw.apiKeyConfigured === true,
            hostApi: data.api ?? 0,
          }
          setForm(next)
          setInitial(JSON.stringify(next))
          setEngineList(data.upscale?.engines ?? [])
          if (Array.isArray(data.upscale?.catalog) && data.upscale.catalog.length > 0) setCatalog(data.upscale.catalog)
          if (typeof data.upscale?.platform === 'string') setPlatform(data.upscale.platform)
          else setPlatform(guessPlatform())
          setReady(true)
          setLoadError(null)
          return next
        } catch (error) {
          setLoadError(error.message)
          return undefined
        }
      }, [])

      const loadModels = React.useCallback(async () => {
        try {
          const list = pickImageModels(await getJson('/models'))
          setAccountModels(list)
          return list
        } catch {
          setAccountModels([])
          return []
        }
      }, [])

      React.useEffect(() => {
        load().then((next) => { if (next?.apiKeyConfigured) loadModels() })
      }, [load, loadModels])

      if (!ready && loadError == null) return h(PanelView, { t, form: null, loadError: null })

      const set = (patch) => setForm((prev) => ({ ...prev, ...patch }))

      const onFixed = (fixed) => {
        if (form == null || fixed === form.fixed) return
        set({ fixed, models: fixed && form.models.length === 0 ? [...(accountModels ?? [])] : form.models })
      }

      const onToggleModel = (id) => {
        if (form == null) return
        set({ models: form.models.includes(id) ? form.models.filter((item) => item !== id) : [...form.models, id] })
      }

      /** 用表单里当前的值试连一次；宿主端没有 /test 时退到已保存配置。 */
      const onTest = async () => {
        if (form == null) return
        setProbe({ state: 'running', text: t('testing') })
        try {
          const data = await postJson('/test', { baseUrl: form.baseUrl, apiKey: form.apiKey })
          setProbe({ state: 'ok', text: `${t('testOk')} · ${data.imageModels?.length ?? 0} · ${data.latencyMs}ms` })
          if (Array.isArray(data.imageModels) && data.imageModels.length > 0) setAccountModels(unique(data.imageModels))
        } catch (error) {
          try {
            const list = await loadModels()
            setProbe({ state: 'ok', text: `${t('testOk')} · ${list.length} · ${t('testOfSaved')}` })
          } catch {
            setProbe({ state: 'bad', text: error.message })
          }
        }
      }

      const onSave = async () => {
        if (form == null) return
        setBusy(true)
        setStatus({ kind: '', text: t('saving') })
        try {
          await postJson('/config', {
            baseUrl: form.baseUrl,
            apiKey: form.apiKey,
            defaultModel: form.defaultModel,
            modelsText: form.fixed ? form.models.join(', ') : '',
            outputDir: form.outputDir,
            timeoutMs: Number(form.timeoutMs),
            autoFallback: form.autoFallback,
            sizeHintInPrompt: form.sizeHintInPrompt,
            upscaleEngine: form.upscaleEngine,
            upscaleTargetLongEdge: Number(form.upscaleTargetLongEdge),
            upscaleSharpen: Number(form.upscaleSharpen),
            realesrganPath: form.realesrganPath,
          })
          setInitial(JSON.stringify({ ...form, apiKey: '' }))
          setStatus({ kind: 'ok', text: t('saved') })
          await load()
          if (form.apiKey !== '') await loadModels()
        } catch (error) {
          setStatus({ kind: 'bad', text: error.status === 405 ? t('staleHost') : `${t('saveFailed')}：${error.message}` })
        } finally {
          setBusy(false)
        }
      }

      return h(PanelView, {
        t,
        form,
        initial,
        accountModels,
        engineList,
        catalog,
        platform,
        probe,
        status,
        busy,
        loadError,
        onSet: set,
        onFixed,
        onToggleModel,
        onRefresh: loadModels,
        onTest,
        onSave,
      })
    }

    return {
      inject: ['slots', 'locale'],
      // 暴露给结构/渲染测试：过滤规则、安装指令与展示层各只有一处，必须可被验证。
      pickImageModels,
      installPrompt,
      PanelView,
      Logo,
      NavIcon,
      Select,
      Switch,
      Button,
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'gpt-image: locale')
        const inject = () => ({ t: ctx.locale.bind(NS) })
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'gpt-image',
          order: 55,
          label: () => 'GPT Image',
          inject,
        }, Panel))
        // 导航图标按 section id 匹配；id 必须与上面一致，否则不会渲染。
        ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
          name: 'settings.section.icon',
          id: 'gpt-image',
          order: 55,
        }, NavIcon))
      },
    }
  },
})