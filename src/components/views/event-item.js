import { f, useStore } from '#f'

f(function eventItem () {
  const store = useStore(() => ({
    isExpanded$: false,
    isContentExpanded$: false,
    copied$: false
  }))

  const toggleExpand = () => store.isExpanded$(!store.isExpanded$())
  const toggleContentExpand = () => store.isContentExpanded$(!store.isContentExpanded$())

  const event = this.props.event$?.() || this.props.event

  if (!event) {
    return this.h`<div style="color: red;">No event data received</div>`
  }

  const copyToClipboard = () => {
    navigator.clipboard.writeText(JSON.stringify(event, null, 2))
    store.copied$(true)
    setTimeout(() => store.copied$(false), 2000)
  }

  const formatDate = (timestamp) => {
    return new Date(timestamp * 1000).toLocaleString()
  }

  const truncateId = (id) => {
    return `${id.slice(0, 8)}...${id.slice(-8)}`
  }

  const getEventKindLabel = (kind) => {
    const kindLabels = {
      0: 'Profile',
      1: 'Text Note',
      2: 'Recommend Relay',
      3: 'Contacts',
      4: 'Encrypted Direct Message',
      5: 'Event Deletion',
      6: 'Repost',
      7: 'Reaction',
      40: 'Channel Creation',
      41: 'Channel Metadata',
      42: 'Channel Message',
      43: 'Channel Hide Message',
      44: 'Channel Mute User'
    }
    return kindLabels[kind] || `Kind ${kind}`
  }

  const renderFieldValue = (key, value) => {
    if (key === 'content') {
      const isLong = value.length > 200
      const displayValue = isLong && !store.isContentExpanded$()
        ? value.slice(0, 200) + '...'
        : value

      return this.h`
        <div class="field-content">
          <div class="content-text">${displayValue}</div>
          ${(isLong || '') && this.h`
            <button class="content-toggle" onclick=${(e) => { e.preventDefault(); toggleContentExpand() }}>
              ${store.isContentExpanded$() ? 'Show less' : 'Show more'}
            </button>
          `}
        </div>
      `
    }

    if (key === 'created_at') {
      return this.h`<span class="timestamp">${formatDate(value)}</span>`
    }

    if (key === 'id' || key === 'pubkey' || key === 'sig') {
      return this.h`
        <span class="hash-value" title="${value}">
          ${truncateId(value)}
        </span>
      `
    }

    if (key === 'tags' && Array.isArray(value)) {
      return this.h`
        <div class="tags-container">
          ${value.map(tag => this.h`
            <div class="tag-item">
              ${Array.isArray(tag)
                ? tag.map((item, i) => this.h`
                  <span class=${`tag-part ${i === 0 ? 'tag-key' : 'tag-value'}`}>${item}</span>
                `)
                : tag}
            </div>
          `)}
        </div>
      `
    }

    if (typeof value === 'object') {
      return this.h`<pre class="json-value">${JSON.stringify(value, null, 2)}</pre>`
    }

    return this.h`<span class="simple-value">${value}</span>`
  }

  return this.h`
    <style>${`
      .event-item {
        background: var(--bg-secondary);
        border: 1px solid var(--border);
        border-radius: 12px;
        margin-bottom: 16px;
        overflow: hidden;
        transition: all 0.2s ease;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      }

      .event-item:hover {
        border-color: var(--border-light);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
      }

      .event-header {
        padding: 16px 20px;
        cursor: pointer;
        background: var(--bg-tertiary);
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid var(--border);
        transition: background-color 0.2s ease;
      }

      .event-header:hover {
        background: rgba(255, 255, 255, 0.02);
      }

      .event-info {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .event-title {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
      }

      .event-kind {
        background: var(--accent);
        color: white;
        padding: 4px 8px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .event-id {
        font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
        font-size: 14px;
        color: var(--text-secondary);
        font-weight: 500;
      }

      .event-meta {
        display: flex;
        align-items: center;
        gap: 16px;
        font-size: 13px;
        color: var(--text-muted);
      }

      .meta-item {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .header-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .copy-button {
        padding: 8px 12px;
        border: 1px solid var(--border);
        border-radius: 6px;
        background: var(--bg-primary);
        color: var(--text-secondary);
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        transition: all 0.2s ease;
      }

      .copy-button:hover {
        background: var(--bg-secondary);
        border-color: var(--border-light);
        color: var(--text-primary);
      }

      .copy-button.copied {
        background: var(--success);
        border-color: var(--success);
        color: white;
      }

      .expand-indicator {
        font-size: 19px;
        color: var(--text-muted);
        transition: transform 0.2s ease;
      }

      .expand-indicator.expanded {
        transform: rotate(90deg);
      }

      .event-content {
        padding: 20px;
        background: var(--bg-secondary);
      }

      .field-grid {
        display: grid;
        gap: 16px;
      }

      .field-item {
        display: grid;
        grid-template-columns: 120px 1fr;
        gap: 12px;
        align-items: start;
      }

      .field-label {
        font-weight: 600;
        color: var(--text-primary);
        font-size: 14px;
        padding-top: 2px;
      }

      .field-value {
        word-break: break-all;
        line-height: 1.5;
      }

      .field-content {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .content-text {
        white-space: pre-wrap;
        line-height: 1.6;
        color: var(--text-primary);
      }

      .content-toggle {
        align-self: flex-start;
        padding: 4px 8px;
        border: 1px solid var(--border);
        border-radius: 4px;
        background: var(--bg-tertiary);
        color: var(--accent);
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        transition: all 0.2s ease;
      }

      .content-toggle:hover {
        background: var(--accent);
        color: white;
      }

      .timestamp {
        color: var(--text-secondary);
        font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
        font-size: 14px;
      }

      .hash-value {
        font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
        color: var(--text-secondary);
        font-size: 13px;
        background: var(--bg-tertiary);
        padding: 2px 6px;
        border-radius: 4px;
      }

      .tags-container {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .tag-item {
        display: flex;
        gap: 4px;
        align-items: center;
        padding: 4px 8px;
        background: var(--bg-tertiary);
        border-radius: 6px;
        font-size: 13px;
      }

      .tag-key {
        background: var(--accent);
        color: white;
        padding: 2px 6px;
        border-radius: 4px;
        font-weight: 500;
        font-size: 12px;
      }

      .tag-value {
        color: var(--text-secondary);
        font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
      }

      .json-value {
        background: var(--bg-tertiary);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 12px;
        font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
        font-size: 13px;
        color: var(--text-secondary);
        overflow-x: auto;
        white-space: pre;
      }

      .simple-value {
        color: var(--text-primary);
      }

      @media (max-width: 768px) {
        .event-header {
          flex-direction: column;
          align-items: flex-start;
          gap: 12px;
        }

        .header-actions {
          align-self: flex-end;
        }

        .field-item {
          grid-template-columns: 1fr;
          gap: 4px;
        }

        .event-title {
          flex-direction: column;
          align-items: flex-start;
        }
      }
    `}</style>
    <div class="event-item">
      <div class="event-header" onclick=${toggleExpand}>
        <div class="event-info">
          <div class="event-title">
            <span class="event-kind">${getEventKindLabel(event.kind)}</span>
            <span class="event-id">${truncateId(event.id)}</span>
          </div>
          <div class="event-meta">
            <div class="meta-item">
              <span>📅</span>
              <span>${formatDate(event.created_at)}</span>
            </div>
            <div class="meta-item">
              <span>👤</span>
              <span>${truncateId(event.pubkey)}</span>
            </div>
          </div>
        </div>
        <div class="header-actions">
          <button
            class=${`copy-button ${store.copied$() ? 'copied' : ''}`}
            onclick=${(e) => { e.stopPropagation(); copyToClipboard() }}
          >
            ${store.copied$() ? '✓ Copied!' : '📋 Copy JSON'}
          </button>
          <span class=${`expand-indicator ${store.isExpanded$() ? 'expanded' : ''}`}>▶</span>
        </div>
      </div>

      ${(store.isExpanded$() || '') && this.h`
        <div class="event-content">
          <div class="field-grid">
            ${Object.entries(event).map(([key, value]) => this.h`
              <div class="field-item">
                <div class="field-label">${key}</div>
                <div class="field-value">
                  ${renderFieldValue(key, value)}
                </div>
              </div>
            `)}
          </div>
        </div>
      `}
    </div>
  `
})
