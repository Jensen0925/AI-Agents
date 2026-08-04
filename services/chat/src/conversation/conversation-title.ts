/** 新建会话在还没有用户消息时使用的占位标题。 */
export const DEFAULT_CONVERSATION_TITLE = "新会话";

/** 侧边栏标题的最大显示长度，避免长需求挤压会话列表布局。 */
export const MAX_CONVERSATION_TITLE_LENGTH = 28;

/**
 * 根据用户首条消息生成可读的会话标题。
 *
 * 标题只保留一行，并按 Unicode 码点截断，避免中文、emoji 被截成乱码。
 */
export function createConversationTitle(input: string): string {
  const normalized = input.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return DEFAULT_CONVERSATION_TITLE;
  }

  const characters = Array.from(normalized);
  if (characters.length <= MAX_CONVERSATION_TITLE_LENGTH) {
    return normalized;
  }

  return `${characters
    .slice(0, MAX_CONVERSATION_TITLE_LENGTH - 1)
    .join("")}…`;
}
