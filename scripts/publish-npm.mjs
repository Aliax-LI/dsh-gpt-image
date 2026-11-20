import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Publishing and verification finish before the workflow changes either index. */
export async function publishVerified({ manifest, integrity, read, publish, attempts = 6, delay = (ms) => new Promise((done) => setTimeout(done, ms)) }) {
  const verify = (remote) => {
    assert.equal(remote.name, manifest.name, 'Published package name mismatch')
    assert.equal(remote.version, manifest.version, 'Published version mismatch')
    assert.equal(remote.dsh?.bundle?.patch, manifest.dsh?.bundle?.patch, 'Published bundle declaration mismatch')
    assert.ok(remote.dsh?.bundle?.patch, 'Published bundle declaration missing')
    assert.equal(remote.dist?.integrity, integrity, 'Published tarball integrity mismatch')
  }
  const existing = await read()
  if (existing !== null) {
    verify(existing)
    return 'already-published'
  }
  await publish()
  for (let attempt = 0; attempt < attempts; attempt++) {
    const remote = await read()
    if (remote !== null) {
      verify(remote)
      return 'published'
    }
    if (attempt < attempts - 1) await delay(2000)
  }
  throw new Error('Published version is not visible on npm; indexes were not updated')
}

async function main() {
  const manifest = JSON.parse(await readFile('package.json', 'utf8'))
  const [pack] = JSON.parse(await readFile('release-artifacts/pack.json', 'utf8'))
  assert.equal(pack.name, manifest.name)
  assert.equal(pack.version, manifest.version)
  assert.ok(pack.integrity)
  assert.ok(manifest.private !== true, 'Package must allow public publishing')
  const registry = 'https://registry.npmjs.org/'
  const endpoint = `${registry}${encodeURIComponent(manifest.name)}/${manifest.version}`
  const read = async () => {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(15000), headers: { accept: 'application/json' } })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`npm registry HTTP ${response.status}`)
    return response.json()
  }
  const publish = async () => {
    assert.ok(process.env.NODE_AUTH_TOKEN, 'Configure repository secret NPM_TOKEN before releasing')
    const distTag = manifest.version.includes('-') ? 'next' : 'latest'
    execFileSync('npm', ['publish', resolve('release-artifacts', pack.filename), '--access', 'public', '--registry', registry, '--tag', distTag], { stdio: 'inherit' })
  }
  console.log(await publishVerified({ manifest, integrity: pack.integrity, read, publish }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main()
