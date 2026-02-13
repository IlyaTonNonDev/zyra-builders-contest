import type {
  AuthState,
  Campaign,
  CampaignApplication,
  MyCampaignApplication,
  ChannelCard,
} from '../types'
import { CampaignTextBlock } from './CampaignTextBlock'

type CampaignsTabProps = {
  auth: AuthState
  userMode: 'advertiser' | 'admin'
  campaigns: Campaign[]
  myCampaigns: Campaign[]
  selectedCampaign: Campaign | null
  setSelectedCampaign: (v: Campaign | null) => void
  campaignView: 'browse' | 'my' | 'create'
  setCampaignView: (v: 'browse' | 'my' | 'create') => void
  campaignsError: string | null
  setCampaignsError: (v: string | null) => void
  campaignApplications: CampaignApplication[]
  myApplications: MyCampaignApplication[]
  campaignActionLoading: boolean
  newCampaignForm: { adText: string; budgetUsdt: string; pricePerPost: string }
  setNewCampaignForm: React.Dispatch<
    React.SetStateAction<CampaignsTabProps['newCampaignForm']>
  >
  createCampaign: () => void
  applyForm: { campaignId: number | null; proposedPrice: string; channelTelegramId: string }
  setApplyForm: React.Dispatch<React.SetStateAction<CampaignsTabProps['applyForm']>>
  applyToCampaign: (campaignId: number, channelTelegramId: number, proposedPrice: string) => void
  acceptApplication: (campaignId: number, appId: number) => void
  rejectApplication: (campaignId: number, appId: number) => void
  closeCampaign: (campaignId: number) => void
  channels: ChannelCard[]
  tonWalletAddress: string | null
  connectTonWallet: () => void
  disconnectTonWallet: () => void
  tonConnectError: string | null
  formatTonAddress: (address: string) => string
}

export function CampaignsTab({
  auth,
  userMode,
  campaigns,
  myCampaigns,
  selectedCampaign,
  setSelectedCampaign,
  campaignView,
  setCampaignView,
  campaignsError,
  setCampaignsError,
  campaignApplications,
  myApplications,
  campaignActionLoading,
  newCampaignForm,
  setNewCampaignForm,
  createCampaign,
  applyForm,
  setApplyForm,
  applyToCampaign,
  acceptApplication,
  rejectApplication,
  closeCampaign,
  channels,
  tonWalletAddress,
  connectTonWallet,
  disconnectTonWallet,
  tonConnectError,
  formatTonAddress,
}: CampaignsTabProps) {
  return (
    <div className="campaigns-section">
      {auth.status !== 'ok' ? (
        <div className="empty-state">
          <div className="empty-icon">🔒</div>
          <div className="empty-text">Авторизуйтесь через Telegram</div>
        </div>
      ) : (
        <>
          {/* Error display */}
          {campaignsError && (
            <div className="error-box" style={{ marginBottom: '16px' }}>
              ⚠️ {campaignsError}
            </div>
          )}

          {/* View Switcher */}
          {userMode === 'advertiser' && (
            <div className="campaigns-switcher">
              <button
                className={`switcher-btn ${campaignView === 'my' ? 'active' : ''}`}
                onClick={() => {
                  setCampaignView('my')
                  setSelectedCampaign(null)
                  setCampaignsError(null)
                }}
              >
                📊 Мои кампании
              </button>
              <button
                className={`switcher-btn ${campaignView === 'create' ? 'active' : ''}`}
                onClick={() => {
                  setCampaignView('create')
                  setSelectedCampaign(null)
                  setCampaignsError(null)
                }}
              >
                ➕ Создать
              </button>
            </div>
          )}

          {/* === BROWSE CAMPAIGNS (for channel admins) === */}
          {campaignView === 'browse' && !selectedCampaign && (
            <>
              <div className="section-header">
                <h2>🎯 Активные кампании</h2>
                <p>Подайте свой канал на размещение рекламы</p>
              </div>

              {campaigns.filter((c) => c.status === 'active').length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">📭</div>
                  <div className="empty-text">Активных кампаний пока нет</div>
                </div>
              ) : (
                <div className="campaigns-list">
                  {campaigns
                    .filter((c) => c.status === 'active')
                    .map((campaign) => (
                      <article key={campaign.id} className="campaign-card">
                        <div className="campaign-header">
                          <div className="campaign-budget">
                            <span className="budget-label">Бюджет</span>
                            <span className="budget-value">{campaign.budget_usdt} USDT</span>
                          </div>
                          {campaign.price_per_post && (
                            <div className="campaign-price-tag">
                              до {campaign.price_per_post} USDT/пост
                            </div>
                          )}
                        </div>
                        <CampaignTextBlock text={campaign.ad_text} />
                        <div className="campaign-meta">
                          <span className="campaign-meta-item">
                            <span className="meta-icon">📥</span>
                            {campaign.applications_count} заявок
                          </span>
                          <span className="campaign-meta-item">
                            <span className="meta-icon">✅</span>
                            {campaign.accepted_count} принято
                          </span>
                          <span className="campaign-meta-item">
                            <span className="meta-icon">💰</span>
                            Осталось: {campaign.remaining_usdt} USDT
                          </span>
                        </div>
                        <div className="campaign-actions">
                          <button
                            className="btn btn-primary btn-block"
                            onClick={() =>
                              setApplyForm({
                                campaignId: campaign.id,
                                proposedPrice: campaign.price_per_post ?? '',
                                channelTelegramId: '',
                              })
                            }
                          >
                            📤 Подать заявку
                          </button>
                        </div>
                      </article>
                    ))}
                </div>
              )}

              {/* My Applications as channel admin */}
              {myApplications.length > 0 && (
                <>
                  <div className="section-header" style={{ marginTop: '24px' }}>
                    <h2>📬 Мои заявки</h2>
                  </div>
                  <div className="applications-list">
                    {myApplications.map((app) => (
                      <div key={app.id} className="application-card my-application">
                        <div className="application-header">
                          <span
                            className={`status-badge ${app.status === 'accepted' ? 'success' : app.status === 'rejected' ? 'error' : 'pending'}`}
                          >
                            {app.status === 'pending' && '⏳ На рассмотрении'}
                            {app.status === 'accepted' && '✅ Принято'}
                            {app.status === 'rejected' && '❌ Отклонено'}
                            {app.status === 'published' && '📤 Опубликовано'}
                            {app.status === 'paid' && '💰 Оплачено'}
                          </span>
                          <span className="application-price">{app.proposed_price} USDT</span>
                        </div>
                        <CampaignTextBlock
                          text={app.campaign_ad_text}
                          className="application-campaign-text"
                        />
                        <div className="application-meta">
                          Бюджет кампании: {app.campaign_budget_usdt} USDT
                          {app.campaign_price_per_post &&
                            ` • Макс. цена: ${app.campaign_price_per_post} USDT`}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Apply Modal */}
              {applyForm.campaignId && (
                <div
                  className="modal-overlay"
                  onClick={() =>
                    setApplyForm({ campaignId: null, proposedPrice: '', channelTelegramId: '' })
                  }
                >
                  <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                    <div className="modal-header">
                      <h3>📤 Подать заявку</h3>
                      <button
                        className="modal-close"
                        onClick={() =>
                          setApplyForm({
                            campaignId: null,
                            proposedPrice: '',
                            channelTelegramId: '',
                          })
                        }
                      >
                        ✕
                      </button>
                    </div>
                    <div className="form-fields">
                      <div className="form-field">
                        <label>Выберите канал</label>
                        <select
                          value={applyForm.channelTelegramId}
                          onChange={(e) =>
                            setApplyForm((prev) => ({
                              ...prev,
                              channelTelegramId: e.target.value,
                            }))
                          }
                        >
                          <option value="">Выберите канал для размещения</option>
                          {channels.map((ch) => (
                            <option key={ch.telegram_id} value={ch.telegram_id}>
                              {ch.title} (@{ch.username ?? 'без username'}) —{' '}
                              {ch.price_usdt ?? '—'} USDT
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="form-field">
                        <label>Ваша цена за пост (USDT)</label>
                        <input
                          type="number"
                          placeholder="50"
                          value={applyForm.proposedPrice}
                          onChange={(e) =>
                            setApplyForm((prev) => ({ ...prev, proposedPrice: e.target.value }))
                          }
                        />
                        <div className="form-hint">
                          Укажите желаемую цену. Рекламодатель увидит статистику вашего канала.
                        </div>
                      </div>
                      <button
                        className="btn btn-success btn-block"
                        onClick={() => {
                          if (!applyForm.channelTelegramId) {
                            setCampaignsError('Выберите канал')
                            return
                          }
                          applyToCampaign(
                            applyForm.campaignId!,
                            Number(applyForm.channelTelegramId),
                            applyForm.proposedPrice,
                          )
                        }}
                        disabled={campaignActionLoading}
                      >
                        {campaignActionLoading ? '⏳ Отправляем...' : '✓ Отправить заявку'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* === MY CAMPAIGNS (for advertisers) === */}
          {campaignView === 'my' && !selectedCampaign && (
            <>
              <div className="section-header">
                <h2>📊 Мои кампании</h2>
                <p>Управляйте своими рекламными кампаниями</p>
              </div>

              {myCampaigns.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">📭</div>
                  <div className="empty-text">У вас ещё нет кампаний</div>
                  <button
                    className="btn btn-primary"
                    style={{ marginTop: '16px' }}
                    onClick={() => setCampaignView('create')}
                  >
                    ➕ Создать кампанию
                  </button>
                </div>
              ) : (
                <div className="campaigns-list">
                  {myCampaigns.map((campaign) => (
                    <article key={campaign.id} className="campaign-card my-campaign">
                      <div className="campaign-header">
                        <div className="campaign-budget">
                          <span className="budget-label">Бюджет</span>
                          <span className="budget-value">{campaign.budget_usdt} USDT</span>
                        </div>
                        <span
                          className={`status-badge ${campaign.status === 'active' ? 'success' : campaign.status === 'closed' ? 'pending' : 'error'}`}
                        >
                          {campaign.status === 'active' && '🟢 Активна'}
                          {campaign.status === 'pending' && '⏳ Ожидает оплаты'}
                          {campaign.status === 'closed' && '🔒 Закрыта'}
                          {campaign.status === 'cancelled' && '❌ Отменена'}
                        </span>
                      </div>
                      <CampaignTextBlock text={campaign.ad_text} />
                      <div className="campaign-progress">
                        <div className="progress-bar">
                          <div
                            className="progress-fill"
                            style={{
                              width: `${((Number(campaign.budget_usdt) - Number(campaign.remaining_usdt)) / Number(campaign.budget_usdt)) * 100}%`,
                            }}
                          />
                        </div>
                        <div className="progress-labels">
                          <span>
                            Потрачено:{' '}
                            {(
                              Number(campaign.budget_usdt) - Number(campaign.remaining_usdt)
                            ).toFixed(2)}{' '}
                            USDT
                          </span>
                          <span>Осталось: {campaign.remaining_usdt} USDT</span>
                        </div>
                      </div>
                      <div className="campaign-meta">
                        <span className="campaign-meta-item">
                          <span className="meta-icon">📥</span>
                          {campaign.applications_count} заявок
                        </span>
                        <span className="campaign-meta-item">
                          <span className="meta-icon">✅</span>
                          {campaign.accepted_count} принято
                        </span>
                      </div>
                      <div className="campaign-actions">
                        <button
                          className="btn btn-primary"
                          onClick={() => setSelectedCampaign(campaign)}
                        >
                          👁 Заявки
                        </button>
                        {campaign.status === 'active' && (
                          <button
                            className="btn btn-danger"
                            onClick={() => closeCampaign(campaign.id)}
                            disabled={campaignActionLoading}
                          >
                            🔒 Закрыть
                          </button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}

          {/* === CAMPAIGN DETAILS (applications list) === */}
          {selectedCampaign && (
            <>
              <button
                className="btn btn-secondary back-btn"
                onClick={() => setSelectedCampaign(null)}
              >
                ← Назад к списку
              </button>

              <div className="campaign-details">
                <div className="campaign-card selected">
                  <div className="campaign-header">
                    <div className="campaign-budget">
                      <span className="budget-label">Бюджет</span>
                      <span className="budget-value">
                        {selectedCampaign.budget_usdt} USDT
                      </span>
                    </div>
                    <span
                      className={`status-badge ${selectedCampaign.status === 'active' ? 'success' : 'pending'}`}
                    >
                      {selectedCampaign.status === 'active'
                        ? '🟢 Активна'
                        : selectedCampaign.status}
                    </span>
                  </div>
                  <CampaignTextBlock text={selectedCampaign.ad_text} />
                  <div className="campaign-progress">
                    <div className="progress-bar">
                      <div
                        className="progress-fill"
                        style={{
                          width: `${((Number(selectedCampaign.budget_usdt) - Number(selectedCampaign.remaining_usdt)) / Number(selectedCampaign.budget_usdt)) * 100}%`,
                        }}
                      />
                    </div>
                    <div className="progress-labels">
                      <span>
                        Потрачено:{' '}
                        {(
                          Number(selectedCampaign.budget_usdt) -
                          Number(selectedCampaign.remaining_usdt)
                        ).toFixed(2)}{' '}
                        USDT
                      </span>
                      <span>Осталось: {selectedCampaign.remaining_usdt} USDT</span>
                    </div>
                  </div>
                </div>

                <div className="section-header">
                  <h2>📥 Заявки на кампанию</h2>
                </div>

                {campaignApplications.filter((a) => a.campaign_id === selectedCampaign.id)
                  .length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-icon">📭</div>
                    <div className="empty-text">Заявок пока нет</div>
                  </div>
                ) : (
                  <div className="applications-list">
                    {campaignApplications
                      .filter((a) => a.campaign_id === selectedCampaign.id)
                      .map((app) => (
                        <div key={app.id} className="application-card">
                          <div className="application-channel">
                            <div className="channel-avatar">📺</div>
                            <div className="channel-info">
                              <div className="channel-title">{app.channel_title}</div>
                              <div className="channel-username">@{app.channel_username}</div>
                            </div>
                            <div className="application-price">
                              {app.proposed_price} USDT
                            </div>
                          </div>
                          <div className="application-stats">
                            <span className="app-stat">
                              👥 {app.channel_subscribers?.toLocaleString()}
                            </span>
                            <span className="app-stat">
                              👁 {app.channel_avg_views?.toLocaleString()}
                            </span>
                            <span
                              className={`status-badge ${app.status === 'accepted' ? 'success' : app.status === 'rejected' ? 'error' : 'pending'}`}
                            >
                              {app.status === 'pending' && '⏳ Ожидает'}
                              {app.status === 'accepted' && '✅ Принято'}
                              {app.status === 'rejected' && '❌ Отклонено'}
                            </span>
                          </div>
                          {app.status === 'pending' && (
                            <div className="application-actions">
                              <button
                                className="btn btn-success btn-sm"
                                onClick={() =>
                                  acceptApplication(selectedCampaign.id, app.id)
                                }
                                disabled={campaignActionLoading}
                              >
                                ✓ Принять и опубликовать
                              </button>
                              <button
                                className="btn btn-danger btn-sm"
                                onClick={() =>
                                  rejectApplication(selectedCampaign.id, app.id)
                                }
                                disabled={campaignActionLoading}
                              >
                                ✕ Отклонить
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* === CREATE CAMPAIGN === */}
          {campaignView === 'create' && (
            <>
              <div className="section-header">
                <h2>➕ Новая кампания</h2>
                <p>Создайте рекламную кампанию и привлекайте каналы</p>
              </div>

              <div className="order-form">
                <div className="form-fields">
                  <div className="form-field">
                    <label>Текст рекламы</label>
                    <textarea
                      placeholder="Введите текст вашего рекламного объявления..."
                      value={newCampaignForm.adText}
                      onChange={(e) =>
                        setNewCampaignForm((prev) => ({ ...prev, adText: e.target.value }))
                      }
                      rows={4}
                    />
                  </div>
                  <div className="form-field">
                    <label>Общий бюджет (USDT)</label>
                    <input
                      type="number"
                      placeholder="500"
                      value={newCampaignForm.budgetUsdt}
                      onChange={(e) =>
                        setNewCampaignForm((prev) => ({ ...prev, budgetUsdt: e.target.value }))
                      }
                    />
                    <div className="form-hint">
                      Эта сумма будет заморожена на escrow до завершения кампании
                    </div>
                  </div>
                  <div className="form-field">
                    <label>Максимальная цена за пост (USDT) — опционально</label>
                    <input
                      type="number"
                      placeholder="50"
                      value={newCampaignForm.pricePerPost}
                      onChange={(e) =>
                        setNewCampaignForm((prev) => ({
                          ...prev,
                          pricePerPost: e.target.value,
                        }))
                      }
                    />
                    <div className="form-hint">
                      Оставьте пустым, чтобы рассматривать все заявки
                    </div>
                  </div>

                  {/* Summary */}
                  {newCampaignForm.budgetUsdt && (
                    <div className="campaign-summary">
                      <div className="summary-row">
                        <span>Бюджет:</span>
                        <span>{newCampaignForm.budgetUsdt} USDT</span>
                      </div>
                      <div className="summary-row">
                        <span>Комиссия сервиса (10%):</span>
                        <span>
                          {(Number(newCampaignForm.budgetUsdt) * 0.1).toFixed(2)} USDT
                        </span>
                      </div>
                      <div className="summary-row total">
                        <span>Итого к оплате:</span>
                        <span>
                          {(Number(newCampaignForm.budgetUsdt) * 1.1).toFixed(2)} USDT
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="form-hint" style={{ marginBottom: '8px' }}>
                    {tonWalletAddress ? (
                      <>
                        Tonkeeper подключен: {formatTonAddress(tonWalletAddress)}
                        <button
                          className="btn btn-secondary btn-sm"
                          style={{ marginLeft: '8px' }}
                          onClick={disconnectTonWallet}
                        >
                          Отключить
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={connectTonWallet}
                        >
                          🔗 Подключить Tonkeeper
                        </button>
                        {tonConnectError && (
                          <span
                            style={{ marginLeft: '8px', color: 'var(--color-danger)' }}
                          >
                            {tonConnectError}
                          </span>
                        )}
                      </>
                    )}
                  </div>

                  <button
                    className="btn btn-success btn-block"
                    disabled={
                      !newCampaignForm.adText ||
                      !newCampaignForm.budgetUsdt ||
                      campaignActionLoading
                    }
                    onClick={createCampaign}
                  >
                    {campaignActionLoading ? '⏳ Создаём...' : '💎 Создать и оплатить'}
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
