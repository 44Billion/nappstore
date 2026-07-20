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
import nostrRelays, { nappRelays } from '#services/nostr-relays.js'
import { getRelays, getBlossomServersByPubkey } from '#helpers/nostr/queries.js'
import { fetchAppMetadata } from '#services/app-metadata-fetcher.js'
import lru from '#services/lru.js'
import '#shared/app-icon.js'
import '#shared/icons/icon-circle-number-1-filled.js'
import '#shared/icons/icon-circle-number-2-filled.js'

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

    async handleFolderSelect (event) {
      const files = Array.from(event.target.files)
      if (files.length === 0) return

      const indexFile = findIndexFile(files)
      if (!indexFile) {
        showToast(
          'Folder must contain an index.html file at the root',
          'error',
          8000
        )
        return
      }

      const faviconFile = findFavicon(files)
      if (!faviconFile) {
        showToast(
          'Folder must contain a favicon file (favicon.ico, favicon.png or .jpg etc)',
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
            'Could not determine app name from index.html <title>',
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
          description: description || 'No description',
          icon: faviconUrl
        })

        let encodedApp
        await publishApp(files, null, {
          onEvent (event) {
            store.uploadProgress$({ progress: event.progress, status: event.type })
            if (event.type === 'init') {
              store.uploadProgress$({ progress: 0, status: '', totalFiles: event.totalFiles, filesProgress: 0 })
            }
            if (event.type === 'file-uploaded' || event.type === 'media-uploaded') {
              const prev = store.uploadProgress$()
              store.uploadProgress$({ ...prev, filesProgress: (prev.filesProgress || 0) + 1 })
            }
            if (event.type === 'manifest-published') {
              store.uploadProgress$({ ...store.uploadProgress$(), status: 'Site manifest and app metadata published' })
            }
            if (event.type === 'complete') {
              encodedApp = event.napp
            }
          }
        })

        const { dTag, pubkey, kind } = appDecode(encodedApp)

        // Store icon in sessionStorage for app-icon component
        if (faviconUrl && encodedApp) {
          try {
            lru.ns('apps').setItem(`appById_${encodedApp}_icon`, { url: faviconUrl })
          } catch (err) {
            console.error('Failed to cache icon:', err)
          }
        }

        const myApps = store.myApps$()
        const existingIndex = myApps.findIndex(a => a.id === encodedApp)
        const appInfo = {
          id: encodedApp,
          dTag,
          pubkey,
          kind,
          name: name || dTag,
          description: description || 'No description',
          icon: faviconUrl,
          uploadedAt: Date.now()
        }

        if (existingIndex >= 0) {
          myApps[existingIndex] = appInfo
        } else {
          myApps.unshift(appInfo)
        }

        store.myApps$(myApps)
        store.selectedFolder$(null)
        store.currentUploadingApp$(null)

        showToast(`App "${name || dTag}" uploaded successfully!`, 'success', 8000)

        // Reset form
        const folderInput = document.getElementById('folder-input')
        if (folderInput) folderInput.value = ''
      } catch (err) {
        console.log('Upload error:', err)
        store.uploadError$(err.message)
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
          return nostrRelays.sendEvent(signedEvent, allRelays)
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
        const url = `${IS_PRODUCTION ? 'https://44billion.net' : 'http://localhost:10000'}/${encodedApp}`
        await navigator.clipboard.writeText(url)
        showToast('URL copied to clipboard!', 'success', 2000)
      } catch (err) {
        console.error('Failed to copy URL:', err)
        showToast('Failed to copy URL', 'error', 2000)
      }
    }
  }))

  // Fetch user's uploaded apps from relays on load
  useTask(async ({ isHotStart }) => {
    if (isHotStart) return
    try {
      store.isLoadingApps$(true)
      const pubkey = await maybePeekPublicKey()
      let { write: writeRelays } = await getRelays(pubkey)
      const PRIMAL_RELAY = 'wss://relay.primal.net'
      writeRelays = [...new Set([...writeRelays, PRIMAL_RELAY])]

      // Fetch all unified site manifest channels authored by this user.
      const [{ result: events }, blossomServersByAuthor] = await Promise.all([
        nostrRelays.getEvents(
          { kinds: [35128, 35129, 35130], authors: [pubkey], limit: 400 },
          writeRelays
        ),
        getBlossomServersByPubkey([pubkey])
      ])
      const blossomServers = blossomServersByAuthor[pubkey] || []

      if (events.length === 0) {
        store.myApps$([])
        store.isLoadingApps$(false)
        return
      }

      // Group by channel and d tag, keeping only the newest replacement.
      const appsByDTag = events.reduce((acc, event) => {
        const dTag = event.tags.find(t => t[0] === 'd')?.[1]
        if (!dTag) return acc

        const key = `${event.kind}:${dTag}`
        if (!acc[key] || event.created_at > acc[key].created_at) {
          acc[key] = event
        }
        return acc
      }, {})

      // Fetch metadata for each app
      const apps = await Promise.all(
        Object.values(appsByDTag).map(async (manifestEvent) => {
          try {
            const dTag = manifestEvent.tags.find(t => t[0] === 'd')[1]

            const metadata = await fetchAppMetadata(manifestEvent, writeRelays, { blossomServers })
            const encodedApp = appEncode({
              dTag,
              pubkey: manifestEvent.pubkey,
              kind: manifestEvent.kind
            })

            // Store icon in sessionStorage for app-icon component
            if (metadata.icon?.url) {
              try {
                lru.ns('apps').setItem(
                  `appById_${encodedApp}_icon`,
                  { fx: metadata.icon.fx, url: metadata.icon.url }
                )
              } catch (err) {
                console.error('Failed to cache icon:', err)
              }
            }

            return {
              id: encodedApp,
              dTag,
              pubkey: manifestEvent.pubkey,
              kind: manifestEvent.kind,
              name: metadata.name || dTag,
              description: metadata.description || 'No description',
              icon: metadata.icon || '',
              uploadedAt: manifestEvent.created_at * 1000
            }
          } catch (err) {
            console.error('Failed to fetch app metadata for manifest event:', err)
            return null
          }
        }).filter(Boolean)
      )

      // Sort by upload date (most recent first)
      apps.sort((a, b) => b.uploadedAt - a.uploadedAt)

      store.myApps$(apps)
    } catch (err) {
      console.error('Failed to fetch apps:', err)
      store.myApps$([])
    } finally {
      store.isLoadingApps$(false)
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
                      color: 'white',
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
              color: 'white',
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
                <style>
                  @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                  }
                </style>
              `
              : myApps.length > 0
                ? this.h`
                  ${myApps.map((app, index) => {
                    const isCurrentlyUploading = currentUploadingApp && currentUploadingApp.dTag === app.dTag
                    const progressPercent = overallProgress
                    const borderColor = isCurrentlyUploading ? cssVars.colors.bgSelected : 'none' // cssVars.colors.bg2

                    const encodedApp = appEncode({
                      dTag: app.dTag,
                      pubkey: app.pubkey,
                      kind: app.kind || 35128
                    })
                    const appUrl = `${IS_PRODUCTION ? 'https://44billion.net' : 'http://localhost:10000'}/${encodedApp}`

                    return this.h({ key: app.id })`
                      <f-to-signals
                        props=${{
                          from: ['app'],
                          app: { id: encodedApp, index },
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
                                  color: cssVars.colors.fg2,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap'
                                }}>
                                  ${app.name}
                                </div>
                                <div style=${{
                                  fontSize: '12px',
                                  color: cssVars.colors.fg2,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  display: '-webkit-box',
                                  WebkitLineClamp: '2',
                                  WebkitBoxOrient: 'vertical'
                                }}>
                                  ${app.description}
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
                                        color: 'white',
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
