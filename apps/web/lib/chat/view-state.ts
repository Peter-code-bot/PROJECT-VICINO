import type { OperationCursor } from "./operations";
type ChatViewState = { draft: string; expanded: string[]; scrollTop: number; historyOpen: boolean; history: { ids: string[]; cursor: OperationCursor | null } };
// Memory only, partitioned by authenticated account and chat. Never persist drafts to disk.
const states = new Map<string, ChatViewState>();
export function readChatViewState(account: string, chat: string) { return states.get(`${account}:${chat}`); }
export function saveChatViewState(account: string, chat: string, state: ChatViewState) {
  if (typeof window === "undefined") return;
  const key = `${account}:${chat}`;
  states.delete(key);
  states.set(key, state);
  if (states.size > 20) states.delete(states.keys().next().value!);
}
