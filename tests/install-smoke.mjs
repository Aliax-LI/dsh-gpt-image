// Opt-in network smoke test. All package-manager writes stay in a temp dir.
// node tests/install-smoke.mjs [--registry https://registry.npmmirror.com/]
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
assert.ok(args.length === 0 || (args.length === 2 && args[0] === '--registry'), 'Usage: node tests/install-smoke.mjs [--registry URL]')
const registry = new URL(args[1] ?? 'https://registry.npmmirror.com/')
assert.ok(registry.protocol === 'https:' && !registry.username && !registry.password && registry.pathname === '/', 'Use a registry origin, not a plugin index URL')
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8'))
const root = await mkdtemp(join(tmpdir(), 'gpt-image-install-'))
const run = (command, commandArgs, cwd) => {
  const result = spawnSync(command, commandArgs, { cwd, encoding: 'utf8', timeout: 120000 })
  if (result.error) throw result.error
  assert.equal(result.status, 0, `${command} failed\n${result.stdout}\n${result.stderr}`)
  return result.stdout
}
try {
  const artifacts = join(root, 'artifacts')
  await mkdir(artifacts)
  const [pack] = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', artifacts], repository))
  assert.equal(pack.name, manifest.name)
  assert.equal(pack.version, manifest.version)
  for (const file of ['index.js', 'client.js', 'cordis.patch.yml', 'locale/en.json', 'locale/zh.json', 'icon.svg', 'lib/config.js']) {
    assert.ok(pack.files.some(entry => entry.path === file), `Missing packed file: ${file}`)
  }
  const consumer = join(root, 'consumer')
  await mkdir(consumer)
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: 'install-smoke', private: true, type: 'module' }))
  console.log(run('pnpm', ['add', join(artifacts, pack.filename), '--ignore-scripts', '--store-dir', join(root, 'store'), '--fetch-retries=0', '--fetch-timeout=20000', `--registry=${registry.href}`], consumer))
  console.log(run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    const plugin = await import(${JSON.stringify(manifest.name)});
    assert.equal(typeof plugin.apply, 'function');
    assert.ok(plugin.Config);
    console.log('PASS: plugin imports with its Config schema');
  `], consumer))
  console.log(`PASS: ${manifest.name}@${manifest.version} installs via ${registry.href} without Git`)
} finally {
  await rm(root, { recursive: true, force: true })
}
