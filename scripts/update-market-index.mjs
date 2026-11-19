import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'

const tag = process.argv[2]
if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag ?? '')) {
  throw new Error('Usage: node scripts/update-market-index.mjs vX.Y.Z')
}

const repository = 'https://github.com/Aliax-LI/dsh-gpt-image'
const taggedManifest = JSON.parse(execFileSync('git', ['show', `${tag}:package.json`], { encoding: 'utf8' }))
const version = tag.slice(1)
if (taggedManifest.name !== '@aliax-li/dsh-gpt-image' || taggedManifest.version !== version) {
  throw new Error(`Tag ${tag} must point to @aliax-li/dsh-gpt-image version ${version}`)
}

const commit = execFileSync('git', ['rev-parse', `${tag}^{commit}`], { encoding: 'utf8' }).trim()
if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`Tag ${tag} did not resolve to a full commit`)
const publishTimestamp = Number(execFileSync('git', ['log', '-1', '--format=%ct', commit], { encoding: 'utf8' }).trim())

const indexPath = new URL('../plugin-index.json', import.meta.url)
const index = JSON.parse(await readFile(indexPath, 'utf8'))
const plugin = index.plugins.find((entry) => entry.name === taggedManifest.name)
if (!plugin) throw new Error(`Market index has no entry for ${taggedManifest.name}`)
const existing = plugin.versions.find((entry) => entry.version === version)
if (existing) {
  if (existing.source.commit !== commit) throw new Error(`Version ${version} already points to another commit`)
  console.log(`${version} is already indexed`)
} else {
  plugin.versions.push({
    version,
    publishTimestamp,
    source: { type: 'git', url: repository, commit },
    engines: taggedManifest.engines ?? {},
  })
  plugin.versions.sort((left, right) => right.publishTimestamp - left.publishTimestamp)
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`)
  console.log(`Indexed ${version} at ${commit}`)
}
