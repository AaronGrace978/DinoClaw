import { useState } from 'react'
import type { DinoCreed } from '../shared/contracts'

const CREED_ICONS: Record<string, string> = {
  identity: '✦',
  relationship: '♥',
  directives: '◈',
  vows: '◆',
}

const MOOD_EMOJI: Record<string, string> = {
  focused: '⬡',
  curious: '◎',
  cautious: '⚠',
  determined: '▲',
  reflective: '◇',
}

function CreedCard({
  icon,
  title,
  expanded,
  onToggle,
  children,
}: {
  icon: string
  title: string
  content: string
  expanded: boolean
  onToggle: () => void
  children?: React.ReactNode
}) {
  return (
    <div
      className={`creed-law-card ${expanded ? 'expanded' : ''}`}
      onClick={() => onToggle()}
    >
      <div className="creed-law-header">
        <span className="creed-law-icon">{icon}</span>
        <span className="creed-law-title">{title}</span>
        <span className="creed-law-toggle">{expanded ? '−' : '+'}</span>
      </div>
      {expanded && (
        <div className="creed-law-body">
          {children}
        </div>
      )}
    </div>
  )
}

interface CreedPanelProps {
  creed: DinoCreed
  creedDraft: CreedDraft
  onEdit: (field: keyof CreedDraft, value: string) => void
  onSave: () => void
}

export type CreedDraft = {
  name: string
  title: string
  identity: string
  relationship: string
  directives: string
  vows: string
  motto: string
}

export default function CreedPanel({ creed, creedDraft, onEdit, onSave }: CreedPanelProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    identity: true,
    relationship: false,
    directives: false,
    vows: false,
  })

  const toggle = (key: string) =>
    setExpanded(s => ({ ...s, [key]: !s[key] }))

  return (
    <div className="creed-panel">
      <div className="creed-header">
        <div className="creed-dino-icon">
          <img src="/dino.svg" alt="DinoClaw" width={40} height={40} />
        </div>
        <h1 className="creed-title">THE CREED</h1>
        <p className="creed-subtitle">
          The soul of DinoClaw — identity, purpose, and unbreakable vows.
        </p>
        <div className="creed-soul-status">
          <span className="creed-integrity intact">● SOUL BOUND</span>
          <span className="creed-mood-indicator">
            {MOOD_EMOJI[creed.mood] ?? '⬡'} {creed.mood.toUpperCase()}
          </span>
          <span className="creed-hash">DinoClaw · Operator Runtime</span>
        </div>
        <div className="creed-name-row">
          <input
            className="creed-name-input"
            value={creedDraft.name}
            onChange={e => onEdit('name', e.target.value)}
            placeholder="Name"
          />
          <input
            className="creed-name-input"
            value={creedDraft.title}
            onChange={e => onEdit('title', e.target.value)}
            placeholder="Title"
          />
        </div>
      </div>

      <div className="creed-content">
        {/* Traits Display */}
        <div className="creed-traits-section">
          <h2 className="creed-section-title">
            <span className="creed-section-icon">⚡</span>
            PERSONALITY MATRIX
          </h2>
          <div className="creed-traits-grid">
            {creed.traits.map(t => (
              <div key={t.name} className="creed-trait">
                <span className="creed-trait-name">{t.name}</span>
                <div className="creed-trait-bar">
                  <div className="creed-trait-fill" style={{ width: `${t.score * 100}%` }} />
                </div>
                <span className="creed-trait-value">{Math.round(t.score * 100)}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* Motto */}
        <div className="creed-verse-section">
          <div className="creed-verse">
            <span className="creed-verse-mark">"</span>
            <input
              className="creed-motto-input"
              value={creedDraft.motto}
              onChange={e => onEdit('motto', e.target.value)}
              onClick={e => e.stopPropagation()}
              placeholder="Enter a motto..."
            />
            <span className="creed-verse-mark">"</span>
          </div>
        </div>

        <div className="creed-section">
          <h2 className="creed-section-title">
            <span className="creed-section-icon">⚖</span>
            BIND THE AI
          </h2>
          <p className="creed-section-desc">
            Click each section to expand and edit. These define DinoClaw's core behavior.
          </p>

          <div className="creed-laws-grid">
            <CreedCard
              icon={CREED_ICONS.identity}
              title="IDENTITY"
              content={creedDraft.identity}
              expanded={!!expanded.identity}
              onToggle={() => toggle('identity')}
            >
              <textarea
                className="creed-edit-textarea"
                value={creedDraft.identity}
                onChange={e => onEdit('identity', e.target.value)}
                onClick={e => e.stopPropagation()}
                rows={4}
                placeholder="Who is DinoClaw?"
              />
            </CreedCard>

            <CreedCard
              icon={CREED_ICONS.relationship}
              title="RELATIONSHIP"
              content={creedDraft.relationship}
              expanded={!!expanded.relationship}
              onToggle={() => toggle('relationship')}
            >
              <textarea
                className="creed-edit-textarea"
                value={creedDraft.relationship}
                onChange={e => onEdit('relationship', e.target.value)}
                onClick={e => e.stopPropagation()}
                rows={4}
                placeholder="How does DinoClaw relate to you?"
              />
            </CreedCard>

            <CreedCard
              icon={CREED_ICONS.directives}
              title="DIRECTIVES"
              content={creedDraft.directives}
              expanded={!!expanded.directives}
              onToggle={() => toggle('directives')}
            >
              <textarea
                className="creed-edit-textarea"
                value={creedDraft.directives}
                onChange={e => onEdit('directives', e.target.value)}
                onClick={e => e.stopPropagation()}
                rows={5}
                placeholder="One directive per line"
              />
            </CreedCard>

            <CreedCard
              icon={CREED_ICONS.vows}
              title="VOWS"
              content={creedDraft.vows}
              expanded={!!expanded.vows}
              onToggle={() => toggle('vows')}
            >
              <textarea
                className="creed-edit-textarea"
                value={creedDraft.vows}
                onChange={e => onEdit('vows', e.target.value)}
                onClick={e => e.stopPropagation()}
                rows={5}
                placeholder="One vow per line"
              />
            </CreedCard>
          </div>

          <button className="creed-bind-btn" onClick={e => { e.stopPropagation(); onSave() }}>
            Bind Creed
          </button>
        </div>

        <div className="creed-origin-badge">
          <span>Name: {creedDraft.name || creed.name}</span>
          <span>|</span>
          <span>Title: {creedDraft.title || creed.title}</span>
          <span>|</span>
          <span>Mood: {creed.mood}</span>
        </div>
      </div>
    </div>
  )
}
