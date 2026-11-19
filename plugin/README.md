# GPT Image 官逆出图

把 GPT Image **官逆**通道接进 DSH：`gpt_image_generate` 出图，`gpt_image_edit` 改图 / 融合 / 局部重绘，`gpt_image_config` 管配置与查模型。走 OpenAI 兼容的 `/v1/images/generations` 与 `/v1/images/edits`，所以任何兼容网关（API易、自建 sub2api、官方兼容层）都能用。

## 模型清单以 `/v1/models` 为准

插件**不自带模型白名单**。清单来自账号的 `GET {base_url}/v1/models`，每次激活拉一次、调用时缓存 10 分钟；`models: []`（默认）就是这个意思。写进 `models` 才覆盖成固定清单。

当前密钥实测清单（2026-11-19，`https://sub2api.e2mai3lzz.top`）：

| 模型 | 族 | 实测参数面 |
| --- | --- | --- |
| `gpt-image-2.6-flare`（默认） | 2.6 官逆 | size ✔、output_format png/jpeg/webp/**gif/svg**、quality 收但不保证、mask ✔、透明底 ✖ |
| `gpt-image-2.6-sunburst` | 2.6 官逆 | 同上（编辑精度优先，改图 / 融合首选） |
| `gpt-image-2.5-flare` | 2.5 官逆 | size ✔、output_format png/jpeg/webp、quality 收但不保证、mask ✔ |
| `gpt-image-2.5-sunburst` | 2.5 官逆 | 同上 |
| `gpt-image-2.5` | 2.5 官逆 | 同上 |
| `gpt-image-2` | 2 官逆 | 同上 |

"实测参数面"不是照型号名字猜的，是逐项打接口测出来的：

- **size**：`1536x1024` → 返回 1536×1024，`1024x1536` → 1024×1536，**原样生效**。不传 size 时网关默认给 1312×1199 这类非标准画幅，要控画幅就显式传。
- **quality**：`xhigh` / `low` / `high` 都不报错；官逆 flat 计价下无法验证画质差异，所以标"收但不保证"，传了会在 `notes` 里说明。
- **output_format**（注意：不是 `format`）：网关真正认的是 `output_format`。实测 `format=webp/jpeg/gif/svg` 甚至 `format=bogus` 都静默返回 png——**`format` 这个名字整个被忽略**。用 `output_format` 则完全生效：
  - `png` / `jpeg` / `webp`：六个模型都支持（实测 2.6-flare / 2.5-flare / 2 的 jpeg、webp 均按需返回）。
  - `gif` / `svg`：**只有 2.6 系支持**。2.5 与 2 传这两个值直接 `400 GIF output is not enabled for this image model`（SVG 同文）。插件会按模型族拦截，改按 png 出图并在 `notes` 里说明。
  - `gif` / `svg` **不按 `size`**：实测 `1024x1024` 请求得到 411×410 的 gif、1200×900 的 svg，画幅以返回为准。
  - `gif` 走网关时会**偶发回落到 png**（同参数直连 API 多次都出 gif，也出现过返回 png 1312×1199；一次请求里甚至出现 gif + png 各一张）。插件不猜：逐张按实际字节落盘（`.gif` / `.png` 分开），并在 `notes` 写明"请求 gif，其中 1/2 张回落到 image/png"。
  - **一次请求可能返回多张**：`data` 里出现多个条目时插件全部落盘，文件名按 `-1` `-2` 编号，并说明"count 请求 N 张，网关一次返回了 M 张"。
- **response_format**：`url` 生效，网关回 CDN 直链（`https://cdn.e2mai3lzz.top/images/…`），插件下载后照样落盘。
- **background: transparent**：HTTP 200，但返回的 PNG 是 colorType 2（无 alpha）→ 通道不出透明底，插件丢弃该字段并说明。
- **mask**：改图接口接受 `mask` 字段（HTTP 200）。是否严格只在蒙版内改动未做像素级比对，按"随请求发出"处理。

目录外的模型走透传：调用方给什么就发什么，报错按网关为准。

## 放大链路（官逆到不了 4K）

官逆出图原生短边上限约 1536，4K 只能靠本机放大补。插件按下面顺序选引擎：

| 引擎 | 依据 | 说明 |
| --- | --- | --- |
| `realesrgan` | Real-ESRGAN（ncnn-vulkan 或 Python 版） | **会合成新细节**，2–4× 观感最好；需要自己装，装了才自动启用 |
| `ffmpeg` | `scale=…:flags=lanczos` | **真 Lanczos3**，放大不退化；本机已可用 |
| `pillow` | `Image.LANCZOS` | 与 ffmpeg 同族，速度快一点，输出略有差异 |
| `magick` | ImageMagick `-resize … -unsharp` | macOS / Windows / Linux 都能装；`brew`、`winget`、`apt` 各一条命令 |
| `sips` | macOS CoreGraphics | 仅 macOS；没有 ffmpeg / Pillow / ImageMagick 时兜底 |

**sharp 不在候选里。** 它的文档写明 "When upsampling, these kernels map to nearest, linear and cubic interpolators"——`lanczos3` 与 `mks2021` 在放大时都会退化成 cubic，等于只是双三次插值，比 ffmpeg 的真 Lanczos3 差。

Lanczos 只做重采样、放大后偏软，所以默认再叠一道轻度 unsharp（`upscaleSharpen`，0 关闭）：FFmpeg 用 `unsharp=5:5:0.5:5:5:0`，Pillow 用 `UnsharpMask(radius=1.6, percent≈60, threshold=2)`。要"多出细节"而不是"更锐"，才需要 Real-ESRGAN。

**跨平台**：引擎探测是纯 Node 实现（扫 `PATH`，Windows 上按 `PATHEXT` 补 `.exe`），不依赖 `which` / `where`，命令一律用解析出的绝对路径 spawn。所以 macOS、Windows、Linux 走同一套代码：Windows 上 `python3` 自动退到 `python`，`sips` 不出现在候选里，`magick` / `ffmpeg` / Real-ESRGAN 都是 `.exe`。

实测（macOS Apple Silicon）：1536×1024 → 3840×2560，ffmpeg 3.0s / Pillow 0.9s。倍数上限 4×，超过就报错让你先按更大 size 重新出图。SVG 是矢量、GIF 可能是动图，默认跳过。

Real-ESRGAN 想装的话（官方 macOS 可执行文件是 Intel 版，Apple Silicon 走 Rosetta）：

```bash
# 官方便携包（含模型，无需 PyTorch）
curl -LO https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-macos.zip
unzip realesrgan-ncnn-vulkan-20220424-macos.zip -d ~/tools/realesrgan
# 然后在设置页把「Real-ESRGAN 路径」指到 ~/tools/realesrgan/realesrgan-ncnn-vulkan
```

装好后 `upscaleEngine: auto` 会自动优先用它；没有就继续用 ffmpeg Lanczos，不会报错。

## 设置页

**设置 → GPT Image** 一页管完，四组：接口 / 模型 / 产物 / 放大。

- **模型清单从接口来**：面板启动时按 `/gpt-image/models` 拉账号清单，渲染成可点的 chip。`跟随账号` 模式下 chip 只读（就是 `/v1/models` 的实时结果，右上一个 ↻ 重取）；切到 `固定清单` 才可点选，没选任何模型会直接标红。
- **默认模型是下拉**，选项来自账号清单 ∪ 固定清单 ∪ 当前值；固定模式下选了清单外的模型会提示不一致。
- **放大**：引擎是下拉，本机没装的那项在下拉里标「本机不可用」并禁用（`realesrgan` 装好才会可选）；目标长边是「关 / 2K / 4K / 自定义」下拉；锐化是滑块。选中 `realesrgan` 或它不可用时才出现路径输入——没有额外的下载入口，安装交给「复制安装指令」。
- **「复制安装指令」**：只要有引擎缺失，引擎区下方就出现这个按钮。它复制的是一整段可以直接甩给 agent 的话——缺哪个引擎列哪个引擎的安装命令（Real-ESRGAN 官方 macOS 包下载 + 解压 + 赋权 + 自检；ffmpeg 走 brew；Pillow 走 pip），再附「写回 `realesrganPath`」和「跑一次放大验证」两步。用户不需要自己查怎么装。
- **测试**并进了 API Key 那一行（输入框右侧）：用表单里**当前还没保存**的 base_url + API Key 打一次 `/v1/models`，回 `通过 · 8 · 812ms`（模型数 + 延迟）；成功后顺手刷新 chip 清单。宿主端还没有 `/test` 时自动退到已保存配置，并标注「已保存配置」。
- **保存**在面板右上角（跟着面板头部吸顶，长列表滚到哪都能够到），只在有改动时可用，保存后原地变「已保存」；未保存提示、失败信息与「宿主端待重启」都贴在按钮左侧。

字段全部 `.volatile()`，保存即时生效不重启插件；写入走 `settings.update`（失败退回 `configEditor`），不手改 profile 文件。数据端点是 `GET/POST /gpt-image/config` 与 `GET /gpt-image/models`，只接受本机来源。

## 工具

### `gpt_image_generate`

| 参数 | 说明 |
| --- | --- |
| `prompt`（必填） | 主体、构图、光线、材质、风格 |
| `model` | 默认取 `defaultModel`（缺省 `gpt-image-2.6-flare`） |
| `size` | `1024x1024` / `1536x1024` / `1024x1536` / `3840x2160` / `auto` |
| `quality` | `low` `medium` `high` `xhigh` `max` `auto`，收但不保证 |
| `background` | `auto` `opaque` `transparent`；透明底会被忽略并说明 |
| `output_format` | `png` `jpeg` `webp` `gif` `svg`；gif/svg 仅 2.6 系，且不跟 size |
| `response_format` | `b64_json`（默认）/ `url` |
| `count` | 1–5，默认 1（客户端并发，服务端不发 `n`） |
| `out` | 纯文件名 → `<工作目录>/gpt-image-output/`；带目录 → 按该路径；多张自动 `-1` `-2` |
| `timeoutMs` | 单次请求超时，默认 300000 |
| `target_long_edge` | 生成后自动放大到该长边（3840 = 4K）；0/省略按配置 |
| `upscale` / `sharpen` | 本次放大引擎与锐化强度 |

### `gpt_image_edit`

`prompt` + `images`（1–16 张，顺序即「图1/图2」），可选 `mask`。改图建议用 `gpt-image-2.6-sunburst` / `gpt-image-2.5-sunburst`。

### `gpt_image_upscale`

把已有图片放大到目标长边或倍数。参数：`path`（必填）、`target_long_edge`、`factor`、`engine`、`sharpen`、`out`。引擎取值随平台：`darwin` 有 `realesrgan / ffmpeg / pillow / magick / sips`，`win32` 与 `linux` 为前四个。

### `gpt_image_config`

- `show`：生效配置（密钥打码）+ 当前模型清单与各族能力标注。
- `models`：拉 `/v1/models`，列出图片模型并对照配置清单，报 `model_not_found` 时先跑它。
- `set`：写 `baseUrl` / `apiKey` / `models` / `defaultModel` / `outputDir` / `timeoutMs`，经 profile 的 config editor 落盘并热重载。

## 配置

```yaml
- insert:
    - id: gpt-image
      name: '@local/dsh-gpt-image'
      config:
        baseUrl: https://sub2api.e2mai3lzz.top
        apiKey: sk-...
        defaultModel: gpt-image-2.6-flare
        models: []            # 留空 = 以账号 /v1/models 为准
        outputDir: gpt-image-output
        timeoutMs: 300000
```

优先级：工具参数 > 插件行 config > 环境变量（`GPT_IMAGE_BASE_URL` / `GPT_IMAGE_API_KEY` / `GPT_IMAGE_MODEL` / `GPT_IMAGE_MODELS` / `GPT_IMAGE_OUTPUT_DIR`）> 缺省值。

`autoFallback`（默认开）：调用方没显式指定 `model`、而默认模型返回 `model_not_found` 时，从 `/v1/models` 里挑一个真能用的 image 模型重试一次，并在 `notes` 里写明回退了谁。设 `autoFallback: false` 或 `GPT_IMAGE_NO_FALLBACK=1` 关掉。

## 输出

`out` 只给纯文件名时落到**会话工作目录**的 `gpt-image-output/`（不写 `/tmp`）；给带目录的路径就按该路径。返回每张图的绝对路径、像素宽高、字节数、`revised_prompt`，以及被通道忽略的参数原因。

## 图标与面板风格

- **插件卡片图标**：`plugin/icon.svg`，直接取网关自带的 `https://sub2api.e2mai3lzz.top/logo.svg`（2010 字节，自包含 SVG，无外链与脚本）。
- **设置导航与面板标题**：同一枚互锁 S 造型，但做成**单色线性版**（`currentColor`、1.9px 圆头描边），跟「通用设置 / 模型 / 内置插件」那些导航图标同一套视觉，不带品牌绿。
- **面板风格跟随设置页**：左标签 + 右控件、行间细分隔线。下拉直接用 DSH 自带的 `@deepseek-ai/dsh-client-ui-primitives` 里的 `Menu`（与「权限 / 语言 / 更新渠道」同一套弹层与勾选样式），开关用它的 `Switch`，按钮用它的 `Button`；真实环境取不到这个包时才退回原生 `select` / 手写开关，不会整块面板崩掉。没有分组标题，也没有解释性小字——字段标签自己说清楚。
- 宿主仍提供 `GET /gpt-image/icon.svg` 供外部取用（设置页已不再加载它）。

## 安装与生效

```bash
# 插件目录里装依赖（linked bundle 不会替它装 node_modules）
cd plugin && pnpm install
```

然后 **Plugins → Add plugin** 指到 `plugin/` 目录（或用 `plugin_manager install_bundle`）。

宿主端（工具与 HTTP 端点）改动需要**重启一次 DSH** 才加载新的 module generation；客户端半（设置页）随页面刷新生效。设置页顶部会在宿主端还是旧代码时给出提示，不会假装保存成功。

## 限制

- 只覆盖基础出图/改图参数面；`GIF` / `SVG` / `complexity` / `response_format` 等新能力不在本插件。
- 模型可用性由密钥所在分组决定；`model_not_found` 用 `gpt_image_config({action:"models"})` 对照。
- 内容审核拒绝按网关返回原样转达，不自动重试同一提示词。