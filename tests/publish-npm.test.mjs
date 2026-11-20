import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { publishVerified, createNpmPublisher } from '../scripts/publish-npm.mjs'

const manifest = { name: '@aliax-li/dsh-gpt-image', version: '1.2.3', dsh: { bundle: { patch: './cordis.patch.yml' } } }
const integrity = 'sha512-fixture'
const published = { ...manifest, dist: { integrity } }
const options = { manifest, integrity, attempts: 2, delay: async () => {} }

test('OIDC publishing passes GitHub credentials through without requiring a long-lived token', async () => {
  const calls = []
  const env = { ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.invalid/oidc', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'fixture' }
  const publish = createNpmPublisher({ manifest, filename: 'plugin.tgz', env,
    run: (...args) => calls.push(args),
  })
  await publish()
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'npm')
  assert.ok(calls[0][1].includes('publish'))
  assert.equal(calls[0][1].at(-1), 'latest')
  assert.equal(calls[0][2].env, env)
  assert.equal(calls[0][2].env.NODE_AUTH_TOKEN, undefined)
})

test('prerelease publishing uses next without requiring token authentication', async () => {
  const calls = []
  await createNpmPublisher({ manifest: { ...manifest, version: '1.2.3-rc.1' }, filename: 'plugin.tgz', env: {},
    run: (...args) => calls.push(args),
  })()
  assert.equal(calls[0][1].at(-1), 'next')
})

test('workflow grants OIDC and preserves publishing tools before checking out an older release', async () => {
  const workflow = await readFile(new URL('../.github/workflows/publish-market-index.yml', import.meta.url), 'utf8')
  assert.match(workflow, /id-token: write/)
  assert.doesNotMatch(workflow, /secrets\.NPM_TOKEN/)
  assert.ok(workflow.indexOf('cp scripts/publish-npm.mjs') < workflow.indexOf('git checkout --detach'))
  assert.match(workflow, /run: node "\$RUNNER_TEMP\/publish-npm\.mjs"/)
})

test('publishes a missing npm version, then verifies it before success', async () => {
  const events = []
  const result = await publishVerified({ ...options,
    read: async () => { events.push('read'); return events.includes('publish') ? published : null },
    publish: async () => { events.push('publish') },
  })
  assert.equal(result, 'published')
  assert.deepEqual(events, ['read', 'publish', 'read'])
})

test('re-running a published version only accepts identical tarball integrity', async () => {
  const result = await publishVerified({ ...options, read: async () => published,
    publish: async () => assert.fail('must not republish'),
  })
  assert.equal(result, 'already-published')
  await assert.rejects(publishVerified({ ...options,
    read: async () => ({ ...published, dist: { integrity: 'sha512-different' } }),
    publish: async () => assert.fail('must not overwrite'),
  }), /integrity/)
})

test('a registry outage is not treated as an unpublished package', async () => {
  await assert.rejects(publishVerified({ ...options,
    read: async () => { throw new Error('registry HTTP 503') },
    publish: async () => assert.fail('must not publish after failed lookup'),
  }), /503/)
})

test('verification retries visibility lag, but fails when npm never serves the version', async () => {
  let reads = 0
  assert.equal(await publishVerified({ ...options,
    read: async () => ++reads === 3 ? published : null,
    publish: async () => {},
  }), 'published')
  await assert.rejects(publishVerified({ ...options, read: async () => null, publish: async () => {} }), /not visible/)
})

test('default verification tolerates npm visibility lag beyond ten seconds without republishing', async () => {
  let reads = 0
  let publishes = 0
  const delays = []
  const result = await publishVerified({ manifest, integrity,
    read: async () => ++reads >= 9 ? published : null,
    publish: async () => { publishes++ },
    delay: async (ms) => { delays.push(ms) },
  })
  assert.equal(result, 'published')
  assert.equal(publishes, 1)
  assert.ok(delays.length >= 7)
  assert.ok(delays.every(ms => ms >= 10000))
})

test('wrong package, version or missing bundle declaration blocks indexing', async () => {
  for (const bad of [
    { ...published, name: '@other/plugin' },
    { ...published, version: '9.9.9' },
    { ...published, dsh: undefined },
  ]) {
    await assert.rejects(publishVerified({ ...options, read: async () => bad, publish: async () => {} }), /mismatch|bundle/)
  }
})

test('a publish failure propagates and cannot produce a successful release', async () => {
  await assert.rejects(publishVerified({ ...options, read: async () => null,
    publish: async () => { throw new Error('npm token missing') },
  }), /token missing/)
})
