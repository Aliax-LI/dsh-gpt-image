# GPT Image 官逆出图

把 GPT Image **官逆**通道接进 DSH，一条链路做完「出图 → 改图 → 补到 4K」。

- **出图**：一句提示词出图，保存到指定的绝对路径，返回绝对路径与像素尺寸。
- **改图**：按指令编辑、换风格、多图融合、套蒙版，最多 16 张参考图。
- **补 4K**：官逆原生短边上限约 1536，落盘后按目标长边在本机放大（Real-ESRGAN / ffmpeg Lanczos3 / Pillow / ImageMagick / sips），macOS、Windows、Linux 通用。
- **一页配置**：**设置 → GPT Image** 里管接口、模型清单与放大参数，改完即时生效。

走 OpenAI 兼容的 `/v1/images/generations` 与 `/v1/images/edits`，所以任何提供这两个端点的兼容网关都能接。模型清单**以账号 `/v1/models` 为准**，插件不带白名单。

## 工具

| 工具 | 用途 |
| --- | --- |
| `gpt_image_generate` | 文生图 |
| `gpt_image_edit` | 改图 / 融合 / 局部重绘 |
| `gpt_image_upscale` | 把已有图片放大到目标长边或倍数 |
| `gpt_image_config` | 查看/修改配置，列出账号可用模型 |

### `gpt_image_generate`

| 参数 | 说明 |
| --- | --- |
| `prompt`（必填） | 主体、构图、光线、材质、风格 |
| `model` | 默认取配置里的 `defaultModel`（缺省 `gpt-image-2.6-flare`） |
| `size` | `1024x1024`、`1536x1024`、`1024x1536`、`3840x2160`、`auto` |
| `output_format` | `png` / `jpeg` / `webp` / `gif` / `svg`；gif 与 svg 仅 2.6 系 |
| `quality` | `low` `medium` `high` `xhigh` `max` `auto` |
| `background` | `auto` `opaque` `transparent` |
| `response_format` | `b64_json`（默认）或 `url` |
| `count` | 1–5，默认 1（客户端并发，服务端不发 `n`） |
| `out`（必填） | 输出文件的绝对路径，包含文件名。自动创建父目录，多张自动加 `-1`、`-2` |
| `target_long_edge` | 生成后自动放大到该长边，`3840` = 4K |
| `upscale` / `sharpen` | 本次使用的放大引擎与锐化强度 |
| `timeoutMs` | 单次请求超时，默认 600000 |
| `bodyStallMs` | 响应体停滞多久判失败，默认 30000 |

### `gpt_image_edit`

`prompt` + `images`（1–16 张，顺序即「图1 / 图2」）+ 可选 `mask`。`images` 和 `mask` 都使用实际文件的绝对路径。`out` 必填，其余参数同出图。改图、融合建议用 `gpt-image-2.6-sunburst` 或 `gpt-image-2.5-sunburst`（编辑精度优先）。

### `gpt_image_upscale`

`path`（必填）、`target_long_edge`、`factor`、`engine`、`sharpen`、`out`。`path` 和指定的 `out` 都使用文件的绝对路径。省略 `out` 时，在源图旁保存为 `原文件名@长边像素.扩展名`。倍数上限 4×，要更大就先用更大的 `size` 出图；SVG（矢量）与 GIF（可能是动图）默认跳过。

### `gpt_image_config`

- `show`：生效配置（密钥打码）与当前模型清单。
- `models`：拉 `/v1/models`，列出账号实际可用的图片模型；报 `model_not_found` 时先跑它。
- `set`：写 `baseUrl` / `apiKey` / `models` / `defaultModel` / `timeoutMs` 等，落盘并热重载。

## 模型与参数

常见的 2.6 / 2.5 / 2 系列按用途分两档：

| 型号 | 定位 | 支持参数 |
| --- | --- | --- |
| `gpt-image-2.6-flare` | 2.6 系，速度优先，日常出图与批量草图（默认） | `size`、`output_format` png/jpeg/webp/gif/svg、`quality`、`mask` |
| `gpt-image-2.6-sunburst` | 2.6 系，编辑精度优先，改图 / 融合 / 蒙版首选 | 同上 |
| `gpt-image-2.5-flare` | 2.5 系，速度优先 | `size`、`output_format` png/jpeg/webp、`quality`、`mask` |
| `gpt-image-2.5-sunburst` | 2.5 系，编辑精度优先 | 同上 |
| `gpt-image-2.5` | 2.5 基础档 | 同上 |
| `gpt-image-2` | 上一代，参数面最窄 | 同上 |

`quality` 在 flat 计价的官逆通道上不保证带来画质差异；`gif` / `svg` 只有 2.6 系支持。目录外的模型按透传处理，参数原样发出，报错以网关为准。

模型清单来自账号的 `GET {base_url}/v1/models`：激活时拉一次，调用时缓存 10 分钟。配置里 `models: []`（默认）表示"跟随账号"，填了才变成固定清单。

插件按模型能力裁剪参数，**不把模型不吃的字段硬塞进去**：

- **`size`** 按需生效；不传时网关给 1312×1199 这类默认画幅，要控画幅就显式传。
- **输出格式参数名是 `output_format`**。`format` 会被网关静默忽略（连非法值都返回 png），所以插件只发 `output_format`；`png`/`jpeg`/`webp` 通用，`gif` 与 `svg` 只在 2.6 系可用，2.5 与 2 传这两个值会被网关拒，插件改按 png 出图并说明原因。
- **`gif` / `svg` 不跟 `size`**：画幅以返回为准。
- **透明底不可用**：传 `background: transparent` 会拿回不带 alpha 的 png，插件丢弃该字段并在 `notes` 里写明。
- **`response_format: url` 可用**：网关回 CDN 直链，插件下载后照常落盘；直链取不下来时自动改用 `b64_json` 重取一次。
- **一次请求可能返回多张**：插件全部落盘并按 `-1` `-2` 编号。
- 目录外的模型按透传处理：给什么发什么，报错以网关为准。

默认模型在当前账号不可用时（`model_not_found`）且调用方没有显式指定 `model`，插件会自动换一个账号里真能用的图片模型重试一次，并在 `notes` 里写明换了谁。设 `autoFallback: false` 或 `GPT_IMAGE_NO_FALLBACK=1` 关闭。

## 放大到 4K

官逆出图原生到不了 4K，插件在落盘后按目标长边补。引擎按可用性自动挑：

| 引擎 | 特点 |
| --- | --- |
| `realesrgan` | Real-ESRGAN（ncnn-vulkan / Python 版），**会合成细节**，2–4× 观感最好；装了才启用 |
| `ffmpeg` | `scale=…:flags=lanczos`，真 Lanczos3 重采样，无幻觉，速度最快 |
| `pillow` | `Image.LANCZOS`，与 ffmpeg 同族，输出略有差异 |
| `magick` | ImageMagick `-resize … -unsharp`，三平台都好装 |
| `sips` | macOS 自带，没有其它引擎时兜底 |

不用 sharp：它的放大路径会退化成 cubic 插值，不如真正的 Lanczos3。

Lanczos 只重采样、放大后偏软，所以默认叠一道轻度锐化（`upscaleSharpen`，0 关闭）。想要"多出细节"而不只是"更锐"，再装 Real-ESRGAN。

**跨平台**：引擎探测是纯 Node 实现（扫 `PATH`，Windows 按 `PATHEXT` 补 `.exe`），不依赖 `which`/`where`，命令用解析出的绝对路径执行。Windows 上 `python3` 自动退到 `python`，`sips` 不进候选，`magick`/`ffmpeg`/Real-ESRGAN 都是 `.exe`。

引擎缺失时设置页给一个 **「复制安装指令」**：复制出来是一整段可直接交给 agent 的话——缺哪个引擎列哪个引擎的安装命令（macOS `brew`/`unzip`、Windows `winget`/PowerShell、Linux `apt`），再附「写回 `realesrganPath`」和「跑一次放大验证」。不用自己查怎么装。

## 设置页

**设置 → GPT Image** 一页管完，行式布局与设置页其它页一致（左标签 + 右控件），下拉复用 DSH 自带的 `Menu`，开关与按钮用 `Switch` / `Button`。

- **模型清单**：打开就按 `/gpt-image/models` 拉账号清单。「跟随账号」下清单只读（右上 `↻` 重取）；切「固定清单」后可点选，一个没选会标红。
- **测试**：API Key 那一行右侧，用**表单里还没保存**的 base_url + Key 打一次 `/v1/models`，回模型数与延迟；成功后顺手刷新清单。
- **放大**：引擎下拉里没装的那项标注「本机不可用」；目标长边是「关 / 2K / 4K / 自定义」；锐化是滑块。
- **保存**：在面板右上角（吸顶），只在有改动时可用，保存后原地变「已保存」。

字段全部 volatile，保存即时生效、不重启插件；写入走 `settings.update`（不可用时退回 `configEditor`），不手改 profile 文件。设置页数据端点是 `GET/POST /gpt-image/config` 与 `GET /gpt-image/models`，只接受本机来源。

## 配置

```yaml
- insert:
    - id: gpt-image
      name: '@local/dsh-gpt-image'
      config:
        baseUrl: https://api.example.com    # 你的 OpenAI 兼容网关
        apiKey: ''            # 也可以留空，改用 GPT_IMAGE_API_KEY
        defaultModel: gpt-image-2.6-flare
        models: []            # 留空 = 以账号 /v1/models 为准
        timeoutMs: 600000
        autoFallback: true
        upscaleEngine: auto
        upscaleTargetLongEdge: 0    # 0 = 不自动放大；3840 = 4K
        upscaleSharpen: 0.5
        realesrganPath: ''
```

优先级：工具参数 > 插件行 config > 环境变量（`GPT_IMAGE_BASE_URL` / `GPT_IMAGE_API_KEY` / `GPT_IMAGE_MODEL` / `GPT_IMAGE_MODELS` / `GPT_IMAGE_UPSCALE` / `GPT_IMAGE_REALESRGAN`）> 缺省值。

## 输出

生成和改图时，用 `out` 指定完整文件路径，例如 Windows 的 `D:/项目/轮播图/01.png`，或 macOS/Linux 的 `/home/user/项目/轮播图/01.png`。图片参数需要包含文件名，Windows 路径需要盘符或 UNC 共享名。模型返回的实际格式决定扩展名，写入时会覆盖同名文件。后续改图或放大可直接使用上一步返回的绝对路径。

从旧版升级后，设置页移除了产物目录，旧 `outputDir` 和 `GPT_IMAGE_OUTPUT_DIR` 值会被忽略。

每次返回开头就写明**落盘目录**，随后是每张图的绝对路径、像素宽高、字节数、`revised_prompt`，以及被通道忽略的参数原因。

改图默认让网关回**直链**（`response_format=url`）：改图的响应体是大块 base64，网关容易在传输中途断开，只回一个 URL 就绕开了这个问题；直链取不到时自动改用 `b64_json`。另外加了**响应体停滞检测**——头部到了但 body 长时间没有新数据就立即失败并换路重试，不会干等到总超时。

## 安装

仓库根目录就是插件包，直接填 git 地址即可：

```
https://github.com/Aliax-LI/dsh-gpt-image.git
```

`github:Aliax-LI/dsh-gpt-image` 这类简写同样可用。在 **Plugins → Add plugin** 填上面任一种，或让 agent 执行：

```json
{ "action": "install_bundle", "target": "https://github.com/Aliax-LI/dsh-gpt-image.git" }
```

pnpm 会拉仓库并自动装唯一依赖 `@deepseek-ai/schemastery`。装完在 **设置 → GPT Image** 填 `base_url` 与 `API Key` 即可（字段全部 volatile，改完即时生效）。

本地开发：

```bash
git clone https://github.com/Aliax-LI/dsh-gpt-image.git
cd dsh-gpt-image && pnpm install
```

然后 **Plugins → Add plugin** 指向这个目录。

宿主端（工具与 HTTP 端点）改动需要重启一次 DSH 才会加载新的 module generation；客户端更新后刷新页面即可。

## 开发

```bash
node tests/selftest.mjs        # 参数闸门、注册、错误路径（不发请求）
node tests/routes.test.mjs     # 设置页端点、图标、配置读写
node tests/client.test.mjs     # 客户端模块契约、渲染层、primitives 复用
node tests/routes.test.mjs --live   # 真机：出图 + 4K 放大（需 GPT_IMAGE_API_KEY）
```

## 限制

- 只覆盖基础出图/改图参数面，不提供 `complexity`、`response_format` 之外的 2.6 新能力。
- 模型可用性由密钥所在分组决定；`model_not_found` 用 `gpt_image_config({action:"models"})` 对照。
- 内容审核拒绝按网关原样转达，不自动重试同一提示词。