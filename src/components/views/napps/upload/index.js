import { f, useStore, useTask } from '#f'
import '#f/components/f-to-signals.js'
import {
  extractHtmlMetadata,
  findFavicon,
  findIndexFile,
  fileToDataUrl,
  fileToText
} from '#services/app-metadata.js'
import publishApp from 'nappup'
import { cssVars } from '#assets/styles/theme.js'
import { useToast } from '#shared/toast.js'
import { appEncode, appDecode } from 'libp2r2p/nip19'
import { maybePeekPublicKey } from '#helpers/nostr/nip07.js'
import nostrRelays, { nappRelays, sendEventReport } from '#services/nostr-relays.js'
import { getRelays, getBlossomServersByPubkey } from '#helpers/nostr/queries.js'
import {
  deduplicateEvents,
  fetchAppMetadata,
  needsHtmlMetadataFallback
} from '#services/app-metadata-fetcher.js'
import {
  createUploadAppFromManifestEvent,
  getMetadataText,
  mergeUploadAppMetadata
} from '#helpers/upload-app-listing.js'
import { getAppLauncherUrl } from '#helpers/launcher-url.js'
import { getAppIconLogPrefix } from '#helpers/app.js'
import { getUploadErrorMessage } from '#helpers/upload-error.js'
import lru from '#services/lru.js'
import '#shared/app-icon.js'
import '#shared/icons/icon-circle-number-1-filled.js'
import '#shared/icons/icon-circle-number-2-filled.js'

const APP_METADATA_CONCURRENCY = 4
const APP_METADATA_TIMEOUT_MS = 20000
const BLOSSOM_SERVICES_TIMEOUT_MS = 10000
const RELAY_LOOKUP_TIMEOUT_MS = 10000
const UPLOAD_STATUS_BY_EVENT_TYPE = Object.freeze({
  'services-checking': 'Checking Blossom servers...',
  init: 'Uploading app files...',
  'media-uploaded': 'Uploading app media...',
  'file-uploaded': 'Uploading app files...',
  'manifest-published': 'Site manifest and app metadata published',
  complete: 'Upload complete'
})

// Bounds an auxiliary lookup while safely consuming any eventual late result.
async function withTimeout (promise, timeoutMs, message) {
  let timeoutId
  const deadline = new Promise((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(`${message} after ${timeoutMs}ms`)
      error.name = 'TimeoutError'
      reject(error)
    }, timeoutMs)
  })
  try {
    return await Promise.race([promise, deadline])
  } finally {
    clearTimeout(timeoutId)
  }
}

f('nappsUpload', function () {
  const { showToast } = useToast()
  const store = useStore(() => ({
    selectedFolder$: null,
    isUploading$: false,
    uploadError$: null,
    uploadProgress$: { progress: 0, status: '' },
    myApps$: [],
    isLoadingApps$: false,
    // myApps$: [
    //   {
    //     appId: '+b5U3AYpMmrXcARd0XpAeUsWXOu6Jty0BhEzrakazwCFqXCmBw1VqF',
    //     name: 'Demo App',
    //     description: 'This is a demo napp',
    //     dTag: 'app1',
    //     pubkey: 'fc7085c383ba71745704bdc1c6efcf7fab0197501de598c5e6c537ac0b32a4cb'
    //   },
    //   {
    //     appId: '+b5U3AYpMmrXcARd0XpAeUsWXOu6Jty0BhEzrakazwCFqXCmBw1VqG',
    //     name: 'Demo App 2',
    //     description: 'This is another demo napp',
    //     dTag: 'app2',
    //     pubkey: 'fc7085c383ba71745704bdc1c6efcf7fab0197501de598c5e6c537ac0b32a4cb'
    //   }
    // ],
    currentUploadingApp$: null,

    cacheAppIcon (appId, icon) {
      if (!icon) return
      try {
        lru.ns('apps').setItem(`appById_${appId}_icon`, icon)
      } catch (err) {
        console.error(`${getAppIconLogPrefix(appId)} Failed to cache icon:`, err)
      }
    },

    updateAppMetadata (app, metadata, resolutionPending) {
      this.myApps$(apps => apps.map(current => {
        if (current.id !== app.id || current.manifestId !== app.manifestId) return current
        return mergeUploadAppMetadata(current, metadata, resolutionPending)
      }))
    },

    async resolveAppMetadata (app, manifestEvent, writeRelays, blossomServers, signal) {
      const requestController = new AbortController()
      const abortRequest = () => requestController.abort()
      signal.addEventListener('abort', abortRequest, { once: true })
      let timedOut = false
      const timeoutId = setTimeout(() => {
        timedOut = true
        requestController.abort()
      }, APP_METADATA_TIMEOUT_MS)
      let metadata
      try {
        metadata = await fetchAppMetadata(manifestEvent, writeRelays, {
          blossomServers,
          cachedIcon: lru.ns('apps').getItem(`appById_${app.id}_icon`),
          skipHtml: true,
          appId: app.id,
          signal: requestController.signal
        })
        if (requestController.signal.aborted) return
        this.cacheAppIcon(app.id, metadata.icon)

        const needsHtml = needsHtmlMetadataFallback(metadata)
        this.updateAppMetadata(app, metadata, needsHtml)
        if (needsHtml) {
          metadata = await fetchAppMetadata(manifestEvent, writeRelays, {
            blossomServers,
            cachedIcon: metadata.icon,
            appId: app.id,
            signal: requestController.signal
          })
          if (requestController.signal.aborted) return
          this.cacheAppIcon(app.id, metadata.icon)
        }
      } catch (err) {
        if (timedOut) {
          const error = new Error(`App metadata resolution timed out after ${APP_METADATA_TIMEOUT_MS}ms`)
          error.name = 'TimeoutError'
          console.error(`${getAppIconLogPrefix(app.id)} Failed to fetch app metadata:`, error)
        } else if (err?.name !== 'AbortError') {
          console.error(`${getAppIconLogPrefix(app.id)} Failed to fetch app metadata:`, err)
        }
      } finally {
        clearTimeout(timeoutId)
        signal.removeEventListener('abort', abortRequest)
        if (!signal.aborted) this.updateAppMetadata(app, metadata, false)
      }
    },

    async handleFolderSelect (event) {
      const files = Array.from(event.target.files)
      if (files.length === 0) return
      store.selectedFolder$(null)
      store.uploadError$(null)

      const indexFile = findIndexFile(files)
      if (!indexFile) {
        showToast(
          'Add an index.html file to the folder root, then select it again.',
          'error',
          8000
        )
        return
      }

      const faviconFile = findFavicon(files)
      if (!faviconFile) {
        showToast(
          'Add a favicon file to the folder, then select it again.',
          'error',
          8000
        )
        return
      }

      store.selectedFolder$(files)
      store.uploadError$(null)
    },

    async handleUpload () {
      const files = store.selectedFolder$()
      if (!files || files.length === 0) return
      let uploadPhase = 'preparing'

      store.isUploading$(true)
      store.uploadError$(null)
      store.uploadProgress$({ progress: 0, status: '' })

      try {
        // Extract metadata for pre-upload UI preview
        const indexFile = findIndexFile(files)
        const htmlContent = await fileToText(indexFile)
        const { name, description } = extractHtmlMetadata(htmlContent)
        const faviconFile = findFavicon(files)
        const faviconUrl = faviconFile ? await fileToDataUrl(faviconFile) : null

        if (!name) {
          showToast(
            'Add a <title> to index.html, then select the folder again.',
            'error',
            8000
          )
          store.isUploading$(false)
          return
        }

        const folderName = files[0].webkitRelativePath.split('/')[0].trim()

        store.currentUploadingApp$({
          dTag: folderName,
          name: name || folderName,
          description: description || '',
          icon: faviconUrl
        })

        let encodedApp
        uploadPhase = 'publishing'
        await publishApp(files, null, {
          log (...args) {
            console.info('[nappup]', ...args)
          },
          onEvent (event) {
            const previous = store.uploadProgress$()
            const next = {
              ...previous,
              progress: event.progress,
              status: UPLOAD_STATUS_BY_EVENT_TYPE[event.type] || event.type
            }
            if (event.type === 'init') {
              next.totalFiles = event.totalFiles
              next.filesProgress = 0
            }
            if (event.type === 'file-uploaded' || event.type === 'media-uploaded') {
              next.filesProgress = (previous.filesProgress || 0) + 1
            }
            store.uploadProgress$(next)
            if (event.type === 'complete') {
              encodedApp = event.napp
            }
          }
        })
        uploadPhase = 'finishing'

        const { dTag, pubkey, kind } = appDecode(encodedApp)

        // Cache the uploaded icon for app-icon.
        if (faviconUrl && encodedApp) {
          try {
            lru.ns('apps').setItem(`appById_${encodedApp}_icon`, { url: faviconUrl })
          } catch (err) {
            console.error(`${getAppIconLogPrefix(encodedApp)} Failed to cache icon:`, err)
          }
        }

        const appInfo = {
          id: encodedApp,
          dTag,
          pubkey,
          kind,
          name: name || dTag,
          nameIsFallback: false,
          nameResolutionPending: false,
          description: description || '',
          descriptionResolutionPending: false,
          icon: faviconUrl,
          iconFx: null,
          iconResolutionPending: false,
          uploadedAt: Date.now()
        }

        store.myApps$(current => [appInfo, ...current.filter(app => app.id !== encodedApp)])
        store.selectedFolder$(null)
        store.currentUploadingApp$(null)

        showToast(`App "${name || dTag}" uploaded successfully!`, 'success', 8000)

        // Reset form
        const folderInput = document.getElementById('folder-input')
        if (folderInput) folderInput.value = ''
      } catch (err) {
        console.error('Upload failed:', err)
        store.uploadError$(uploadPhase === 'preparing'
          ? 'Could not read the selected app files. Select the folder again.'
          : uploadPhase === 'finishing'
            ? 'The app uploaded, but this page could not refresh it. Reload the page.'
            : getUploadErrorMessage(err))
        store.currentUploadingApp$(null)
      } finally {
        store.isUploading$(false)
      }
    },

    async handleDeleteApp (app) {
      try {
        const writeRelays = (await getRelays(app.pubkey)).write
        const allRelays = [...new Set([...writeRelays, ...nappRelays])]

        const manifestKind = app.kind || 35128

        const { result: events } = await nostrRelays.getEvents(
          { kinds: [manifestKind], authors: [app.pubkey], '#d': [app.dTag] },
          allRelays
        )

        const currentManifest = events
          .filter(event => event.kind === manifestKind)
          .sort((a, b) => b.created_at - a.created_at || String(a.id).localeCompare(String(b.id)))[0]
        const toDelete = [currentManifest].filter(Boolean)

        if (toDelete.length === 0) {
          showToast(`Could not find events to delete for "${app.name}"`, 'error', 4000)
          return
        }

        const results = await Promise.all(toDelete.map(async (event) => {
          const deletionEvent = {
            kind: 5,
            created_at: Math.floor(Date.now() / 1000),
            tags: [
              ['e', event.id],
              ['a', `${manifestKind}:${app.pubkey}:${app.dTag}`]
            ],
            content: ''
          }
          const signedEvent = await window.nostr.signEvent(deletionEvent)
          return sendEventReport(signedEvent, allRelays)
        }))

        const totalAttempts = toDelete.length * allRelays.length
        const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0)
        const successCount = totalAttempts - totalErrors

        if (successCount === 0) {
          showToast(`Failed to delete app "${app.name}"`, 'error', 5000)
          return
        }

        if (successCount === totalAttempts) {
          showToast(`App "${app.name}" deleted successfully`, 'success', 3000)
        } else {
          showToast(
            `App "${app.name}" partially deleted (${successCount}/${totalAttempts} relay acks)`,
            'info',
            5000
          )
        }

        const myApps = store.myApps$()
        store.myApps$(myApps.filter(a =>
          a.dTag !== app.dTag || a.pubkey !== app.pubkey || (a.kind || 35128) !== manifestKind
        ))
      } catch (err) {
        console.error('Failed to delete app:', err)
        showToast(`Failed to delete app "${app.name}"`, 'error', 5000)
      }
    },

    async handleCopyUrl (app) {
      try {
        const encodedApp = appEncode({
          dTag: app.dTag,
          pubkey: app.pubkey,
          kind: app.kind || 35128
        })
        const url = getAppLauncherUrl(encodedApp)
        await navigator.clipboard.writeText(url)
        showToast('URL copied to clipboard!', 'success', 2000)
      } catch (err) {
        console.error('Failed to copy URL:', err)
        showToast('Failed to copy URL', 'error', 2000)
      }
    }
  }))

  // Fetch user's uploaded apps from relays on load
  useTask(async ({ isHotStart, cleanup }) => {
    if (isHotStart) return
    const controller = new AbortController()
    cleanup(() => controller.abort())

    try {
      store.isLoadingApps$(true)
      const pubkey = await maybePeekPublicKey()
      if (!pubkey || controller.signal.aborted) {
        store.myApps$([])
        return
      }

      let writeRelays = []
      try {
        writeRelays = (await withTimeout(
          getRelays(pubkey),
          RELAY_LOOKUP_TIMEOUT_MS,
          'Relay lookup timed out'
        ))?.write || []
      } catch (err) {
        console.error('Failed to fetch app author relays:', err)
      }
      const PRIMAL_RELAY = 'wss://relay.primal.net'
      writeRelays = [...new Set([...writeRelays, ...nappRelays, PRIMAL_RELAY])]

      const blossomServersPromise = withTimeout(
        getBlossomServersByPubkey([pubkey]),
        BLOSSOM_SERVICES_TIMEOUT_MS,
        'Blossom server lookup timed out'
      ).catch(err => {
        console.error('Failed to fetch app author Blossom servers:', err)
        return {}
      })
      const { result: events } = await nostrRelays.getEvents(
        { kinds: [35128, 35129, 35130], authors: [pubkey], limit: 400 },
        writeRelays
      )
      if (controller.signal.aborted) return

      if (events.length === 0) {
        store.myApps$([])
        return
      }

      const entries = deduplicateEvents(events).flatMap(manifestEvent => {
        const app = createUploadAppFromManifestEvent(manifestEvent)
        return app ? [{ app, manifestEvent }] : []
      })
      entries.sort((a, b) => b.app.uploadedAt - a.app.uploadedAt)

      // Publish manifest metadata immediately instead of waiting for the slowest app.
      store.myApps$(current => {
        const localApps = current.filter(app => !app.manifestId)
        const localIds = new Set(localApps.map(app => app.id))
        return [...localApps, ...entries
          .map(entry => entry.app)
          .filter(app => !localIds.has(app.id))
        ].sort((a, b) => b.uploadedAt - a.uploadedAt)
      })
      store.isLoadingApps$(false)

      const blossomServersByAuthor = await blossomServersPromise
      if (controller.signal.aborted) return
      const blossomServers = blossomServersByAuthor[pubkey] || []
      for (let index = 0; index < entries.length; index += APP_METADATA_CONCURRENCY) {
        if (controller.signal.aborted) return
        const batch = entries.slice(index, index + APP_METADATA_CONCURRENCY)
        await Promise.all(batch.map(({ app, manifestEvent }) =>
          store.resolveAppMetadata(
            app,
            manifestEvent,
            writeRelays,
            blossomServers,
            controller.signal
          )
        ))
      }
    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.error('Failed to fetch apps:', err)
        store.myApps$([])
      }
    } finally {
      if (!controller.signal.aborted) store.isLoadingApps$(false)
    }
  })

  const selectedFolder = store.selectedFolder$()
  const isUploading = store.isUploading$()
  const uploadProgress = store.uploadProgress$()
  const myApps = store.myApps$()
  const isLoadingApps = store.isLoadingApps$()
  const uploadError = store.uploadError$()
  const currentUploadingApp = store.currentUploadingApp$()

  const overallProgress = uploadProgress.progress || 0

  return this.h`
    <div style=${{
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
        padding: '20px',
        maxWidth: '600px',
        margin: '0 auto',
        fontSize: '14px'
      }}>
        <style>
          @keyframes myAppsMetadataPulse {
            0% { opacity: 0.35; }
            50% { opacity: 0.7; }
            100% { opacity: 0.35; }
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        </style>
        <!-- Header Section -->
        <div style=${{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}>
          <div style=${{
            fontSize: '18px',
            fontWeight: 'bold',
            color: cssVars.colors.fg
          }}>
            Upload Your App
          </div>

          <!-- Steps -->
          <div style=${{
            fontSize: '17rem',
            color: cssVars.colors.fgInfo,
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <icon-circle-number-1-filled
              props=${{
                size: '1.3em',
                strokeWidth: 0,
                weight: 'fill',
                style: `
                  svg {
                    flex-shrink: 0;
                  }
                `
              }} />
            <span
              style=${{ color: cssVars.colors.fg }}
            >Put your static website files in a folder with a unique name</span>
          </div>
          <div style=${{
            fontSize: '17rem',
            color: cssVars.colors.fgInfo,
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <icon-circle-number-2-filled
              props=${{
                size: '1.3em',
                strokeWidth: 0,
                weight: 'fill',
                style: `
                  svg {
                    flex-shrink: 0;
                  }
                `
              }} />
            <span
              style=${{ color: cssVars.colors.fg }}
            >Upload it to magically become a Nostr app living on relays</span>
          </div>
        </div>

        <!-- Upload Section -->
        <div style=${{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          padding: '16px',
          backgroundColor: cssVars.colors.bg2,
          borderRadius: '8px'
        }}>
          <label style=${{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            padding: '20px',
            borderRadius: '6px',
            backgroundColor: cssVars.colors.bg3,
            color: cssVars.colors.fg3,
            fontSize: '14px',
            fontWeight: 'bold',
            transition: 'all 0.2s'
          }}>
            <span>${selectedFolder ? '✓ Folder Selected' : '📁 Select Folder'}</span>
            <input
              type="file"
              webkitdirectory
              mozdirectory
              onchange=${store.handleFolderSelect}
              style=${{ display: 'none' }}
            />
          </label>

          ${
            selectedFolder
              ? this.h`
                    <div style=${{
                      fontSize: '12px',
                      color: cssVars.colors.fg2,
                      padding: '8px',
                      backgroundColor: cssVars.colors.bg,
                      borderRadius: '4px'
                    }}>
                      Files: ${selectedFolder.length} files ready
                    </div>
                  `
              : ''
          }

          ${
            uploadError
              ? this.h`
                    <div style=${{
                      padding: '10px',
                      backgroundColor: cssVars.colors.error,
                      color: cssVars.colors.fgOnAccent,
                      borderRadius: '4px',
                      fontSize: '12px'
                    }}>
                      ✗ ${uploadError}
                    </div>
                  `
              : ''
          }

          ${
            isUploading
              ? this.h`
                    <div style=${{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px'
                    }}>
            <div style=${{ fontSize: '12px', color: cssVars.colors.fg2 }}>
              Uploading... ${overallProgress}%
            </div>
            <div style=${{
              width: '100%',
              height: '6px',
              backgroundColor: cssVars.colors.bg,
              borderRadius: '3px',
              overflow: 'hidden'
            }}>
            <div style=${{
              height: '100%',
              backgroundColor: cssVars.colors.bgSelected,
              width: overallProgress + '%',
              transition: 'width 0.3s'
            }} />
            </div>
            ${
              uploadProgress.status
                ? this.h`
                          <div style=${{ fontSize: '11px', color: cssVars.colors.fgInfo }}>
                            ${uploadProgress.status}
                          </div>
                        `
                : ''
            }
                      </div>
                    `
                : ''
            }

          <button
            onclick=${store.handleUpload}
            disabled=${!selectedFolder || isUploading}
            style=${{
              padding: '12px',
              backgroundColor: selectedFolder && !isUploading
                ? cssVars.colors.bgSelected
                : cssVars.colors.bg3,
              color: selectedFolder && !isUploading
                ? cssVars.colors.fgOnAccent
                : cssVars.colors.fg3,
              border: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: 'bold',
              cursor: selectedFolder && !isUploading ? 'pointer' : 'not-allowed',
              opacity: selectedFolder && !isUploading ? 1 : 0.5,
              transition: 'all 0.2s',
              textAlign: 'center'
            }}
          >
            ${isUploading ? '⏳ Uploading...' : 'Upload App'}
          </button>
        </div>

        <!-- My apps Section -->
        <div style=${{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}>
          <div style=${{
            fontSize: '16px',
            fontWeight: 'bold',
            color: cssVars.colors.fg,
            paddingBottom: '8px'
          }}>
            My Apps
          </div>

          ${
            isLoadingApps
              ? this.h`
                <div style=${{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '40px 20px',
                  gap: '16px'
                }}>
                  <div style=${{
                    width: '40px',
                    height: '40px',
                    border: '3px solid ' + cssVars.colors.bg2,
                    borderTop: '3px solid ' + cssVars.colors.bgSelected,
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite'
                  }} />
                  <div style=${{
                    fontSize: '14px',
                    color: cssVars.colors.fg2
                  }}>
                    Loading your apps...
                  </div>
                </div>
              `
              : myApps.length > 0
                ? this.h`
                  ${myApps.map((app, index) => {
                    const isCurrentlyUploading = currentUploadingApp && currentUploadingApp.dTag === app.dTag
                    const progressPercent = overallProgress
                    const borderColor = isCurrentlyUploading
                      ? cssVars.colors.bgSelected
                      : cssVars.colors.bg2
                    const name = getMetadataText(app.name) || app.dTag
                    const isNamePending = app.nameResolutionPending === true
                    const isNameFallback = !isNamePending && app.nameIsFallback === true
                    const description = getMetadataText(app.description)
                    const isDescriptionPending = app.descriptionResolutionPending === true
                    const isDescriptionFallback = !isDescriptionPending && !description

                    const encodedApp = app.id
                    const appUrl = getAppLauncherUrl(encodedApp)

                    return this.h({ key: app.id })`
                      <f-to-signals
                        props=${{
                          from: ['app'],
                          app: {
                            id: encodedApp,
                            index,
                            name,
                            fx: app.iconFx,
                            iconResolutionPending: app.iconResolutionPending
                          },
                          render: ({ h, props }) => h`
                            <div style=${{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '8px',
                              padding: '12px',
                              backgroundColor: cssVars.colors.bg,
                              borderRadius: '8px',
                              border: '1px solid ' + borderColor,
                              transition: 'all 0.3s',
                              order: isCurrentlyUploading ? -1 : index
                            }}>
                              <div style=${{
                                display: 'flex',
                                gap: '12px'
                              }}>
                                <div style=${{
                                  width: '48px',
                                  height: '48px',
                                  flexShrink: 0,
                                  backgroundColor: cssVars.colors.bg2,
                                  borderRadius: '10px',
                                  overflow: 'hidden',
                                  color: cssVars.colors.fg2
                                }}>
                                  <app-icon props=${props} />
                                </div>

                          <div style=${{
                            flex: 1,
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            minWidth: 0
                          }}>
                            <div style=${{
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: '8px'
                            }}>
                              <div style=${{ flex: 1, minWidth: 0 }}>
                                <div style=${{
                                  fontSize: '14px',
                                  fontWeight: 'bold',
                                  color: isNamePending ? 'transparent' : cssVars.colors.fg2,
                                  opacity: isNameFallback ? 0.75 : 1,
                                  fontStyle: isNameFallback ? 'italic' : 'normal',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  width: isNamePending ? '45%' : 'auto',
                                  minHeight: '16px',
                                  borderRadius: isNamePending ? '7px' : '0',
                                  backgroundColor: isNamePending
                                    ? cssVars.colors.bgAvatarLoading
                                    : 'transparent',
                                  animation: isNamePending
                                    ? 'myAppsMetadataPulse 1.4s ease-in-out infinite'
                                    : 'none'
                                }}>
                                  ${isNamePending ? '' : name}
                                </div>
                                <div style=${{
                                  fontSize: '12px',
                                  color: isDescriptionPending ? 'transparent' : cssVars.colors.fg2,
                                  opacity: isDescriptionFallback ? 0.6 : 1,
                                  fontStyle: isDescriptionFallback ? 'italic' : 'normal',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  display: '-webkit-box',
                                  WebkitLineClamp: '2',
                                  WebkitBoxOrient: 'vertical',
                                  width: isDescriptionPending ? '70%' : 'auto',
                                  maxWidth: '100%',
                                  minHeight: '14px',
                                  borderRadius: isDescriptionPending ? '7px' : '0',
                                  backgroundColor: isDescriptionPending
                                    ? cssVars.colors.bgAvatarLoading
                                    : 'transparent',
                                  animation: isDescriptionPending
                                    ? 'myAppsMetadataPulse 1.4s ease-in-out infinite'
                                    : 'none'
                                }}>
                                  ${isDescriptionPending ? '' : description || 'No description'}
                                </div>
                              </div>
                              <button
                                onclick=${() => store.handleDeleteApp(app)}
                                title="Delete app"
                                style=${{
                                  background: 'none',
                                  border: 'none',
                                  cursor: 'pointer',
                                  fontSize: '16px',
                                  padding: '2px 4px',
                                  flexShrink: 0,
                                  lineHeight: 1,
                                  color: cssVars.colors.fg2,
                                  transition: 'opacity 0.2s'
                                }}
                                onmouseover=${function () { this.style.opacity = '0.7' }}
                                onmouseout=${function () { this.style.opacity = '1' }}
                              >
                                🗑
                              </button>
                            </div>

                            ${isCurrentlyUploading
                              ? h`
                                <div style=${{
                                  fontSize: '11px',
                                  color: cssVars.colors.fg2,
                                  marginTop: '3px',
                                  marginBottom: '1px'
                                }}>
                                  ⏳ Uploading... ${progressPercent}%
                                </div>
                              `
                              : (!appUrl
                                ? ''
                                : h`
                                  <div style=${{
                                    display: 'flex',
                                    gap: '8px',
                                    alignItems: 'center'
                                  }}>
                                    <button
                                      onclick=${() => store.handleCopyUrl(app)}
                                      style=${{
                                        // padding: '6px 10px',
                                        color: cssVars.colors.fg2,
                                        border: 'none',
                                        fontSize: '11px',
                                        fontWeight: 'bold',
                                        cursor: 'pointer',
                                        flexShrink: 0,
                                        transition: 'opacity 0.2s'
                                      }}
                                      onmouseover=${function () { this.style.opacity = '0.8' }}
                                      onmouseout=${function () { this.style.opacity = '1' }}
                                    >
                                      📋 Copy
                                    </button>
                                    <div style=${{
                                      flex: 1,
                                      fontSize: '11px',
                                      color: cssVars.colors.fg2,
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                      fontFamily: 'monospace',
                                      lineHeight: 1.6
                                    }}>
                                      ${appUrl}
                                    </div>
                                  </div>
                                `
                              )
                            }
                          </div>
                        </div>
                            </div>
                          `
                        }}
                      />
                    `
                  })}
                `
                : this.h`
                  <div style=${{
                    padding: '40px 20px',
                    textAlign: 'center',
                    color: cssVars.colors.fg2,
                    fontSize: '14px'
                  }}>
                    You haven't uploaded any apps yet.
                  </div>
                `
          }
        </div>
    </div>
  `
})
