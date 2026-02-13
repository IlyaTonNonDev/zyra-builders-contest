import { Router } from "express";
import { randomBytes } from "crypto";
import { pool } from "../db";
import { generateEscrowWallet } from "../escrowWallet";
import {
  getJettonDecimals,
  getTonConfigFromEnv,
  getJettonWalletAddress,
  normalizeTonAddress,
  getAccountEvents,
  getAccountTonBalance,
  getMasterchainSeqno,
  getTransactionSeqno,
} from "../tonApi";
import { buildJettonTransferPayload } from "../toncenter";
import {
  botToken,
  toJettonAmount,
  buildTonkeeperUrl,
  getEscrowRequiredTonNano,
  getEscrowRequiredTonMinNano,
  getJettonGasNano,
  base64Url,
  getEscrowTonBufferNano,
  isRetryAfterError,
  checkMessageExists,
  triggerRefund,
  triggerPayout,
  getPayoutDelayMinutes,
  splitPayoutAmount,
  getServiceCommissionAddress,
  requireIntParam,
} from "../helpers";
import { asyncHandler } from "../asyncHandler";
import { logger } from "../logger";

const router = Router();

// ─── Reusable: check on-chain payment and update status ─────────────
type RefreshResult =
  | { status: "paid"; payment: Record<string, unknown> }
  | { status: "pending"; confirmations?: number }
  | { status: "not_found" }
  | { status: "skip"; reason: string };

async function refreshPaymentOnChain(paymentId: number): Promise<RefreshResult> {
  const tonConfig = getTonConfigFromEnv();

  const { rows: paymentRows } = await pool.query(
    `
      SELECT
        id,
        order_group_id,
        status,
        total_usdt,
        reference,
        escrow_address,
        escrow_address_raw,
        external_id,
        confirmations
      FROM payments
      WHERE id = $1
    `,
    [paymentId],
  );

  if (paymentRows.length === 0) {
    return { status: "skip", reason: "not found" };
  }

  const payment = paymentRows[0];
  if (payment.status === "paid") {
    return { status: "paid", payment };
  }
  if (!payment.reference) {
    return { status: "skip", reason: "no reference" };
  }

  const escrowAddress = payment.escrow_address;
  if (!escrowAddress) {
    return { status: "skip", reason: "no escrow address" };
  }

  const decimals = await getJettonDecimals(tonConfig.usdtJettonMaster, tonConfig.apiKey);
  const expectedAmount = toJettonAmount(String(payment.total_usdt), decimals);
  const expectedAddresses = new Set<string>();
  expectedAddresses.add(normalizeTonAddress(escrowAddress));
  if (payment.escrow_address_raw) {
    expectedAddresses.add(normalizeTonAddress(payment.escrow_address_raw));
  }
  if (tonConfig.usdtJettonWallet) {
    expectedAddresses.add(normalizeTonAddress(tonConfig.usdtJettonWallet));
  }
  if (tonConfig.usdtJettonWalletRaw) {
    expectedAddresses.add(normalizeTonAddress(tonConfig.usdtJettonWalletRaw));
  }

  const expectedJettonMasters = new Set<string>();
  expectedJettonMasters.add(normalizeTonAddress(tonConfig.usdtJettonMaster));
  if (tonConfig.usdtJettonMasterRaw) {
    expectedJettonMasters.add(normalizeTonAddress(tonConfig.usdtJettonMasterRaw));
  }

  const events = await getAccountEvents(escrowAddress, tonConfig.apiKey, 50);

  let matchedTransfer:
    | { sender?: string; txHashes: string[]; timestamp?: number }
    | undefined;

  for (const event of events) {
    for (const action of event.actions ?? []) {
      const transfer = action.JettonTransfer;
      if (!transfer) continue;
      const recipient = normalizeTonAddress(transfer.recipient?.address ?? "");
      const recipientWallet = normalizeTonAddress(transfer.recipients_wallet ?? "");
      const jettonMaster = normalizeTonAddress(
        transfer.jetton?.address ?? transfer.jetton_master ?? "",
      );
      const amount = String(transfer.amount ?? "");
      const comment = String(transfer.comment ?? "");

      if (
        (!recipient && !recipientWallet) ||
        (!expectedAddresses.has(recipient) && !expectedAddresses.has(recipientWallet))
      ) continue;
      if (jettonMaster && !expectedJettonMasters.has(jettonMaster)) continue;
      if (amount !== expectedAmount) continue;
      if (!comment || !comment.includes(payment.reference)) continue;

      const txHashes = [
        transfer.transaction?.hash,
        transfer.tx_hash,
        event.event_id,
        ...(event.base_transactions ?? []),
      ].filter((value): value is string => Boolean(value));

      matchedTransfer = {
        sender: transfer.sender?.address,
        txHashes,
        timestamp: event.timestamp,
      };
      break;
    }
    if (matchedTransfer) break;
  }

  if (!matchedTransfer) {
    return { status: "not_found" };
  }

  const requiredTon = getEscrowRequiredTonMinNano();
  const tonBalance = await getAccountTonBalance(escrowAddress, tonConfig.apiKey);
  if (tonBalance < requiredTon) {
    return { status: "skip", reason: "escrow TON deposit missing" };
  }

  let confirmations = 0;
  if (matchedTransfer.txHashes.length > 0) {
    const headSeqno = await getMasterchainSeqno(tonConfig.apiKey);
    for (const txHash of matchedTransfer.txHashes) {
      const txSeqno = await getTransactionSeqno(txHash, tonConfig.apiKey);
      if (txSeqno) {
        confirmations = Math.max(headSeqno - txSeqno + 1, 0);
        break;
      }
    }
  }

  if (confirmations === 0 && matchedTransfer.timestamp) {
    const elapsedSeconds = Math.max(
      Math.floor(Date.now() / 1000) - matchedTransfer.timestamp,
      0,
    );
    const requiredSeconds =
      tonConfig.confirmationsRequired * tonConfig.blockTimeSeconds;
    if (elapsedSeconds >= requiredSeconds) {
      confirmations = tonConfig.confirmationsRequired;
    }
  }

  if (confirmations < tonConfig.confirmationsRequired) {
    return { status: "pending", confirmations };
  }

  const { rows: updatedRows } = await pool.query(
    `
      UPDATE payments
      SET
        status = 'paid',
        payer_address = $2,
        paid_tx_hash = $3,
        paid_at = NOW(),
        confirmations = $4,
        updated_at = NOW()
      WHERE id = $1
      RETURNING
        id, order_group_id, status, amount_usdt, fee_usdt, total_usdt,
        reference, provider, escrow_address, external_id, payer_address,
        paid_tx_hash, paid_at, confirmations, created_at, updated_at
    `,
    [
      paymentId,
      matchedTransfer.sender ?? null,
      matchedTransfer.txHashes[0] ?? null,
      confirmations,
    ],
  );

  return { status: "paid", payment: updatedRows[0] };
}

router.post("/payments/intent", asyncHandler(async (req, res) => {
  const groupId = Number(req.body?.groupId);
  if (!groupId) {
    return res.status(400).json({ error: "groupId is required" });
  }

  let tonConfig;
  try {
    tonConfig = getTonConfigFromEnv();
  } catch (error) {
    const message = error instanceof Error ? error.message : "TonAPI config error";
    return res.status(500).json({ error: message });
  }
  const jettonDecimals = await getJettonDecimals(
    tonConfig.usdtJettonMaster,
    tonConfig.apiKey,
  );

  const { rows: groupRows } = await pool.query(
    "SELECT id, status FROM order_groups WHERE id = $1",
    [groupId],
  );
  if (groupRows.length === 0) {
    return res.status(404).json({ error: "Order group not found" });
  }
  if (groupRows[0].status !== "pending_payment") {
    return res.status(409).json({ error: "Order group is not pending_payment" });
  }

  const paymentReturnFields = `
    id,
    order_group_id,
    status,
    amount_usdt,
    fee_usdt,
    total_usdt,
    reference,
    provider,
    escrow_address,
    escrow_address_raw,
    external_id,
    payer_address,
    paid_tx_hash,
    paid_at,
    confirmations,
    created_at,
    updated_at
  `;
  const { rows: existingRows } = await pool.query(
    `
      SELECT
        ${paymentReturnFields},
        escrow_private_key_encrypted
      FROM payments
      WHERE order_group_id = $1 AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [groupId],
  );
  const sanitizePayment = (row: Record<string, unknown>) => {
    const { escrow_private_key_encrypted: _secret, escrow_address_raw: _raw, ...safe } = row;
    return safe;
  };
  if (existingRows.length > 0) {
    let payment = existingRows[0];
    if (!payment.escrow_address || !payment.escrow_private_key_encrypted) {
      const wallet = await generateEscrowWallet();
      const { rows: updatedRows } = await pool.query(
        `
          UPDATE payments
          SET escrow_address = $2,
              escrow_address_raw = $3,
              escrow_private_key_encrypted = $4,
              updated_at = NOW()
          WHERE id = $1
          RETURNING ${paymentReturnFields}
        `,
        [payment.id, wallet.address, wallet.addressRaw, wallet.secretKeyEncrypted],
      );
      payment = updatedRows[0];
    }
    if (!payment.reference) {
      const reference = `pay_${groupId}_${randomBytes(4).toString("hex")}`;
      const { rows: updatedRows } = await pool.query(
        `
          UPDATE payments
          SET reference = $2, provider = $3, updated_at = NOW()
          WHERE id = $1
          RETURNING ${paymentReturnFields}
        `,
        [payment.id, reference, "tonapi"],
      );
      payment = updatedRows[0];
    }
    const jettonAmount = toJettonAmount(String(payment.total_usdt), jettonDecimals);
      const tonkeeperUrl = buildTonkeeperUrl(
        String(payment.escrow_address),
        tonConfig.usdtJettonMaster,
        jettonAmount,
        String(payment.reference),
      );
    return res.status(200).json({
      payment: sanitizePayment(payment),
      instructions: {
        escrowAddress: payment.escrow_address,
        jettonMaster: tonConfig.usdtJettonMaster,
        comment: payment.reference,
        jettonAmount,
        tonkeeperUrl,
        requiredTonNano: getEscrowRequiredTonNano().toString(),
        confirmationsRequired: tonConfig.confirmationsRequired,
      },
    });
  }

  const { rows: sumRows } = await pool.query(
    `
      SELECT COALESCE(SUM(price_usdt), 0)::numeric(12, 2) AS amount_usdt
      FROM orders
      WHERE group_id = $1
    `,
    [groupId],
  );
  const amountUsdt = Number(sumRows[0]?.amount_usdt ?? 0);
  const testAmountRaw = String(process.env.TEST_PAYMENT_AMOUNT_USDT ?? "").trim();
  const testAmount = testAmountRaw ? Number(testAmountRaw) : null;
  const baseAmount =
    testAmount !== null && Number.isFinite(testAmount) && testAmount > 0
      ? testAmount
      : amountUsdt;
  if (!Number.isFinite(baseAmount) || baseAmount <= 0) {
    return res.status(400).json({ error: "Order group amount is invalid" });
  }

  const { rows: calcRows } = await pool.query(
    `
      SELECT
        $1::numeric(12, 2) AS amount_usdt,
        0::numeric(12, 2) AS fee_usdt,
        $1::numeric(12, 2) AS total_usdt
    `,
    [baseAmount],
  );

  const reference = `pay_${groupId}_${randomBytes(4).toString("hex")}`;
  const escrowWallet = await generateEscrowWallet();
  const { rows: paymentRows } = await pool.query(
    `
      INSERT INTO payments (
        order_group_id,
        amount_usdt,
        fee_usdt,
        total_usdt,
        reference,
        provider,
        escrow_address,
        escrow_address_raw,
        escrow_private_key_encrypted
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING
        ${paymentReturnFields}
    `,
    [
      groupId,
      calcRows[0].amount_usdt,
      calcRows[0].fee_usdt,
      calcRows[0].total_usdt,
      reference,
      "tonapi",
      escrowWallet.address,
      escrowWallet.addressRaw,
      escrowWallet.secretKeyEncrypted,
    ],
  );

  const jettonAmount = toJettonAmount(
    String(paymentRows[0].total_usdt),
    jettonDecimals,
  );
  const tonkeeperUrl = buildTonkeeperUrl(
    escrowWallet.address,
    tonConfig.usdtJettonMaster,
    jettonAmount,
    reference,
  );
  return res.status(200).json({
    payment: sanitizePayment(paymentRows[0]),
    instructions: {
      escrowAddress: escrowWallet.address,
      jettonMaster: tonConfig.usdtJettonMaster,
      comment: reference,
      jettonAmount,
      tonkeeperUrl,
        requiredTonNano: getEscrowRequiredTonNano().toString(),
      confirmationsRequired: tonConfig.confirmationsRequired,
    },
  });
}));

router.patch("/payments/:paymentId/status", asyncHandler(async (req, res) => {
  const paymentId = requireIntParam(req.params.paymentId, "paymentId");
  const nextStatus = String(req.body?.status ?? "");
  const allowedStatuses = new Set(["pending", "accepted", "rejected", "paid"]);

  if (!paymentId) {
    return res.status(400).json({ error: "Invalid paymentId" });
  }
  if (!allowedStatuses.has(nextStatus)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  const { rows: paymentRows } = await pool.query(
    `
      SELECT
        id,
        status,
        total_usdt,
        payer_address,
        reference,
        refund_tx_hash,
        refund_status,
        payout_status,
        payout_ready_at,
        escrow_address,
        escrow_private_key_encrypted
      FROM payments
      WHERE id = $1
    `,
    [paymentId],
  );
  if (paymentRows.length === 0) {
    return res.status(404).json({ error: "Payment not found" });
  }

  const currentStatus = paymentRows[0].status as string;
  const transitions: Record<string, Set<string>> = {
    pending: new Set(["paid", "rejected"]),
    paid: new Set(["accepted", "rejected"]),
    accepted: new Set(["rejected"]),
    rejected: new Set([]),
  };

  if (currentStatus === nextStatus) {
    return res.status(200).json({ paymentId, status: currentStatus });
  }
  if (!transitions[currentStatus]?.has(nextStatus)) {
    return res.status(409).json({ error: "Invalid status transition" });
  }

  if (nextStatus === "accepted" && currentStatus === "paid") {
    const payoutDelayMinutes = getPayoutDelayMinutes();
    const { rows: acceptedRows } = await pool.query(
      `
        UPDATE payments
        SET
          status = 'accepted',
          payout_status = 'verification_pending',
          payout_ready_at = NOW() + ($2 || ' minutes')::interval,
          updated_at = NOW()
        WHERE id = $1
        RETURNING
          id,
          order_group_id,
          status,
          amount_usdt,
          fee_usdt,
          total_usdt,
          reference,
          provider,
          escrow_address,
          external_id,
          payer_address,
          paid_tx_hash,
          paid_at,
          confirmations,
          refund_tx_hash,
          refunded_at,
          refund_status,
          refund_error,
          payout_status,
          payout_ready_at,
          payout_tx_hash,
          payout_error,
          created_at,
          updated_at
      `,
      [paymentId, payoutDelayMinutes],
    );

    return res.status(200).json({ payment: acceptedRows[0] });
  }

  if (nextStatus === "rejected" && (currentStatus === "paid" || currentStatus === "accepted")) {
    if (!paymentRows[0].payer_address) {
      return res.status(409).json({ error: "payer_address is missing" });
    }
    if (paymentRows[0].refund_tx_hash || paymentRows[0].refund_status === "pending") {
      return res.status(409).json({ error: "Refund already sent" });
    }

    const { rows: rejectedRows } = await pool.query(
      `
        UPDATE payments
        SET
          status = 'rejected',
          refund_status = 'pending',
          updated_at = NOW()
        WHERE id = $1
        RETURNING
          id,
          order_group_id,
          status,
          amount_usdt,
          fee_usdt,
          total_usdt,
          reference,
          provider,
          escrow_address,
          external_id,
          payer_address,
          paid_tx_hash,
          paid_at,
          confirmations,
          refund_tx_hash,
          refunded_at,
          refund_status,
          refund_error,
          created_at,
          updated_at
      `,
      [paymentId],
    );

    triggerRefund({
      paymentId,
      payerAddress: String(paymentRows[0].payer_address),
      totalUsdt: String(paymentRows[0].total_usdt),
      reference: paymentRows[0].reference ? String(paymentRows[0].reference) : null,
      escrowAddress: paymentRows[0].escrow_address ?? null,
      escrowSecretEncrypted: paymentRows[0].escrow_private_key_encrypted ?? null,
    });

    return res.status(200).json({ payment: rejectedRows[0] });
  }

  const { rows: updatedRows } = await pool.query(
    `
      UPDATE payments
      SET status = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        order_group_id,
        status,
        amount_usdt,
        fee_usdt,
        total_usdt,
        reference,
        provider,
        escrow_address,
        external_id,
        payer_address,
        paid_tx_hash,
        paid_at,
        confirmations,
        refund_tx_hash,
        refunded_at,
        refund_status,
        refund_error,
        payout_status,
        payout_ready_at,
        payout_tx_hash,
        payout_error,
        created_at,
        updated_at
    `,
    [paymentId, nextStatus],
  );

  return res.status(200).json({ payment: updatedRows[0] });
}));

export const processScheduledPayouts = async () => {
  const { rows } = await pool.query(
    `
      SELECT
        p.id,
        p.amount_usdt,
        p.total_usdt,
        p.reference,
        p.payer_address,
        p.refund_tx_hash,
        p.refund_status,
        p.escrow_address,
        p.escrow_private_key_encrypted,
        c.payout_address,
        COUNT(DISTINCT o.channel_telegram_id) AS channel_count
      FROM payments p
      JOIN order_groups og ON og.id = p.order_group_id
      JOIN orders o ON o.group_id = og.id
      JOIN channels c ON c.telegram_id = o.channel_telegram_id
      WHERE p.status = 'accepted'
        AND p.payout_status = 'verification_pending'
        AND p.payout_ready_at IS NOT NULL
        AND p.payout_ready_at <= NOW()
      GROUP BY p.id, c.payout_address, p.escrow_address, p.escrow_private_key_encrypted
    `,
  );

  for (const row of rows) {
    const { rows: updatedRows } = await pool.query(
      `
        UPDATE payments
        SET
          payout_status = 'verifying',
          payout_error = NULL,
          updated_at = NOW()
        WHERE id = $1 AND payout_status = 'verification_pending'
        RETURNING id
      `,
      [row.id],
    );
    if (updatedRows.length === 0) {
      continue;
    }
    if (Number(row.channel_count) > 1) {
      await pool.query(
        `
          UPDATE payments
          SET payout_status = 'failed', payout_error = 'multiple channels in payment'
          WHERE id = $1
        `,
        [row.id],
      );
      continue;
    }
    if (!row.payout_address) {
      await pool.query(
        `
          UPDATE payments
          SET payout_status = 'failed', payout_error = 'payout_address is missing'
          WHERE id = $1
        `,
        [row.id],
      );
      continue;
    }

    const { rows: orderRows } = await pool.query(
      `
        SELECT
          id,
          channel_telegram_id,
          published_message_id,
          published_channel_id,
          publish_status,
          verify_status
        FROM orders
        WHERE group_id = (SELECT order_group_id FROM payments WHERE id = $1)
        ORDER BY created_at ASC
      `,
      [row.id],
    );

    if (orderRows.length === 0) {
      await pool.query(
        `
          UPDATE payments
          SET payout_status = 'failed', payout_error = 'orders not found'
          WHERE id = $1
        `,
        [row.id],
      );
      continue;
    }

    const publishMissing = orderRows.some(
      (order) => !order.published_message_id || order.publish_status !== "published",
    );
    if (publishMissing) {
      await pool.query(
        `
          UPDATE payments
          SET payout_status = 'failed', payout_error = 'message not published'
          WHERE id = $1
        `,
        [row.id],
      );
      continue;
    }

    let messageMissing = false;
    try {
      for (const order of orderRows) {
        const channelId = String(order.published_channel_id ?? order.channel_telegram_id);
        const messageId = Number(order.published_message_id);
        const exists = await checkMessageExists(botToken, channelId, messageId);
        if (!exists) {
          messageMissing = true;
          await pool.query(
            `
              UPDATE orders
              SET
                verify_status = 'deleted',
                verified_at = NOW(),
                verify_error = 'message deleted'
              WHERE id = $1
            `,
            [order.id],
          );
        } else {
          await pool.query(
            `
              UPDATE orders
              SET
                verify_status = 'passed',
                verified_at = NOW(),
                verify_error = NULL
              WHERE id = $1
            `,
            [order.id],
          );
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Verification failed";
      if (isRetryAfterError(message)) {
        await pool.query(
          `
            UPDATE payments
            SET payout_status = 'verification_pending', payout_error = $2, updated_at = NOW()
            WHERE id = $1
          `,
          [row.id, message],
        );
        continue;
      }
      await pool.query(
        `
          UPDATE payments
          SET payout_status = 'failed', payout_error = $2, updated_at = NOW()
          WHERE id = $1
        `,
        [row.id, message],
      );
      continue;
    }

    if (messageMissing) {
      if (!row.payer_address) {
        await pool.query(
          `
            UPDATE payments
            SET payout_status = 'failed', payout_error = 'payer_address is missing'
            WHERE id = $1
          `,
          [row.id],
        );
        continue;
      }

      const { rows: rejectedRows } = await pool.query(
        `
          UPDATE payments
          SET
            status = 'rejected',
            refund_status = CASE
              WHEN refund_status IS NULL OR refund_status = 'failed' THEN 'pending'
              ELSE refund_status
            END,
            payout_status = 'cancelled',
            payout_error = 'message deleted',
            updated_at = NOW()
          WHERE id = $1
          RETURNING
            payer_address,
            total_usdt,
            reference,
            refund_tx_hash,
            refund_status
        `,
        [row.id],
      );

      if (rejectedRows.length > 0) {
        const rejected = rejectedRows[0];
        if (!rejected.refund_tx_hash && rejected.refund_status === "pending") {
          triggerRefund({
            paymentId: Number(row.id),
            payerAddress: String(rejected.payer_address),
            totalUsdt: String(rejected.total_usdt),
            reference: rejected.reference ? String(rejected.reference) : null,
            escrowAddress: row.escrow_address ?? null,
            escrowSecretEncrypted: row.escrow_private_key_encrypted ?? null,
          });
        }
      }
      continue;
    }

    const { rows: payoutRows } = await pool.query(
      `
        UPDATE payments
        SET payout_status = 'processing', payout_error = NULL, updated_at = NOW()
        WHERE id = $1
        RETURNING id
      `,
      [row.id],
    );
    if (payoutRows.length === 0) {
      continue;
    }

    triggerPayout({
      paymentId: Number(row.id),
      payoutAddress: String(row.payout_address),
      amountUsdt: String(row.amount_usdt),
      reference: row.reference ? String(row.reference) : null,
      escrowAddress: row.escrow_address ?? null,
      escrowSecretEncrypted: row.escrow_private_key_encrypted ?? null,
    });
  }
};

router.post("/payments/:paymentId/refund", asyncHandler(async (req, res) => {
  const paymentId = requireIntParam(req.params.paymentId, "paymentId");
  if (!paymentId) {
    return res.status(400).json({ error: "Invalid paymentId" });
  }

  const { rows: paymentRows } = await pool.query(
    `
      SELECT
        id,
        status,
        total_usdt,
        payer_address,
        reference,
        refund_tx_hash,
        refund_status,
        escrow_address,
        escrow_private_key_encrypted
      FROM payments
      WHERE id = $1
    `,
    [paymentId],
  );

  if (paymentRows.length === 0) {
    return res.status(404).json({ error: "Payment not found" });
  }

  if (paymentRows[0].status !== "rejected") {
    return res.status(409).json({ error: "Payment is not rejected" });
  }
  if (!paymentRows[0].payer_address) {
    return res.status(409).json({ error: "payer_address is missing" });
  }
  if (paymentRows[0].refund_tx_hash || paymentRows[0].refund_status === "pending") {
    return res.status(409).json({ error: "Refund already sent" });
  }

  const { rows: updatedRows } = await pool.query(
    `
      UPDATE payments
      SET
        refund_status = 'pending',
        refund_error = NULL,
        updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        order_group_id,
        status,
        amount_usdt,
        fee_usdt,
        total_usdt,
        reference,
        provider,
        escrow_address,
        external_id,
        payer_address,
        paid_tx_hash,
        paid_at,
        confirmations,
        refund_tx_hash,
        refunded_at,
        refund_status,
        refund_error,
        payout_status,
        payout_ready_at,
        payout_tx_hash,
        payout_error,
        created_at,
        updated_at
    `,
    [paymentId],
  );

  triggerRefund({
    paymentId,
    payerAddress: String(paymentRows[0].payer_address),
    totalUsdt: String(paymentRows[0].total_usdt),
    reference: paymentRows[0].reference ? String(paymentRows[0].reference) : null,
    escrowAddress: paymentRows[0].escrow_address ?? null,
    escrowSecretEncrypted: paymentRows[0].escrow_private_key_encrypted ?? null,
  });

  return res.status(200).json({ payment: updatedRows[0] });
}));

router.post("/payments/:paymentId/payout", asyncHandler(async (req, res) => {
  const paymentId = requireIntParam(req.params.paymentId, "paymentId");
  if (!paymentId) {
    return res.status(400).json({ error: "Invalid paymentId" });
  }

  const { rows: paymentRows } = await pool.query(
    `
      SELECT
        p.id,
        p.status,
        p.amount_usdt,
        p.reference,
        p.payout_status,
        p.payout_ready_at,
        p.escrow_address,
        p.escrow_private_key_encrypted,
        c.payout_address,
        COUNT(DISTINCT o.channel_telegram_id) AS channel_count,
        BOOL_AND(o.verify_status = 'passed') AS all_verified
      FROM payments p
      JOIN order_groups og ON og.id = p.order_group_id
      JOIN orders o ON o.group_id = og.id
      JOIN channels c ON c.telegram_id = o.channel_telegram_id
      WHERE p.id = $1
      GROUP BY p.id, c.payout_address, p.escrow_address, p.escrow_private_key_encrypted
    `,
    [paymentId],
  );

  if (paymentRows.length === 0) {
    return res.status(404).json({ error: "Payment not found" });
  }

  const payment = paymentRows[0];
  if (Number(payment.channel_count) > 1) {
    return res.status(409).json({ error: "Multiple channels in one payment" });
  }
  if (payment.status !== "accepted") {
    return res.status(409).json({ error: "Payment is not accepted" });
  }
  if (!payment.payout_address) {
    return res.status(409).json({ error: "payout_address is missing" });
  }
  if (payment.payout_status === "sent" || payment.payout_status === "processing") {
    return res.status(409).json({ error: "Payout already sent" });
  }
  if (!payment.all_verified) {
    return res.status(409).json({ error: "Message is not verified yet" });
  }
  if (payment.payout_ready_at && new Date(payment.payout_ready_at).getTime() > Date.now()) {
    return res.status(409).json({ error: "Payout is not ready yet" });
  }

  const { rows: updatedRows } = await pool.query(
    `
      UPDATE payments
      SET
        payout_status = 'processing',
        payout_error = NULL,
        updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        order_group_id,
        status,
        amount_usdt,
        fee_usdt,
        total_usdt,
        reference,
        provider,
        escrow_address,
        external_id,
        payer_address,
        paid_tx_hash,
        paid_at,
        confirmations,
        refund_tx_hash,
        refunded_at,
        refund_status,
        refund_error,
        payout_status,
        payout_ready_at,
        payout_tx_hash,
        payout_error,
        created_at,
        updated_at
    `,
    [paymentId],
  );

  triggerPayout({
    paymentId,
    payoutAddress: String(payment.payout_address),
    amountUsdt: String(payment.amount_usdt),
    reference: payment.reference ? String(payment.reference) : null,
    escrowAddress: payment.escrow_address ?? null,
    escrowSecretEncrypted: payment.escrow_private_key_encrypted ?? null,
  });

  return res.status(200).json({ payment: updatedRows[0] });
}));

router.post("/payments/:paymentId/refresh", asyncHandler(async (req, res) => {
  const paymentId = requireIntParam(req.params.paymentId, "paymentId");

  const result = await refreshPaymentOnChain(paymentId);

  switch (result.status) {
    case "paid":
      return res.status(200).json({ payment: result.payment });
    case "pending":
      return res.status(200).json({
        paymentId,
        status: "pending",
        confirmations: result.confirmations,
      });
    case "not_found":
      return res.status(404).json({ error: "Matching on-chain transfer not found yet" });
    case "skip":
      return res.status(409).json({ error: result.reason });
  }
}));

router.post("/payments/:paymentId/txrequest", asyncHandler(async (req, res) => {
  try {
    const paymentId = requireIntParam(req.params.paymentId, "paymentId");
    const walletAddress = String(req.body?.walletAddress ?? "").trim();
    if (!paymentId) {
      return res.status(400).json({ error: "Invalid paymentId" });
    }
    if (!walletAddress) {
      return res.status(400).json({ error: "walletAddress is required" });
    }

    const { rows: paymentRows } = await pool.query(
      `
        SELECT
          id,
          status,
          total_usdt,
          reference,
          escrow_address
        FROM payments
        WHERE id = $1
      `,
      [paymentId],
    );
    if (paymentRows.length === 0) {
      return res.status(404).json({ error: "Payment not found" });
    }
    if (!paymentRows[0].escrow_address) {
      return res.status(409).json({ error: "Escrow address is missing" });
    }
    if (!paymentRows[0].reference) {
      return res.status(409).json({ error: "Payment reference is missing" });
    }

    const tonConfig = getTonConfigFromEnv();
    const decimals = await getJettonDecimals(tonConfig.usdtJettonMaster, tonConfig.apiKey);
    const jettonAmount = toJettonAmount(String(paymentRows[0].total_usdt), decimals);
    const userJettonWallet = await getJettonWalletAddress(
      walletAddress,
      tonConfig.usdtJettonMaster,
      tonConfig.apiKey,
    );
    if (!userJettonWallet) {
      return res.status(409).json({ error: "User jetton wallet not found" });
    }

    const payload = buildJettonTransferPayload({
      toAddress: String(paymentRows[0].escrow_address),
      responseAddress: walletAddress,
      jettonAmount,
      comment: String(paymentRows[0].reference),
    });

    const tx = {
      validUntil: Math.floor(Date.now() / 1000) + 600,
      messages: [
        {
          address: String(paymentRows[0].escrow_address),
          amount: getEscrowRequiredTonNano().toString(),
        },
        {
          address: userJettonWallet,
          amount: getJettonGasNano().toString(),
          payload,
        },
      ],
    };

    return res.status(200).json({ tx });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Txrequest failed";
    return res.status(400).json({ error: message });
  }
}));

router.post("/payments/:paymentId/tonkeeper-link", asyncHandler(async (req, res) => {
  try {
    const paymentId = requireIntParam(req.params.paymentId, "paymentId");
    const walletAddress = String(req.body?.walletAddress ?? "").trim();
    if (!paymentId) {
      return res.status(400).json({ error: "Invalid paymentId" });
    }
    if (!walletAddress) {
      return res.status(400).json({ error: "walletAddress is required" });
    }

    const { rows: paymentRows } = await pool.query(
      `
        SELECT
          id,
          total_usdt,
          reference,
          escrow_address
        FROM payments
        WHERE id = $1
      `,
      [paymentId],
    );
    if (paymentRows.length === 0) {
      return res.status(404).json({ error: "Payment not found" });
    }
    if (!paymentRows[0].escrow_address) {
      return res.status(409).json({ error: "Escrow address is missing" });
    }
    if (!paymentRows[0].reference) {
      return res.status(409).json({ error: "Payment reference is missing" });
    }

    const tonConfig = getTonConfigFromEnv();
    const decimals = await getJettonDecimals(tonConfig.usdtJettonMaster, tonConfig.apiKey);
    const jettonAmount = toJettonAmount(String(paymentRows[0].total_usdt), decimals);
    const userJettonWallet = await getJettonWalletAddress(
      walletAddress,
      tonConfig.usdtJettonMaster,
      tonConfig.apiKey,
    );
    if (!userJettonWallet) {
      return res.status(409).json({ error: "User jetton wallet not found" });
    }

    const requiredTon = getEscrowRequiredTonNano();
    const bufferTon = getEscrowTonBufferNano();
    const payload = buildJettonTransferPayload({
      toAddress: String(paymentRows[0].escrow_address),
      responseAddress: walletAddress,
      jettonAmount,
      comment: String(paymentRows[0].reference),
      forwardTonAmountNano: requiredTon.toString(),
    });
    const tonAmount = requiredTon + getJettonGasNano() + bufferTon;

    const params = new URLSearchParams({
      amount: tonAmount.toString(),
      bin: base64Url(payload),
    });
    const tonkeeperUrl = `https://app.tonkeeper.com/transfer/${userJettonWallet}?${params.toString()}`;

    return res.status(200).json({
      tonkeeperUrl,
      requiredTonNano: requiredTon.toString(),
      bufferTonNano: bufferTon.toString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tonkeeper link failed";
    return res.status(400).json({ error: message });
  }
}));

// ─── Background job: auto-detect pending payments on-chain ──────────
export const processPendingPayments = async () => {
  const { rows } = await pool.query(
    `
      SELECT id
      FROM payments
      WHERE status = 'pending'
        AND escrow_address IS NOT NULL
        AND reference IS NOT NULL
        AND created_at > NOW() - INTERVAL '24 hours'
      ORDER BY created_at ASC
      LIMIT 10
    `,
  );

  for (const row of rows) {
    try {
      const result = await refreshPaymentOnChain(row.id);
      if (result.status === "paid") {
        logger.info(`Payment ${row.id} auto-confirmed on-chain`);
      }
    } catch (error) {
      logger.error(`Auto-refresh payment ${row.id} failed`, error);
    }
  }
};

export default router;
