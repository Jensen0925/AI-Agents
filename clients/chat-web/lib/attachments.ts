import { api } from "./api";
import type { Attachment } from "./knowledge-data";

/** 单条消息允许携带的附件数量上限，需与后端 MAX_CHAT_ATTACHMENTS 保持一致。 */
export const MAX_CHAT_ATTACHMENTS = 10;

/** 单个附件大小上限：10 MB，需与后端 MAX_ATTACHMENT_SIZE 保持一致。 */
export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

/**
 * 上传对话附件。附件只落盘、不进 documents 表，因此不会进入检索语料，
 * 仅作为消息引用与原文预览地址。
 */
export async function uploadAttachment(file: File): Promise<Attachment> {
  if (file.size > MAX_ATTACHMENT_SIZE) {
    throw new Error("附件超过 10 MB 上限");
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("filename", file.name);
  const { data } = await api.post<Attachment>("/attachments/upload", formData, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 60_000,
  });
  return data;
}

/**
 * 附件原文接口受 JWT 保护，直接跳链接不会带上 Authorization 头，
 * 因此先用带鉴权的请求取回二进制，再在本地用 blob URL 打开/下载。
 */
export async function openAttachment(attachment: Attachment): Promise<void> {
  const { data } = await api.get<Blob>(attachment.url, {
    responseType: "blob",
    timeout: 60_000,
  })
  const objectUrl = URL.createObjectURL(data)
  // 先同步开标签页再赋值，否则异步等待结束后会被浏览器当作弹窗拦截。
  const previewWindow = window.open("", "_blank")
  if (previewWindow) {
    previewWindow.location.href = objectUrl
  } else {
    const link = document.createElement("a")
    link.href = objectUrl
    link.download = attachment.filename
    link.rel = "noopener"
    document.body.append(link)
    link.click()
    link.remove()
  }
  // 立即 revoke 会让部分浏览器中断加载，留足缓冲后再释放。
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
}
