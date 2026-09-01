import { api } from "./api";

/** 后端 categories 表里的用户自建分类。内置分类不通过接口返回。 */
export type UserCategory = {
  id: string;
  name: string;
  createdAt: string;
};

/** 删除分类时，后端会把仍在使用它的文档回落到内置分类，并返回受影响数量。 */
export type DeleteCategoryResult = {
  reassigned: number;
};

export const MAX_CATEGORY_NAME_LENGTH = 30;

export async function listCategories(): Promise<UserCategory[]> {
  const { data } = await api.get<UserCategory[]>("/categories");
  return data;
}

export async function createCategory(name: string): Promise<UserCategory> {
  const { data } = await api.post<UserCategory>("/categories", { name });
  return data;
}

export async function deleteCategory(id: string): Promise<DeleteCategoryResult> {
  const { data } = await api.delete<DeleteCategoryResult>(`/categories/${id}`);
  return data;
}
