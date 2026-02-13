type TelegramApiResponse<T> =
  | { ok: true; result: T }
  | { ok: false; description: string; parameters?: { retry_after?: number } };

type TelegramUser = { id: number; is_bot: boolean; username?: string };

type TelegramChat = {
  id: number;
  type: "channel" | "supergroup" | "group" | "private";
  title?: string;
  username?: string;
};

type ChatMember = {
  status: "creator" | "administrator" | "member" | "restricted" | "left" | "kicked";
  can_post_messages?: boolean;
};

type TelegramMessage = {
  message_id: number;
  date: number;
  chat: TelegramChat;
  text?: string;
};

let cachedBotUser: TelegramUser | null = null;

async function telegramApi<T>(
  botToken: string,
  method: string,
  params: Record<string, string | number>,
): Promise<T> {
  const url = new URL(`https://api.telegram.org/bot${botToken}/${method}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));

  const response = await fetch(url.toString());
  const data = (await response.json()) as TelegramApiResponse<T>;

  if (!data.ok) {
    const retryAfter = data.parameters?.retry_after;
    const hint = retryAfter ? ` Retry after ${retryAfter}s.` : "";
    throw new Error(`${data.description}.${hint}`);
  }

  return data.result;
}

export async function getBotUser(botToken: string): Promise<TelegramUser> {
  if (!cachedBotUser) {
    cachedBotUser = await telegramApi<TelegramUser>(botToken, "getMe", {});
  }
  return cachedBotUser;
}

export async function getChat(botToken: string, chatId: string): Promise<TelegramChat> {
  return telegramApi<TelegramChat>(botToken, "getChat", { chat_id: chatId });
}

export async function getChatMember(
  botToken: string,
  chatId: string,
  userId: number,
): Promise<ChatMember> {
  return telegramApi<ChatMember>(botToken, "getChatMember", {
    chat_id: chatId,
    user_id: userId,
  });
}

export async function getChatMemberCount(
  botToken: string,
  chatId: string,
): Promise<number> {
  return telegramApi<number>(botToken, "getChatMemberCount", {
    chat_id: chatId,
  });
}

export async function sendMessage(
  botToken: string,
  chatId: string,
  text: string,
): Promise<TelegramMessage> {
  return telegramApi<TelegramMessage>(botToken, "sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: 1,
  });
}

export async function copyMessage(
  botToken: string,
  fromChatId: string,
  messageId: number,
  toChatId: string,
): Promise<{ message_id: number }> {
  return telegramApi<{ message_id: number }>(botToken, "copyMessage", {
    chat_id: toChatId,
    from_chat_id: fromChatId,
    message_id: messageId,
  });
}

export async function deleteMessage(
  botToken: string,
  chatId: string,
  messageId: number,
): Promise<boolean> {
  return telegramApi<boolean>(botToken, "deleteMessage", {
    chat_id: chatId,
    message_id: messageId,
  });
}
