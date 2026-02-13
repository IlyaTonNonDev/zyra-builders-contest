import crypto from "crypto";

export type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

export type InitData = {
  user: TelegramUser;
};

function parseInitData(initData: string): Map<string, string> {
  const params = new URLSearchParams(initData);
  const map = new Map<string, string>();
  for (const [key, value] of params.entries()) {
    map.set(key, value);
  }
  return map;
}

export function validateInitData(initData: string, botToken: string): InitData {
  const dataMap = parseInitData(initData);
  const providedHash = dataMap.get("hash");
  if (!providedHash) {
    throw new Error("Missing hash in initData");
  }

  dataMap.delete("hash");

  const dataCheckString = Array.from(dataMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  const computedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (computedHash !== providedHash) {
    throw new Error("Invalid initData hash");
  }

  const userRaw = dataMap.get("user");
  if (!userRaw) {
    throw new Error("Missing user in initData");
  }

  const user = JSON.parse(userRaw) as TelegramUser;
  if (!user?.id) {
    throw new Error("Invalid user in initData");
  }

  return { user };
}
