import { useState } from 'react'
import type { AuthState, MyChannel } from '../types'
import { getRecommendedPrice } from '../types'

type EditChannelForm = {
  topic: string
  priceUsdt: string
  subscribers: string
  avgViews: string
  payoutAddress: string
}

type MyChannelTabProps = {
  auth: AuthState
  myChannels: MyChannel[]
  myChannelError: string | null
  myChannelLoading: boolean
  registerChannelInput: string
  setRegisterChannelInput: (v: string) => void
  registerChannel: () => void
  updateChannelCard: (channelTelegramId: string, formData: EditChannelForm) => void
}

function channelToForm(ch: MyChannel): EditChannelForm {
  return {
    topic: ch.topic || '',
    priceUsdt: ch.price_usdt || '',
    subscribers: ch.subscribers?.toString() || '',
    avgViews: ch.avg_views?.toString() || '',
    payoutAddress: ch.payout_address || '',
  }
}

export function MyChannelTab({
  auth,
  myChannels,
  myChannelError,
  myChannelLoading,
  registerChannelInput,
  setRegisterChannelInput,
  registerChannel,
  updateChannelCard,
}: MyChannelTabProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editForms, setEditForms] = useState<Record<string, EditChannelForm>>({})

  const toggleChannel = (telegramId: string, channel: MyChannel) => {
    if (expandedId === telegramId) {
      setExpandedId(null)
    } else {
      setExpandedId(telegramId)
      // Инициализируем форму при первом раскрытии
      if (!editForms[telegramId]) {
        setEditForms((prev) => ({ ...prev, [telegramId]: channelToForm(channel) }))
      }
    }
  }

  const updateForm = (telegramId: string, patch: Partial<EditChannelForm>) => {
    setEditForms((prev) => ({
      ...prev,
      [telegramId]: { ...(prev[telegramId] || channelToForm({} as MyChannel)), ...patch },
    }))
  }

  const handleSave = (channelTelegramId: string) => {
    const form = editForms[channelTelegramId]
    if (form) {
      updateChannelCard(channelTelegramId, form)
    }
  }

  return (
    <div className="mychannel-section">
      {auth.status !== 'ok' ? (
        <div className="empty-state">
          <div className="empty-icon">🔒</div>
          <div className="empty-text">Авторизуйтесь через Telegram</div>
        </div>
      ) : (
        <>
          {/* Error */}
          {myChannelError && <div className="error-banner">{myChannelError}</div>}

          {/* Channel List (accordion) */}
          {myChannels.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {myChannels.map((ch) => {
                const isExpanded = expandedId === ch.telegram_id
                const form = editForms[ch.telegram_id] || channelToForm(ch)
                return (
                  <div key={ch.telegram_id} className="mychannel-card">
                    {/* Clickable header — 3 columns */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        cursor: 'pointer',
                        marginBottom: isExpanded ? '12px' : 0,
                        width: '100%',
                      }}
                      onClick={() => toggleChannel(ch.telegram_id, ch)}
                    >
                      <div style={{ flex: 1, fontWeight: 600, fontSize: '15px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                        {ch.title}
                      </div>
                      <div style={{ fontSize: '13px', color: 'var(--text-secondary)', whiteSpace: 'nowrap', marginLeft: '8px' }}>
                        {ch.price_usdt != null
                          ? (Number(ch.price_usdt) >= 1
                            ? Math.round(Number(ch.price_usdt))
                            : ch.price_usdt)
                          : '—'} USDT
                      </div>
                      <span style={{
                        transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform 0.2s',
                        fontSize: '12px',
                        color: 'var(--text-tertiary)',
                        flexShrink: 0,
                        marginLeft: '8px',
                      }}>
                        ▼
                      </span>
                    </div>

                    {/* Expanded content */}
                    {isExpanded && (
                      <>
                        {/* Stats */}
                        <div className="channel-stats">
                          <span className="channel-stat channel-topic">
                            {ch.topic ?? 'Без темы'}
                          </span>
                          <span className="channel-stat">
                            👥 {ch.subscribers ?? '—'}
                          </span>
                          <span className="channel-stat">
                            👁 {ch.avg_views ?? '—'}
                          </span>
                        </div>

                        {/* Edit Form */}
                        <div style={{ marginTop: '12px' }}>
                          <div className="form-title" style={{ fontSize: '14px', marginBottom: '8px' }}>
                            ⚙️ Настройки
                          </div>
                          <div className="form-fields">
                            <div className="form-field">
                              <label>Тематика</label>
                              <select
                                value={form.topic}
                                onChange={(e) => updateForm(ch.telegram_id, { topic: e.target.value })}
                              >
                                <option value="">Выберите тематику</option>
                                <option value="business">Business</option>
                                <option value="crypto">Crypto</option>
                                <option value="education">Education</option>
                                <option value="entertainment">Entertainment</option>
                                <option value="lifestyle">Lifestyle</option>
                                <option value="news">News</option>
                                <option value="tech">Tech</option>
                              </select>
                            </div>
                            <div className="form-field">
                              <label>Цена за пост (USDT)</label>
                              <input
                                type="number"
                                placeholder="100"
                                value={form.priceUsdt}
                                onChange={(e) => updateForm(ch.telegram_id, { priceUsdt: e.target.value })}
                              />
                              {/* Price recommendation */}
                              {(() => {
                                const avgViews = Number(form.avgViews) || ch.avg_views || 0
                                const topic = form.topic || ch.topic || ''
                                const rec = getRecommendedPrice(avgViews, topic)
                                if (rec) {
                                  return (
                                    <div className="price-hint">
                                      💡 Рекомендуемая цена: <strong>{rec.min}–{rec.max} USDT</strong>
                                      <span className="price-hint-details">
                                        на основе {avgViews.toLocaleString()} просмотров и тематики "{topic}"
                                      </span>
                                    </div>
                                  )
                                }
                                if (!topic && avgViews > 0) {
                                  return (
                                    <div className="price-hint price-hint-warning">
                                      ⚠️ Выберите тематику для расчёта рекомендуемой цены
                                    </div>
                                  )
                                }
                                if (topic && avgViews <= 0) {
                                  return (
                                    <div className="price-hint price-hint-warning">
                                      ⚠️ Укажите средние просмотры для расчёта рекомендуемой цены
                                    </div>
                                  )
                                }
                                return null
                              })()}
                            </div>
                            <div className="form-field">
                              <label>Подписчики</label>
                              <input
                                type="number"
                                placeholder="10000"
                                value={form.subscribers}
                                onChange={(e) => updateForm(ch.telegram_id, { subscribers: e.target.value })}
                              />
                            </div>
                            <div className="form-field">
                              <label>Средние просмотры</label>
                              <input
                                type="number"
                                placeholder="5000"
                                value={form.avgViews}
                                onChange={(e) => updateForm(ch.telegram_id, { avgViews: e.target.value })}
                              />
                            </div>
                            <div className="form-field">
                              <label>Кошелёк для выплат (TON)</label>
                              <input
                                type="text"
                                placeholder="UQ..."
                                value={form.payoutAddress}
                                onChange={(e) => updateForm(ch.telegram_id, { payoutAddress: e.target.value })}
                              />
                            </div>
                            <button
                              className="btn btn-primary btn-block"
                              onClick={() => handleSave(ch.telegram_id)}
                              disabled={myChannelLoading}
                            >
                              {myChannelLoading ? '⏳ Сохраняем...' : '💾 Сохранить'}
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Empty state — no channels */}
          {myChannels.length === 0 && !myChannelLoading && (
            <div className="empty-state" style={{ marginBottom: '16px' }}>
              <div className="empty-icon">📡</div>
              <div className="empty-text">У вас ещё нет каналов</div>
            </div>
          )}

          {/* Add channel form — always visible */}
          <div className="order-form">
            <div className="form-title">➕ Добавить канал</div>
            <div className="form-fields">
              <div className="form-field">
                <label>@username канала</label>
                <input
                  type="text"
                  placeholder="@mychannel"
                  value={registerChannelInput}
                  onChange={(e) => setRegisterChannelInput(e.target.value)}
                />
              </div>
              <div className="form-hint">
                Бот должен быть администратором канала с правом публикации
              </div>
              <button
                className="btn btn-primary btn-block"
                onClick={registerChannel}
                disabled={myChannelLoading}
              >
                {myChannelLoading ? '⏳ Проверяем...' : '✓ Добавить канал'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
