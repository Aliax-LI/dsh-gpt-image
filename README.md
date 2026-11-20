# GPT Image 官逆出图

把 GPT Image **官逆**通道接进 DSH，一条链路做完「出图 → 改图 → 补到 4K」。

## 安装

### 中国大陆安装

后续版本通过 **npm 包 + npmmirror** 分发，下载插件本体和依赖都不需要 Git 或 GitHub 仓库连接。大陆索引与通用索引内容同步，只有 npm 下载源不同。

> 发布方式：`0.1.0`–`0.1.2` 是历史 Git 版本；从 `0.1.4` 起，新版本由 GitHub Actions 通过 npm 可信发布（OIDC）分发，发布验证成功后自动加入大陆与通用索引。镜像和 CDN 可能有同步延迟。

1. 在 **插件 → 实验性插件** 启用 **自定义插件索引（Custom plugin indexes）**。
2. 在 **插件 → 发现（Discover）** 添加大陆索引（主入口不通时换备用入口）：

   ```text
   https://cdn.jsdelivr.net/gh/Aliax-LI/dsh-gpt-image@main/plugin-index.cn.json
   ```

   备用：

   ```text
   https://fastly.jsdelivr.net/gh/Aliax-LI/dsh-gpt-image@main/plugin-index.cn.json
   https://raw.githubusercontent.com/Aliax-LI/dsh-gpt-image/main/plugin-index.cn.json
   ```

3. 搜索 **GPT Image 官逆出图** 并安装。大陆索引的 npm 版本会传入 `https://registry.npmmirror.com/` 作为本次安装源。
4. 安装后在 **设置 → GPT Image** 填写网关地址和 API Key。

**不使用索引也可安装：**在 **插件 → 添加插件** 输入 `@aliax-li/dsh-gpt-image`，安装源选择 **中国大陆镜像源**。如需锁定版本，输入 `@aliax-li/dsh-gpt-image@X.Y.Z`，将 `X.Y.Z` 替换为已发布版本。索引 CDN 更新可能滞后；使用包名安装可跳过索引缓存。

npmmirror 同步新版本可能有延迟。如果报插件包或版本不存在，在安装对话框临时选择 **npm 官方源** `https://registry.npmjs.org/` 重试，或稍后再试。当前 DSH 的默认配置会在部分源故障时尝试备选源；用户自定义了源集合时，具体回退顺序以 DSH 配置为准。

### 通用安装与旧版本迁移

通用索引为 `https://raw.githubusercontent.com/Aliax-LI/dsh-gpt-image/main/plugin-index.json`，其新 npm 版本使用官方 npm 源。

已从 Git 安装的 `0.1.x` 切换至 npm 分发时，先记下 **设置 → GPT Image** 的网关、密钥和放大配置，再卸载 Git 版本，按上面的包名方式安装并核对配置。当前 DSH 不会通过 Git 更新入口把已有安装跨来源迁移到 npm。

GitHub 连接受限时，切换 npm 源只会影响 npm 包与依赖，不会改变历史 Git 版本的下载地址。新发布流程还会在 GitHub Release 附带 `.tgz` 插件包和 `SHA256SUMS`：可在能访问的机器下载、校验后传到目标机器，解压 `.tgz`，在解压后的 `package` 目录执行 `pnpm install --prod --ignore-scripts --registry=https://registry.npmmirror.com/`，然后用 **添加插件** 选择该目录。本地包仍需安装依赖；此方式只免去目标机器的 GitHub/Git 下载。

**插件索引与 npm 安装源是两个独立配置：**

| 用途 | 地址 | 填写位置 |
| --- | --- | --- |
| 发现插件和版本 | 上面的大陆索引或通用索引 JSON 地址 | **发现 → 索引源** |
| 下载插件 npm 包和依赖 | `https://registry.npmmirror.com/` 或 `https://registry.npmjs.org/` | 安装对话框的 **安装源（registry）** |

### 安装时出现 `ERR_PNPM_FETCH_404`

如果报错地址包含 `plugin-index.json/@deepseek-ai%2Fschemastery`，说明本次安装把插件索引地址当成了 npm registry。`@deepseek-ai/schemastery@3.19.0` 已发布在 npm；这条 404 本身不表示依赖缺失或需要登录。

1. 保留 **发现** 页中的插件索引地址。
2. 在安装对话框选择 **安装源 → npm 官方源**（`https://registry.npmjs.org/`）后重新安装；也可选择中国大陆镜像源。安装界面会记住所选源，重启应用后仍可能沿用之前的错误地址。
3. 若从 **发现** 发起的安装没有安装源选择器，返回 **插件 → 添加插件**，填入以下固定版本的 Git 地址，并选择正确的 npm 安装源：

   ```text
   git+https://github.com/Aliax-LI/dsh-gpt-image.git#db487dec9de4f224ac9293ca173929e19507c40b
   ```

4. 若选择的是 **pnpm 默认源**，在发生错误的机器上检查 pnpm 配置：

   ```bash
   pnpm config get registry
   pnpm config get @deepseek-ai:registry
   pnpm view @deepseek-ai/schemastery@3.19.0 version --registry=https://registry.npmjs.org/
   ```

   依赖查询正常时输出 `3.19.0`。若前两项有一项输出插件索引地址，修正对应配置所在层级的 registry；同时检查 DSH 插件管理器是否显式配置了相同错误地址。优先使用安装对话框单次选择正确源，无需改动其他项目的 npm 配置。

该问题发生在插件加载之前，修改图片网关 API Key、移除插件依赖或清空 pnpm 缓存均不针对其原因。

## 更新

Git 安装固定到完整 commit 时，从 **插件 → 发现** 更新同仓库的 Git 版本。npm 安装从 **插件 → 已安装 → 插件详情 → 版本** 检查并更新；npm 与 Git 来源之间需要卸载后重新安装。本地目录安装通过更新本地文件并重启 DSH 生效。

## 功能

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
node --test tests/market-index.test.mjs tests/publish-npm.test.mjs  # 双索引与 npm 发布校验
pnpm run test:install         # 联网：临时目录打包 + npmmirror 依赖安装 + 插件导入
# 也可指定官方源：pnpm run test:install --registry https://registry.npmjs.org/
node tests/routes.test.mjs --live   # 真机：出图 + 4K 放大（需 GPT_IMAGE_API_KEY）
```

## 维护者发布配置

1. 在 npm 包的 **Settings → Trusted Publisher → GitHub Actions** 配置信任关系：Organization or user 填 `Aliax-LI`，Repository 填 `dsh-gpt-image`，Workflow filename 只填 `publish-market-index.yml`，Environment 留空，并允许 `npm publish`。新建配置需在页面规定的期限内通过一次 OIDC 发布完成验证。
2. GitHub Actions 使用 `id-token: write` 和 GitHub 托管 runner，由 npm CLI 通过 OIDC 获取短期凭据；不再读取 `NPM_TOKEN`。先完成一次可信发布验证，再撤销旧 npm 发布 token 并删除对应 GitHub Secret。
3. 修改包清单的版本号，运行 `pnpm test`、`pnpm run test:install`，提交后创建并推送 `vX.Y.Z` tag。Actions 验证 tag/包版本、运行测试、打包和发布，并核对包名/版本/bundle 声明及 tarball integrity，再上传 Release 安装包与 SHA-256 校验和。
4. npm 验证成功后才更新通用与大陆两个索引。OIDC 信任匹配失败、发布失败或内容校验失败会中止流程，索引保持原样。可从 **main** 分支手动运行工作流并输入已有 tag，使用当前发布工具重试该 tag 的原始包内容；无需移动历史 tag。已发布版本仅在 tarball integrity 一致时跳过重复发布。
5. 发布完成后确认 npmmirror 已同步，再向大陆用户推荐新版本。CDN 索引可能缓存旧内容，可暂用包名安装。

该工作流没有在插件安装时执行 npm 发布、改写用户全局 registry 或设置第三方 GitHub 代理。

## 限制

- 只覆盖基础出图/改图参数面，不提供 `complexity`、`response_format` 之外的 2.6 新能力。
- 模型可用性由密钥所在分组决定；`model_not_found` 用 `gpt_image_config({action:"models"})` 对照。
- 内容审核拒绝按网关原样转达，不自动重试同一提示词。