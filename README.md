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
| `model` | 默认使用配置中的 `defaultModel`。该模型不在清单中时，优先使用清单中的第一项 |
| `size` | 网关出图尺寸，例如 `1024x1024`、`1536x1024`、`1024x1536` 或 `auto` |
| `output_format` | `png` / `jpeg` / `webp` / `gif` / `svg`。已适配的型号中，`gif` 与 `svg` 仅 2.6 系支持 |
| `quality` | `low` `medium` `high` `xhigh` `max` `auto` |
| `background` | 支持 `auto`、`opaque`。官逆通道不支持 `transparent`，插件会在 `notes` 说明 |
| `response_format` | `url`（默认，插件下载直链后保存）或 `b64_json`（将图片数据随响应返回） |
| `count` | 1–5，默认 1（客户端并发，服务端不发 `n`） |
| `out`（必填） | 带文件名的绝对路径，命名规则见[输出](#输出) |
| `target_long_edge` | 落盘后放大的目标长边。`3840` 表示长边 3840 像素，`0` 关闭本次自动放大，省略时使用配置值 |
| `upscale` / `sharpen` | 本次使用的放大引擎与锐化强度 |
| `timeoutMs` | 单次网关请求超时，单位为毫秒，省略时使用插件配置。安装包预设为 `300000` |

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
- **一次请求可能返回多张**。生成和改图工具会保存所有结果。

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
      name: '@aliax-li/dsh-gpt-image'
      config:
        baseUrl: https://api.example.com    # 你的 OpenAI 兼容网关
        apiKey: ''            # 也可以留空，改用 GPT_IMAGE_API_KEY
        defaultModel: gpt-image-2.6-flare
        models: []            # 留空 = 以账号 /v1/models 为准
        timeoutMs: 300000
        bodyStallMs: 30000
        autoFallback: true
        upscaleEngine: auto
        upscaleTargetLongEdge: 0    # 0 = 不自动放大；3840 = 4K
        upscaleSharpen: 0.5
        realesrganPath: ''
```

优先级：工具参数 > 插件行 config > 环境变量（`GPT_IMAGE_BASE_URL` / `GPT_IMAGE_API_KEY` / `GPT_IMAGE_MODEL` / `GPT_IMAGE_MODELS` / `GPT_IMAGE_UPSCALE` / `GPT_IMAGE_REALESRGAN`）> 缺省值。

## 输出

- **生成和改图**都要传 `out`。例如 Windows 用 `D:/项目/轮播图/01.png`，macOS/Linux 用 `/home/user/项目/轮播图/01.png`。Windows 也支持 UNC 共享路径。改图的 `images`、`mask` 和放大的 `path` 都指向已存在的图片文件。
- 插件会创建输出文件的父目录，按网关实际返回的图片格式确定扩展名。一次返回多张时，文件名加 `-1`、`-2` 等编号。最终路径上的同名文件会被覆盖。
- 生成和改图成功时，摘要会列出保存目录、每张图的绝对路径、像素宽高和文件大小。网关返回的改写提示词和本次参数调整会在有内容时显示。如果开启自动放大，原图会保留，放大成功的条目返回放大后的路径。后续改图或放大可直接使用返回的绝对路径。

### 网关响应与重试

生成和改图默认发送 `response_format: url`，收到直链后下载并保存。直链下载失败时，插件会省略 `response_format` 再请求一次，交由网关使用默认响应格式。遇到连接中断等传输错误时，插件也可能换用另一种响应方式重试。

`bodyStallMs` 是插件配置项，默认 `30000` 毫秒，限制收到响应头后连续没有新数据的时间。`timeoutMs` 限制每次网关请求的总时长。

## 安装

1. 在 **插件 → 实验性插件** 启用 **自定义插件索引（Custom plugin indexes）**。
2. 在 **插件 → 发现（Discover）** 添加索引源 `https://raw.githubusercontent.com/Aliax-LI/dsh-gpt-image/main/plugin-index.json`。
3. 搜索 **GPT Image 官逆出图** 并安装。安装后在 **设置 → GPT Image** 填写网关地址和 API Key。

## 更新

从索引安装的插件会固定到某个 Git commit。有新版本时，在 **插件 → 发现（Discover）** 打开插件条目并选择 **更新**。本地目录链接和未固定到 commit 的 Git 安装不支持此入口。

发布时，先更新包清单中的版本号，再为对应提交创建并推送 `vX.Y.Z` tag。GitHub Actions 会验证包名和版本，并将完整 commit SHA 加入市场索引。

## 本地开发

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