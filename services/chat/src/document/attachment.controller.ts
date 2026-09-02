import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { memoryStorage } from "multer";
import {
  type AuthenticatedRequest,
  JwtAuthGuard,
} from "../auth/jwt-auth.guard";
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  DocumentService,
  MAX_ATTACHMENT_SIZE,
  type UploadedDocumentFile,
} from "./document.service";

function currentUserId(request: AuthenticatedRequest): string {
  if (!request.user) {
    throw new BadRequestException("Authenticated user is unavailable");
  }

  return request.user.userId;
}

/**
 * 对话附件只落盘、不入 documents 表：上传后拿到引用（id/url），
 * 随聊天消息一起提交并写入消息 metadata，回读时按归属目录校验。
 */
@UseGuards(JwtAuthGuard)
@Controller("api/attachments")
export class AttachmentController {
  constructor(private readonly documentService: DocumentService) {}

  @Post("upload")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: MAX_ATTACHMENT_SIZE },
      fileFilter: (_request, file, callback) => {
        if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(file.mimetype)) {
          callback(
            new UnsupportedMediaTypeException(
              `Unsupported attachment type: ${file.mimetype}`,
            ),
            false,
          );
          return;
        }

        callback(null, true);
      },
    }),
  )
  upload(
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file: UploadedDocumentFile | undefined,
    @Body("filename") filename?: string,
  ) {
    if (!file) {
      throw new BadRequestException("file is required");
    }
    if (filename !== undefined && typeof filename !== "string") {
      throw new BadRequestException("filename must be a string");
    }

    return this.documentService.uploadAttachment(
      currentUserId(request),
      file,
      filename?.trim() || file.originalname,
    );
  }

  @Get(":id/raw")
  async raw(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
    @Param("id") attachmentId: string,
  ): Promise<StreamableFile> {
    const attachment = await this.documentService.getAttachment(
      currentUserId(request),
      attachmentId,
    );
    const encodedFilename = encodeURIComponent(attachment.filename).replace(
      /['()]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );

    response.set({
      "Cache-Control": "private, no-store",
      "Content-Disposition": `inline; filename*=UTF-8''${encodedFilename}`,
      "Content-Length": String(attachment.buffer.length),
      "Content-Type": attachment.mimeType,
      "X-Content-Type-Options": "nosniff",
    });

    return new StreamableFile(attachment.buffer);
  }
}
