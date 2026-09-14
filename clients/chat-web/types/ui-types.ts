/**
 * UI 协议的声明集中在 @cloudsage/contracts/ui-protocol，前端与服务端共用同一份，
 * 因此前端不再手抄字段。本模块只做转发，保持 `@/types/ui-types` 导入路径稳定。
 */
export type * from "@cloudsage/contracts/ui-protocol";
