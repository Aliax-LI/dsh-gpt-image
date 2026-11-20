import assert from 'node:assert/strict'
import { test } from 'node:test'
import { publishVerified } from '../scripts/publish-npm.mjs'

const manifest = { name: '@aliax-li/dsh-gpt-image', version: '1.2.3', dsh: { bundle: { patch: './cordis.patch.yml' } } }
const integrity = 'sha512-fixture'
const published = { ...manifest, dist: { integrity } }
const options = { manifest, integrity, attempts: 2, delay: async () => {} }

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
