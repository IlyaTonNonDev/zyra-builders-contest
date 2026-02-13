import { Address } from "@ton/core";

type TonApiEvent = {
  event_id?: string;
  base_transactions?: string[];
  timestamp?: number;
  actions?: TonApiAction[];
};

type TonApiAction = {
  type?: string;
  JettonTransfer?: TonApiJettonTransfer;
};

type TonApiJettonTransfer = {
  sender?: { address?: string };
  recipient?: { address?: string };
  senders_wallet?: string;
  recipients_wallet?: string;
  amount?: string;
  comment?: string;
  jetton?: { address?: string; decimals?: number };
  jetton_master?: string;
  transaction?: { hash?: string };
  tx_hash?: string;
};

type TonApiJettonInfo = {
  decimals?: number;
  metadata?: {
    decimals?: string | number;
  };
};

type TonApiMasterchainHead = {
  seqno?: number;
};

type TonApiTransaction = {
  mc_block_seqno?: number;
  block?: { seqno?: number };
};

type TonApiAccount = {
  balance?: string;
};

type TonApiJettonWallets = {
  balances?: Array<{
    jetton?: { address?: string };
    wallet_address?: { address?: string };
    address?: string;
  }>;
};

const TONAPI_BASE_URL = "https://tonapi.io/v2";

export type TonConfig = {
  apiKey: string;
  escrowAddress: string;
  escrowAddressRaw?: string;
  usdtJettonMaster: string;
  usdtJettonMasterRaw?: string;
  usdtJettonWallet?: string;
  usdtJettonWalletRaw?: string;
  confirmationsRequired: number;
  blockTimeSeconds: number;
};

export function getTonConfigFromEnv(): TonConfig {
  const apiKey = String(process.env.TONAPI_KEY ?? "").trim();
  const escrowAddress = String(process.env.TON_ESCROW_ADDRESS ?? "").trim();
  const escrowAddressRaw = String(process.env.TON_ESCROW_ADDRESS_RAW ?? "").trim();
  const usdtJettonMaster = String(process.env.TON_USDT_JETTON ?? "").trim();
  const usdtJettonMasterRaw = String(process.env.TON_USDT_JETTON_RAW ?? "").trim();
  const usdtJettonWallet = String(process.env.TON_USDT_JETTON_WALLET ?? "").trim();
  const usdtJettonWalletRaw = String(process.env.TON_USDT_JETTON_WALLET_RAW ?? "").trim();
  const confirmationsRaw = String(process.env.TON_CONFIRMATIONS ?? "10").trim();
  const blockTimeRaw = String(process.env.TON_BLOCK_TIME_SECONDS ?? "5").trim();
  const confirmationsRequired = Number(confirmationsRaw);
  const blockTimeSeconds = Number(blockTimeRaw);

  if (!apiKey) {
    throw new Error("TONAPI_KEY is not set");
  }
  if (!escrowAddress) {
    throw new Error("TON_ESCROW_ADDRESS is not set");
  }
  if (!usdtJettonMaster) {
    throw new Error("TON_USDT_JETTON is not set");
  }
  if (!Number.isFinite(confirmationsRequired) || confirmationsRequired < 0) {
    throw new Error("TON_CONFIRMATIONS must be a non-negative number");
  }
  if (!Number.isFinite(blockTimeSeconds) || blockTimeSeconds <= 0) {
    throw new Error("TON_BLOCK_TIME_SECONDS must be a positive number");
  }

  return {
    apiKey,
    escrowAddress,
    escrowAddressRaw: escrowAddressRaw || undefined,
    usdtJettonMaster,
    usdtJettonMasterRaw: usdtJettonMasterRaw || undefined,
    usdtJettonWallet: usdtJettonWallet || undefined,
    usdtJettonWalletRaw: usdtJettonWalletRaw || undefined,
    confirmationsRequired,
    blockTimeSeconds,
  };
}

async function tonApiRequest<T>(path: string, apiKey: string): Promise<T> {
  const response = await fetch(`${TONAPI_BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`TonAPI request failed: ${response.status} ${message}`);
  }

  return (await response.json()) as T;
}

export async function getJettonDecimals(
  jettonMaster: string,
  apiKey: string,
): Promise<number> {
  const data = await tonApiRequest<TonApiJettonInfo>(`/jettons/${jettonMaster}`, apiKey);
  const rawDecimals = data.metadata?.decimals ?? data.decimals;
  const decimals = Number(rawDecimals);
  if (!Number.isFinite(decimals) || decimals <= 0) {
    throw new Error("Invalid jetton decimals from TonAPI");
  }
  return decimals;
}

export async function getAccountEvents(
  accountId: string,
  apiKey: string,
  limit = 50,
): Promise<TonApiEvent[]> {
  const data = await tonApiRequest<{ events?: TonApiEvent[] }>(
    `/accounts/${accountId}/events?limit=${limit}`,
    apiKey,
  );
  return data.events ?? [];
}

export async function getMasterchainSeqno(apiKey: string): Promise<number> {
  const data = await tonApiRequest<TonApiMasterchainHead>(
    "/blockchain/masterchain-head",
    apiKey,
  );
  const seqno = Number(data.seqno ?? 0);
  if (!Number.isFinite(seqno) || seqno <= 0) {
    throw new Error("Invalid masterchain seqno from TonAPI");
  }
  return seqno;
}

export async function getTransactionSeqno(
  txHash: string,
  apiKey: string,
): Promise<number | null> {
  const data = await tonApiRequest<TonApiTransaction>(
    `/blockchain/transactions/${txHash}`,
    apiKey,
  );

  const seqno =
    data.mc_block_seqno ??
    data.block?.seqno ??
    null;

  if (seqno === null) {
    return null;
  }

  const num = Number(seqno);
  if (!Number.isFinite(num) || num <= 0) {
    return null;
  }
  return num;
}

export async function getAccountTonBalance(
  accountId: string,
  apiKey: string,
): Promise<bigint> {
  try {
    const data = await tonApiRequest<TonApiAccount>(`/accounts/${accountId}`, apiKey);
    const raw = String(data.balance ?? "0");
    return BigInt(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("404")) {
      return 0n;
    }
    throw error;
  }
}

export async function getJettonWalletAddress(
  ownerAddress: string,
  jettonMaster: string,
  apiKey: string,
): Promise<string | null> {
  const expected = normalizeTonAddress(jettonMaster);
  const tryExtract = (data: TonApiJettonWallets): string | null => {
    for (const entry of data.balances ?? []) {
      const jetton = normalizeTonAddress(entry.jetton?.address ?? "");
      if (jetton && jetton === expected) {
        const wallet =
          entry.wallet_address?.address ??
          entry.address ??
          "";
        return wallet || null;
      }
    }
    return null;
  };

  try {
    const data = await tonApiRequest<TonApiJettonWallets>(
      `/accounts/${ownerAddress}/jetton-wallets`,
      apiKey,
    );
    const wallet = tryExtract(data);
    if (wallet) {
      return wallet;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("404")) {
      throw error;
    }
  }

  const fallback = await tonApiRequest<TonApiJettonWallets>(
    `/accounts/${ownerAddress}/jettons`,
    apiKey,
  );
  return tryExtract(fallback);
}

export function normalizeTonAddress(address: string): string {
  const trimmed = address.trim();
  if (!trimmed) {
    return "";
  }
  try {
    return Address.parse(trimmed).toRawString().toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}
