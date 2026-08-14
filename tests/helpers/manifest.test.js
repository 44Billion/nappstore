import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  findManifestPathAsset,
  findMarkedManifestAsset,
  getManifestAssets,
  getManifestMetadata,
  getPreferredManifestIconAssets,
  normalizeManifestPath
} from '#helpers/manifest.js'

const ROOT = 'a'.repeat(64)

describe('unified manifests', () => {
  it('normalizes IRFS r tags with several paths and marks', () => {
    const manifest = {
      tags: [
        ['service', 'irfs'],
        ['r', ROOT, 'path /index.html', 'path copy.html', 'mark icon', 'm text/html', 'size 7']
      ]
    }
    const [asset] = getManifestAssets(manifest)
    assert.deepEqual(asset.paths, ['index.html', 'copy.html'])
    assert.equal(asset.size, 7)
    assert.equal(findManifestPathAsset(manifest, path => path === 'index.html').root, ROOT)
    assert.equal(findMarkedManifestAsset(manifest, 'icon').root, ROOT)
  })

  it('reads manifest metadata and defaults absent service to Blossom', () => {
    const manifest = {
      tags: [
        ['path', '/index.html', ROOT],
        ['name', 'App'], ['summary', 'Summary'], ['description', 'Description']
      ]
    }
    assert.equal(getManifestAssets(manifest)[0].service, 'blossom')
    assert.deepEqual(getManifestMetadata(manifest), {
      name: 'App', summary: 'Summary', description: 'Description'
    })
  })

  it('rejects unsafe paths', () => {
    assert.equal(normalizeManifestPath('/assets/app.js'), 'assets/app.js')
    for (const path of ['', '//a', 'a//b', '.', '..', 'a/../b', 'a\\b', 'a\u0000b']) {
      assert.throws(() => normalizeManifestPath(path), /Unsafe/)
    }
  })

  it('prefers a larger conventional icon when the published icon was automatic', () => {
    const smallRoot = 'b'.repeat(64)
    const largeRoot = 'c'.repeat(64)
    const manifest = {
      tags: [
        ['service', 'blossom'],
        ['path', 'favicon-16x16.png', smallRoot],
        ['path', 'apple-touch-icon.png', largeRoot],
        ['r', smallRoot, 'mark icon', 'm image/png'],
        ['auto', 'icon']
      ]
    }
    assert.deepEqual(
      getPreferredManifestIconAssets(manifest).map(asset => asset.root),
      [largeRoot, smallRoot]
    )
  })

  it('preserves an explicitly selected icon ahead of conventional fallbacks', () => {
    const selectedRoot = 'd'.repeat(64)
    const fallbackRoot = 'e'.repeat(64)
    const manifest = {
      tags: [
        ['service', 'blossom'],
        ['path', 'favicon.svg', fallbackRoot],
        ['r', selectedRoot, 'mark icon', 'm image/png']
      ]
    }
    assert.deepEqual(
      getPreferredManifestIconAssets(manifest).map(asset => asset.root),
      [selectedRoot, fallbackRoot]
    )
  })
})
