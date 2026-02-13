import type { AuthState, PaidOrderGroup } from '../types'

type OrdersTabProps = {
  auth: AuthState
  paidOrders: PaidOrderGroup[]
  paidOrdersError: string | null
  paidOrdersLoading: boolean
  loadPaidOrders: (telegramId: number) => void
  orderActionLoading: number | null
  publishOrder: (orderId: number) => void
  publishCampaignApplication: (applicationId: number) => void
  rejectOrder: (orderId: number) => void
}

export function OrdersTab({
  auth,
  paidOrders,
  paidOrdersError,
  paidOrdersLoading,
  loadPaidOrders,
  orderActionLoading,
  publishOrder,
  publishCampaignApplication,
  rejectOrder,
}: OrdersTabProps) {
  return (
    <div className="orders-section">
      {auth.status !== 'ok' ? (
        <div className="empty-state">
          <div className="empty-icon">🔒</div>
          <div className="empty-text">Авторизуйтесь через Telegram</div>
        </div>
      ) : (
        <>
          <button
            className="btn btn-secondary btn-block orders-refresh"
            onClick={() => loadPaidOrders(auth.telegramId)}
            disabled={paidOrdersLoading}
          >
            {paidOrdersLoading ? '⏳ Обновляем...' : '🔄 Обновить список'}
          </button>

          {paidOrdersError && <div className="error-banner">{paidOrdersError}</div>}

          {!paidOrdersLoading && paidOrders.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon">📋</div>
              <div className="empty-text">Оплаченных заказов пока нет</div>
            </div>
          )}

          {paidOrders.map((group) => (
            <article key={group.groupId} className="order-group">
              <div className="order-group-header">
                <div className="order-group-meta">
                  <div className="order-meta-item">
                    <span className="order-meta-label">Группа</span>
                    <span className="order-meta-value">{group.groupId}</span>
                  </div>
                  <div className="order-meta-item">
                    <span className="order-meta-label">Статус</span>
                    <span className={`order-meta-value ${group.paymentStatus === 'paid' ? 'status-paid' : 'status-pending'}`}>
                      {group.paymentStatus}
                    </span>
                  </div>
                  <div className="order-meta-item">
                    <span className="order-meta-label">Сумма</span>
                    <span className="order-meta-value">{group.totalUsdt ?? '—'} USDT</span>
                  </div>
                  <div className="order-meta-item">
                    <span className="order-meta-label">Refund</span>
                    <span className="order-meta-value">{group.refundStatus ?? '—'}</span>
                  </div>
                  <div className="order-meta-item">
                    <span className="order-meta-label">Payout</span>
                    <span className="order-meta-value">{group.payoutStatus ?? '—'}</span>
                  </div>
                </div>
              </div>
              <div className="order-group-items">
                {group.items.map((item) => {
                  const isCampaign = item.source === 'campaign'
                  const verifySuccess =
                    item.verifyStatus === 'passed' || item.verifyStatus === 'verified'
                  const canPublish =
                    (group.paymentStatus === 'paid' || group.paymentStatus === 'accepted') &&
                    item.publishStatus !== 'published'
                  const canReject =
                    !isCampaign &&
                    (group.paymentStatus === 'paid' || group.paymentStatus === 'accepted') &&
                    group.refundStatus !== 'pending'
                  return (
                    <div key={item.id} className="order-item">
                      <div className="order-item-header">
                        <div>
                          <div className="order-item-channel">{item.title ?? 'Канал'}</div>
                          <div className="order-item-username">
                            @{item.username ?? 'без_username'}
                          </div>
                        </div>
                        <div className="order-item-price">{item.priceUsdt ?? '—'} USDT</div>
                      </div>
                      <div className="order-item-text">{item.adText}</div>
                      <div className="order-item-details">
                        <div className="order-item-detail">
                          <span className="order-item-detail-icon">📅</span>
                          <span>
                            Публикация:{' '}
                            {item.publishAt ? new Date(item.publishAt).toLocaleString() : 'Без времени'}
                          </span>
                        </div>
                        <div className="order-item-detail">
                          <span className="order-item-detail-icon">📤</span>
                          <span>
                            Publish:{' '}
                            <span className={`status-badge ${item.publishStatus === 'published' ? 'success' : item.publishError ? 'error' : 'pending'}`}>
                              {item.publishStatus ?? 'pending'}
                            </span>
                          </span>
                        </div>
                        <div className="order-item-detail">
                          <span className="order-item-detail-icon">✅</span>
                          <span>
                            Verify:{' '}
                            <span
                              className={`status-badge ${
                                verifySuccess ? 'success' : item.verifyError ? 'error' : 'pending'
                              }`}
                            >
                              {item.verifyStatus ?? 'pending'}
                            </span>
                          </span>
                        </div>
                        {isCampaign && (
                          <div className="order-item-detail">
                            <span className="order-item-detail-icon">💸</span>
                            <span>
                              Payout:{' '}
                              <span
                                className={`status-badge ${
                                  item.payoutStatus === 'sent'
                                    ? 'success'
                                    : item.payoutError
                                      ? 'error'
                                      : 'pending'
                                }`}
                              >
                                {item.payoutStatus ?? 'pending'}
                              </span>
                            </span>
                          </div>
                        )}
                        {item.publishError && (
                          <div className="order-item-detail" style={{ color: 'var(--color-danger)' }}>
                            <span className="order-item-detail-icon">⚠️</span>
                            <span>{item.publishError}</span>
                          </div>
                        )}
                        {item.verifyError && (
                          <div className="order-item-detail" style={{ color: 'var(--color-danger)' }}>
                            <span className="order-item-detail-icon">⚠️</span>
                            <span>{item.verifyError}</span>
                          </div>
                        )}
                        {isCampaign && item.payoutError && (
                          <div className="order-item-detail" style={{ color: 'var(--color-danger)' }}>
                            <span className="order-item-detail-icon">⚠️</span>
                            <span>{item.payoutError}</span>
                          </div>
                        )}
                        {item.publishedMessageId !== null && (
                          <div className="order-item-detail">
                            <span className="order-item-detail-icon">🆔</span>
                            <span>Message ID: {item.publishedMessageId}</span>
                          </div>
                        )}
                        {item.publishedAt && (
                          <div className="order-item-detail">
                            <span className="order-item-detail-icon">🕐</span>
                            <span>Опубликовано: {new Date(item.publishedAt).toLocaleString()}</span>
                          </div>
                        )}
                        {item.verifiedAt && (
                          <div className="order-item-detail">
                            <span className="order-item-detail-icon">✓</span>
                            <span>Проверено: {new Date(item.verifiedAt).toLocaleString()}</span>
                          </div>
                        )}
                      </div>
                      <div className="order-item-actions">
                        <button
                          className="btn btn-success btn-sm"
                          onClick={() =>
                            isCampaign ? publishCampaignApplication(item.id) : publishOrder(item.id)
                          }
                          disabled={!canPublish || orderActionLoading === item.id}
                        >
                          {orderActionLoading === item.id ? '⏳' : '📤'} Опубликовать
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => rejectOrder(item.id)}
                          disabled={!canReject || orderActionLoading === item.id}
                        >
                          {orderActionLoading === item.id ? '⏳' : '❌'} Отклонить
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </article>
          ))}
        </>
      )}
    </div>
  )
}
