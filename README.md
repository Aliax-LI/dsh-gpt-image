# dsh-gpt-image

DSH 插件：把 GPT-Image 官逆通道接进 DeepSeek Harness——出图、改图、多图融合，落盘后按目标长边做本机放大补到 4K，并在**设置 → GPT Image** 一页里管完所有配置。

- 模型清单以账号 `GET /v1/models` 为准，插件不自带白名单
- 四个工具：`gpt_image_generate`、`gpt_image_edit`、`gpt_image_upscale`、`gpt_image_config`
- 放大链路按平台探测：Real-ESRGAN（装了才用）> ffmpeg 真 Lanczos3 > Pillow > ImageMagick > sips（仅 macOS）；macOS / Windows / Linux 同一套代码
- 设置页复用 DSH 自带的 `@deepseek-ai/dsh-client-ui-primitives`（`Menu` / `Switch` / `Button`），导航与标题图标是单色版互锁 S

插件本体在 [`plugin/`](plugin/)，详细说明见 [plugin/README.md](plugin/README.md)。

## 安装

### 通过仓库链接（推荐）

在 DSH 的 **Plugins → Add plugin** 里填这个包路径：

```
github:Aliax-LI/dsh-gpt-image#path:/plugin
```

或者让 agent 执行 `plugin_manager`：

```json
{ "action": "install_bundle", "target": "github:Aliax-LI/dsh-gpt-image#path:/plugin" }
```

pnpm 会拉仓库、只取 `plugin/` 这一个包，并自动装它的唯一依赖 `@deepseek-ai/schemastery`。装完在 **设置 → GPT Image** 填 `base_url` 与 `API Key` 即可（字段全部 volatile，改完即时生效）。

### 本地目录

```bash
git clone https://github.com/Aliax-LI/dsh-gpt-image.git
cd dsh-gpt-image/plugin && pnpm install    # 只有本地开发才需要：linked bundle 不替它装依赖
```

然后 **Plugins → Add plugin** 指向本地 `plugin/` 目录。

> 宿主端（工具与 HTTP 端点）改动需要重启一次 DSH 才会加载新的 module generation；客户端半随页面刷新生效。

## 配置

| 字段 | 说明 |
| --- | --- |
| `baseUrl` | OpenAI 兼容接口地址，含 `/v1` 与不含都可以 |
| `apiKey` | 接口密钥；设置页只显示"已配置"，不回明文 |
| `defaultModel` | 默认模型 id，缺省 `gpt-image-2.6-flare` |
| `models` | 固定模型清单；留空 = 以账号 `/v1/models` 为准 |
| `outputDir` | 产物目录（相对会话工作目录），缺省 `gpt-image-output` |
| `timeoutMs` | 单次请求超时，缺省 300000 |
| `autoFallback` | 默认模型不可用时自动换一个账号可用模型 |
| `upscaleEngine` | `auto` / `realesrgan` / `ffmpeg` / `pillow` / `magick` / `sips` / `off` |
| `upscaleTargetLongEdge` | 生成后自动放大到的长边像素；0 = 不放大，3840 = 4K |
| `upscaleSharpen` | Lanczos 放大后的锐化强度（0–1.5） |
| `realesrganPath` | `realesrgan-ncnn-vulkan` 可执行文件路径；留空则在 PATH 里找 |

也可以直接用工具改：`gpt_image_config({ action: "set", baseUrl, apiKey, defaultModel, models })`；`action: "models"` 会列出账号实际可用的图片模型。

## 放大引擎

官逆出图原生短边上限约 1536，4K 靠本机放大补。设置页里只要有引擎缺失，就会出现「复制安装指令」——复制出来是一整段可直接交给 agent 的话，按当前系统给出安装命令（macOS `brew`/`unzip`、Windows `winget`/PowerShell、Linux `apt`），装完再写回 `realesrganPath` 并跑一次验证。

## 开发

```bash
node tests/selftest.mjs        # 参数闸门、注册、错误路径（不发请求）
node tests/routes.test.mjs     # 设置页端点、图标、配置读写
node tests/client.test.mjs     # 客户端模块契约、渲染层、primitives 复用
node tests/routes.test.mjs --live   # 真机：出图 + 4K 放大
```

## License

MIT
