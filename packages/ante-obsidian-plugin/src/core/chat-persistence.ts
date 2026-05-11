import type { ChatPersistenceState } from "./chat-types";

export interface ChatStatePersistence {
  saveChatState(chatState: ChatPersistenceState): Promise<void>;
}
