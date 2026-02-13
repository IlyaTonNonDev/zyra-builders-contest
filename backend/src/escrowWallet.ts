import crypto from "crypto";
import { mnemonicNew, mnemonicToPrivateKey } from "@ton/crypto";
import { WalletContractV5R1 } from "@ton/ton";

const parseEncryptionKey = (): Buffer => {
  const raw = String(process.env.ESCROW_ENCRYPTION_KEY ?? "").trim();
  if (!raw) {
    throw new Error("ESCROW_ENCRYPTION_KEY is not set");
  }
  const isHex = /^[0-9a-fA-F]+$/.test(raw);
  const key = Buffer.from(raw, isHex ? "hex" : "base64");
  if (key.length !== 32) {
    throw new Error("ESCROW_ENCRYPTION_KEY must be 32 bytes (hex or base64)");
  }
  return key;
};

export const encryptSecret = (plaintext: string): string => {
  const key = parseEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
};

export const decryptSecret = (payload: string): string => {
  const [ivBase64, tagBase64, dataBase64] = payload.split(":");
  if (!ivBase64 || !tagBase64 || !dataBase64) {
    throw new Error("Invalid encrypted payload format");
  }
  const key = parseEncryptionKey();
  const iv = Buffer.from(ivBase64, "base64");
  const tag = Buffer.from(tagBase64, "base64");
  const data = Buffer.from(dataBase64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
};

export async function generateEscrowWallet(): Promise<{
  address: string;
  addressRaw: string;
  secretKeyEncrypted: string;
}> {
  const mnemonic = await mnemonicNew(24);
  const keyPair = await mnemonicToPrivateKey(mnemonic);
  const wallet = WalletContractV5R1.create({
    workchain: 0,
    publicKey: keyPair.publicKey,
  });
  const secretKeyBase64 = Buffer.from(keyPair.secretKey).toString("base64");
  return {
    address: wallet.address.toString({ bounceable: false }),
    addressRaw: wallet.address.toRawString(),
    secretKeyEncrypted: encryptSecret(secretKeyBase64),
  };
}
