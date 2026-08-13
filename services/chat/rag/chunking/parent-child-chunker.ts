import {
  chunkText,
  type Chunk,
  type ChunkTextOptions,
} from "./document-chunker";

export interface ParentChunk extends Chunk {}

export interface ChildChunk extends Chunk {
  /** 当前子块所属的父块索引。 */
  parentIndex: number;
}

export interface ParentChildChunks {
  parents: ParentChunk[];
  children: ChildChunk[];
}

/**
 * Parent-Child 切分：父块适合检索时保留较完整的上下文，子块适合向量化与精细命中。
 * 所有 offset 均是相对于原始文档的绝对字符偏移。
 */
export async function chunkParentChild(
  text: string,
  parentSize: number,
  childSize: number,
): Promise<ParentChildChunks> {
  const noOverlap: ChunkTextOptions = { chunkOverlap: 0 };
  const parents = await chunkText(text, { ...noOverlap, chunkSize: parentSize });
  const children: ChildChunk[] = [];

  for (const parent of parents) {
    const localChildren = await chunkText(parent.content, {
      ...noOverlap,
      chunkSize: childSize,
    });

    for (const child of localChildren) {
      children.push({
        ...child,
        index: children.length,
        parentIndex: parent.index,
        startOffset: parent.startOffset + child.startOffset,
        endOffset: parent.startOffset + child.endOffset,
      });
    }
  }

  return { parents, children };
}
