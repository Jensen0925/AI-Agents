/**
 * 纯 TypeScript 向量相似度工具。
 *
 * 这些函数用于演示 RAG 中常见的距离计算，不依赖 numpy、pgvector 或
 * 其他运行时库。所有返回值均为普通 number/number[]，便于测试和阅读。
 */

function assertSameDimension(a: number[], b: number[]): void {
  if (a.length !== b.length) {
    throw new RangeError("向量维度不匹配");
  }
}

/** 计算两个向量的点积。 */
export function dot(a: number[], b: number[]): number {
  assertSameDimension(a, b);
  let result = 0;
  for (let index = 0; index < a.length; index += 1) {
    result += a[index] * b[index];
  }
  return result;
}

/** 计算向量的 L2 范数。 */
export function l2Norm(v: number[]): number {
  let squaredSum = 0;
  for (const value of v) {
    squaredSum += value * value;
  }
  return Math.sqrt(squaredSum);
}

/** 返回一个新的 L2 归一化向量，不修改输入数组。 */
export function normalize(v: number[]): number[] {
  const norm = l2Norm(v);
  if (norm === 0) {
    return v.map(() => 0);
  }
  return v.map((value) => value / norm);
}

/** 计算余弦相似度；零向量与任何向量的相似度定义为 0。 */
export function cosineSimilarity(a: number[], b: number[]): number {
  assertSameDimension(a, b);
  const denominator = l2Norm(a) * l2Norm(b);
  if (denominator === 0) {
    return 0;
  }
  return dot(a, b) / denominator;
}

/** 计算两个向量之间的欧氏距离。 */
export function euclideanDistance(a: number[], b: number[]): number {
  assertSameDimension(a, b);
  let squaredDistance = 0;
  for (let index = 0; index < a.length; index += 1) {
    const difference = a[index] - b[index];
    squaredDistance += difference * difference;
  }
  return Math.sqrt(squaredDistance);
}
