import { Address, beginCell, toNano } from "@ton/core";
import { SendMode, TonClient, WalletContractV5R1, internal } from "@ton/ton";
import { keyPairFromSecretKey, keyPairFromSeed } from "@ton/crypto";
import { getJettonWalletAddress, getTonConfigFromEnv, normalizeTonAddress } from "./tonApi";

export type ToncenterConfig = {
  endpoint: string;
  apiKey: string;
  secretKey: Buffer;
  publicKey: Buffer;
  walletAddress: Address;
  jettonWalletAddress: Address;
  jettonMaster: Address;
  gasAmount: bigint;
};

type ToncenterSharedConfig = {
  endpoint: string;
  apiKey: string;
  gasAmount: bigint;
};

const normalizeEndpoint = (raw: string): string => {
  const trimmed = raw.endsWith("/") ? raw.slice(0, -1) : raw;
  if (trimmed.endsWith("/jsonRPC")) {
    return trimmed;
  }
  return `${trimmed}/jsonRPC`;
};

const parseAddress = (raw: string, name: string): Address => {
  try {
    return Address.parse(raw);
  } catch {
    throw new Error(`Invalid address for ${name}`);
  }
};

const parseSecretKey = (raw: string): Buffer => {
  const trimmed = raw.trim();
  const isHex = /^[0-9a-fA-F]+$/.test(trimmed);
  const buffer = Buffer.from(trimmed, isHex ? "hex" : "base64");
  if (buffer.length === 32 || buffer.length === 64) {
    return buffer;
  }
  throw new Error("TON_ESCROW_PRIVATE_KEY must be 32 or 64 bytes (hex or base64)");
};

const getEscrowTonMinRemainingNano = (): bigint => {
  const raw = String(process.env.ESCROW_TON_MIN_REMAIN ?? "0.01").trim();
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("ESCROW_TON_MIN_REMAIN must be >= 0");
  }
  return BigInt(Math.round(value * 1e9));
};

const getToncenterSharedConfig = (): ToncenterSharedConfig => {
  const endpointRaw = String(process.env.TONCENTER_ENDPOINT ?? "").trim();
  const apiKey = String(process.env.TONCENTER_API_KEY ?? "").trim();
  const gasRaw = String(process.env.TON_JETTON_GAS ?? "0.05").trim();

  if (!endpointRaw) {
    throw new Error("TONCENTER_ENDPOINT is not set");
  }
  if (!apiKey) {
    throw new Error("TONCENTER_API_KEY is not set");
  }

  return {
    endpoint: normalizeEndpoint(endpointRaw),
    apiKey,
    gasAmount: toNano(gasRaw),
  };
};

export function getToncenterConfigFromEnv(): ToncenterConfig {
  const shared = getToncenterSharedConfig();
  const privateKeyRaw = String(process.env.TON_ESCROW_PRIVATE_KEY ?? "").trim();
  const jettonWalletRaw = String(process.env.TON_USDT_JETTON_WALLET ?? "").trim();
  const jettonMasterRaw = String(process.env.TON_USDT_JETTON ?? "").trim();

  if (!privateKeyRaw) {
    throw new Error("TON_ESCROW_PRIVATE_KEY is not set");
  }
  if (!jettonWalletRaw) {
    throw new Error("TON_USDT_JETTON_WALLET is not set");
  }
  if (!jettonMasterRaw) {
    throw new Error("TON_USDT_JETTON is not set");
  }

  const secretKey = parseSecretKey(privateKeyRaw);
  const keyPair =
    secretKey.length === 32 ? keyPairFromSeed(secretKey) : keyPairFromSecretKey(secretKey);

  const wallet = WalletContractV5R1.create({
    workchain: 0,
    publicKey: keyPair.publicKey,
  });

  return {
    endpoint: shared.endpoint,
    apiKey: shared.apiKey,
    secretKey: keyPair.secretKey,
    publicKey: keyPair.publicKey,
    walletAddress: wallet.address,
    jettonWalletAddress: parseAddress(jettonWalletRaw, "TON_USDT_JETTON_WALLET"),
    jettonMaster: parseAddress(jettonMasterRaw, "TON_USDT_JETTON"),
    gasAmount: shared.gasAmount,
  };
}

const buildJettonTransferBody = (
  to: Address,
  responseTo: Address,
  jettonAmount: bigint,
  comment?: string,
  forwardTonAmount: bigint = toNano("0.01"),
) => {
  const cell = beginCell()
    .storeUint(0xf8a7ea5, 32) // jetton transfer op
    .storeUint(0, 64) // query_id
    .storeCoins(jettonAmount)
    .storeAddress(to)
    .storeAddress(responseTo)
    .storeBit(0) // no custom payload
    .storeCoins(forwardTonAmount) // forward TON amount
    .storeBit(comment ? 1 : 0);

  if (comment) {
    const forwardPayload = beginCell().storeUint(0, 32).storeStringTail(comment).endCell();
    cell.storeRef(forwardPayload);
  }

  return cell.endCell();
};

export const buildJettonTransferPayload = (params: {
  toAddress: string;
  responseAddress: string;
  jettonAmount: string;
  comment?: string;
  forwardTonAmountNano?: string;
}): string => {
  const destination = Address.parse(params.toAddress);
  const responseTo = Address.parse(params.responseAddress);
  const amount = BigInt(params.jettonAmount);
  const forwardTon = params.forwardTonAmountNano
    ? BigInt(params.forwardTonAmountNano)
    : undefined;
  const body = buildJettonTransferBody(
    destination,
    responseTo,
    amount,
    params.comment,
    forwardTon ?? toNano("0.01"),
  );
  return body.toBoc().toString("base64");
};

export async function sendJettonTransfer(params: {
  toAddress: string;
  jettonAmount: string;
  comment?: string;
}): Promise<{ txHash: string }> {
  const config = getToncenterConfigFromEnv();
  const client = new TonClient({ endpoint: config.endpoint, apiKey: config.apiKey });
  const wallet = WalletContractV5R1.create({
    workchain: 0,
    publicKey: config.publicKey,
  });
  const walletContract = client.open(wallet);
  const balance = await client.getBalance(config.walletAddress);
  if (balance < config.gasAmount) {
    throw new Error("Insufficient TON balance for refund gas");
  }
  const seqno = await walletContract.getSeqno();

  const destination = Address.parse(params.toAddress);
  const amount = BigInt(params.jettonAmount);

  const body = buildJettonTransferBody(
    destination,
    config.walletAddress,
    amount,
    params.comment,
  );

  const message = internal({
    to: config.jettonWalletAddress,
    value: config.gasAmount,
    bounce: true,
    body,
  });

  await walletContract.sendTransfer({
    seqno,
    secretKey: config.secretKey,
    messages: [message],
    sendMode: SendMode.PAY_GAS_SEPARATELY,
  });

  const txHash = `seqno:${seqno}`;
  return { txHash };
}

export async function sendJettonTransferFromEscrow(params: {
  toAddress: string;
  jettonAmount: string;
  comment?: string;
  escrowSecretKey: string;
  escrowAddress: string;
}): Promise<{ txHash: string }> {
  const toncenterConfig = getToncenterSharedConfig();
  const tonConfig = getTonConfigFromEnv();
  const secretKey = parseSecretKey(params.escrowSecretKey);
  const keyPair =
    secretKey.length === 32 ? keyPairFromSeed(secretKey) : keyPairFromSecretKey(secretKey);
  const wallet = WalletContractV5R1.create({
    workchain: 0,
    publicKey: keyPair.publicKey,
  });
  const derived = normalizeTonAddress(wallet.address.toString({ bounceable: false }));
  const expected = normalizeTonAddress(params.escrowAddress);
  if (derived !== expected) {
    throw new Error("Escrow secret key does not match escrow address");
  }

  const jettonWalletAddress = await getJettonWalletAddress(
    params.escrowAddress,
    tonConfig.usdtJettonMaster,
    tonConfig.apiKey,
  );
  if (!jettonWalletAddress) {
    throw new Error("Jetton wallet address not found for escrow");
  }

  const client = new TonClient({ endpoint: toncenterConfig.endpoint, apiKey: toncenterConfig.apiKey });
  const walletContract = client.open(wallet);
  const balance = await client.getBalance(wallet.address);
  if (balance < toncenterConfig.gasAmount) {
    throw new Error("Insufficient TON balance for escrow gas");
  }
  const seqno = await walletContract.getSeqno();

  const destination = Address.parse(params.toAddress);
  const amount = BigInt(params.jettonAmount);

  const body = buildJettonTransferBody(
    destination,
    wallet.address,
    amount,
    params.comment,
  );

  const message = internal({
    to: Address.parse(jettonWalletAddress),
    value: toncenterConfig.gasAmount,
    bounce: true,
    body,
  });

  await walletContract.sendTransfer({
    seqno,
    secretKey: keyPair.secretKey,
    messages: [message],
    sendMode: SendMode.PAY_GAS_SEPARATELY,
  });

  const txHash = `seqno:${seqno}`;
  return { txHash };
}

export async function sendTonFromEscrow(params: {
  toAddress: string;
  escrowSecretKey: string;
  escrowAddress: string;
  amountNano?: string;
  afterSeqno?: number | null;
}): Promise<{ txHash: string; amountNano: string } | null> {
  const toncenterConfig = getToncenterSharedConfig();
  const secretKey = parseSecretKey(params.escrowSecretKey);
  const keyPair =
    secretKey.length === 32 ? keyPairFromSeed(secretKey) : keyPairFromSecretKey(secretKey);
  const wallet = WalletContractV5R1.create({
    workchain: 0,
    publicKey: keyPair.publicKey,
  });
  const derived = normalizeTonAddress(wallet.address.toString({ bounceable: false }));
  const expected = normalizeTonAddress(params.escrowAddress);
  if (derived !== expected) {
    throw new Error("Escrow secret key does not match escrow address");
  }

  const client = new TonClient({ endpoint: toncenterConfig.endpoint, apiKey: toncenterConfig.apiKey });
  const walletContract = client.open(wallet);
  const balance = await client.getBalance(wallet.address);
  const gasAmount = toncenterConfig.gasAmount;
  const minRemaining = getEscrowTonMinRemainingNano();
  const maxAvailable = balance - gasAmount - minRemaining;
  const desiredAmount = params.amountNano ? BigInt(params.amountNano) : maxAvailable;
  if (desiredAmount <= 0n) {
    return null;
  }
  const amount = desiredAmount > maxAvailable ? maxAvailable : desiredAmount;
  if (amount <= 0n) {
    return null;
  }

  if (typeof params.afterSeqno === "number") {
    const maxTries = 20;
    const delayMs = 500;
    for (let i = 0; i < maxTries; i += 1) {
      const current = await walletContract.getSeqno();
      if (current > params.afterSeqno) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  const seqno = await walletContract.getSeqno();
  const message = internal({
    to: Address.parse(params.toAddress),
    value: amount,
    bounce: false,
  });

  await walletContract.sendTransfer({
    seqno,
    secretKey: keyPair.secretKey,
    messages: [message],
    sendMode: SendMode.PAY_GAS_SEPARATELY,
  });

  return { txHash: `seqno:${seqno}`, amountNano: amount.toString() };
}
