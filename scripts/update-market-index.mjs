import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'

const [tag, ...options] = process.argv.slice(2)
const usage = 'Usage: node scripts/update-market-index.mjs vX.Y.Z [--source git|npm]'
if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag ?? '')) throw new Error(usage)
if (options.length !== 0 && (options.length !== 2 || options[0] !== '--source' || !['git', 'npm'].includes(options[1]))) {
  throw new Error(usage)
}
const sourceType = options[1] ?? 'git'
const npmRegistry = 'https://registry.npmjs.org/'
const mirrorRegistry = 'https://registry.npmmirror.com/'
const repository = 'https://github.com/Aliax-LI/dsh-gpt-image'
const taggedManifest = JSON.parse(execFileSync('git', ['show', `${tag}:package.json`], { encoding: 'utf8' }))
const version = tag.slice(1)
if (taggedManifest.name !== '@aliax-li/dsh-gpt-image' || taggedManifest.version !== version) {
  throw new Error(`Tag ${tag} must point to @aliax-li/dsh-gpt-image version ${version}`)
}

const commit = execFileSync('git', ['rev-parse', `${tag}^{commit}`], { encoding: 'utf8' }).trim()
if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`Tag ${tag} did not resolve to a full commit`)
const publishTimestamp = Number(execFileSync('git', ['log', '-1', '--format=%ct', commit], { encoding: 'utf8' }).trim())
const source = sourceType === 'npm'
  ? { type: 'npm', registry: npmRegistry }
  : { type: 'git', url: repository, commit }

const indexPath = new URL('../plugin-index.json', import.meta.url)
const index = JSON.parse(await readFile(indexPath, 'utf8'))
const plugin = index.plugins.find((entry) => entry.name === taggedManifest.name)
if (!plugin) throw new Error(`Market index has no entry for ${taggedManifest.name}`)
const existing = plugin.versions.find((entry) => entry.version === version)
if (existing) {
  if (existing.source.type !== source.type
    || (source.type === 'git' && (existing.source.commit !== commit || existing.source.url !== repository))
    || (source.type === 'npm' && (existing.source.registry ?? npmRegistry) !== npmRegistry)) {
    throw new Error(`Version ${version} already points to another source; publish a new version instead`)
  }
  console.log(`${version} is already indexed`)
} else {
  plugin.versions.push({ version, publishTimestamp, source, engines: taggedManifest.engines ?? {} })
  plugin.versions.sort((left, right) => right.publishTimestamp - left.publishTimestamp)
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`)
  console.log(`Indexed ${version} from ${sourceType}`)
}

// A separate index selects the mirror for npm packages only. Historical Git
// releases and any unrelated private registries keep their original sources.
const mainland = structuredClone(index)
mainland.title = { en: 'Aliax plugins (mainland China)', zh: 'Aliax 插件（中国大陆）' }
mainland.description = {
  en: 'npm releases use npmmirror; historical Git releases still download from GitHub.',
  zh: 'npm 版本优先使用 npmmirror；历史 Git 版本仍从 GitHub 下载。',
}
for (const entry of mainland.plugins) {
  for (const release of entry.versions) {
    if (release.source.type === 'npm' && (release.source.registry ?? npmRegistry) === npmRegistry) {
      release.source.registry = mirrorRegistry
    }
  }
}
await writeFile(new URL('../plugin-index.cn.json', import.meta.url), `${JSON.stringify(mainland, null, 2)}\n`)
console.log('Updated mainland China index')
