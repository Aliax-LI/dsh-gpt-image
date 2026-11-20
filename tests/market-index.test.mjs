import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const original = new URL('../scripts/update-market-index.mjs', import.meta.url)
const name = '@aliax-li/dsh-gpt-image'
const npmRegistry = 'https://registry.npmjs.org/'
const mirror = 'https://registry.npmmirror.com/'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'gpt-image-market-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'scripts'))
  await copyFile(original, join(root, 'scripts/update-market-index.mjs'))
  await writeFile(join(root, 'package.json'), JSON.stringify({ name, version: '1.2.3', engines: { dsh: '>=0.2.2-rc.5' } }))
  await writeFile(join(root, 'plugin-index.json'), JSON.stringify({
    format: 1,
    title: { en: 'Plugins', zh: '插件' },
    plugins: [{ name, versions: [{
      version: '0.1.2', publishTimestamp: 1,
      source: { type: 'git', url: 'https://github.com/Aliax-LI/dsh-gpt-image', commit: 'a'.repeat(40) },
      engines: { dsh: '>=0.2.2-rc.5' },
    }] }],
  }))
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  git('init', '--quiet')
  git('add', '.')
  git('-c', 'user.name=Release Test', '-c', 'user.email=release@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture')
  git('tag', 'v1.2.3')
  const run = (...args) => spawnSync(process.execPath, ['scripts/update-market-index.mjs', ...args], { cwd: root, encoding: 'utf8' })
  const read = async (file = 'plugin-index.json') => JSON.parse(await readFile(join(root, file), 'utf8'))
  return { root, git, run, read }
}

test('npm release produces official and mainland install sources without GitHub package downloads', async (t) => {
  const { run, read } = await fixture(t)
  const result = run('v1.2.3', '--source', 'npm')
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual((await read()).plugins[0].versions[0].source, { type: 'npm', registry: npmRegistry })
  assert.deepEqual((await read('plugin-index.cn.json')).plugins[0].versions[0].source, { type: 'npm', registry: mirror })
  assert.equal((await read()).plugins[0].versions[1].source.type, 'git', 'historical source stays unchanged')
  assert.deepEqual((await read('plugin-index.cn.json')).plugins[0].versions[1], (await read()).plugins[0].versions[1])
})

test('re-indexing the same npm release is idempotent and repairs a missing mainland index', async (t) => {
  const { root, run, read } = await fixture(t)
  assert.equal(run('v1.2.3', '--source', 'npm').status, 0)
  const before = await read()
  await rm(join(root, 'plugin-index.cn.json'))
  const result = run('v1.2.3', '--source', 'npm')
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(await read(), before)
  assert.equal((await read('plugin-index.cn.json')).plugins[0].versions.length, 2)
})

test('legacy git release remains pinned to the full commit', async (t) => {
  const { git, run, read } = await fixture(t)
  const result = run('v1.2.3')
  assert.equal(result.status, 0, result.stderr)
  assert.equal((await read()).plugins[0].versions[0].source.commit, git('rev-parse', 'v1.2.3^{commit}'))
})

test('an existing release is never silently switched between npm and git', async (t) => {
  const { run, read } = await fixture(t)
  assert.equal(run('v1.2.3').status, 0)
  const before = await read()
  assert.notEqual(run('v1.2.3', '--source', 'npm').status, 0)
  assert.deepEqual(await read(), before)
})

test('invalid source options and tag/version mismatches fail before index writes', async (t) => {
  const { git, run, read } = await fixture(t)
  const before = await read()
  for (const args of [['v1.2.3', '--source', 'tarball'], ['v1.2.3', '--unknown'], ['v1.2.3', '--source']]) {
    assert.notEqual(run(...args).status, 0, args.join(' '))
  }
  git('tag', 'v1.2.4')
  assert.notEqual(run('v1.2.4', '--source', 'npm').status, 0)
  assert.deepEqual(await read(), before)
})
