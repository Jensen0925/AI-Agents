"use client";

import type { TableCell, TableUIResponse } from "@/types/ui-types";

interface DataTableProps {
  component: TableUIResponse;
}

function displayCell(value: TableCell): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  return String(value);
}

/** 以可横向滚动的紧凑表格展示结构化结果。 */
export function DataTable({ component }: DataTableProps) {
  return (
    <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#16161f] shadow-[0_12px_34px_rgba(0,0,0,0.16)]">
      {component.title && <h3 className="px-4 pt-4 text-sm font-semibold text-[#e5e5e5]">{component.title}</h3>}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse text-left text-xs">
          <thead className="bg-[#111118] text-[#888894]">
            <tr>
              {component.columns.map((column) => (
                <th key={column.key} scope="col" className="whitespace-nowrap border-b border-white/[0.08] px-4 py-2.5 font-medium">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.06]">
            {component.rows.length === 0 ? (
              <tr>
                <td colSpan={component.columns.length} className="px-4 py-8 text-center text-[#666672]">暂无数据</td>
              </tr>
            ) : (
              component.rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`} className="transition-colors hover:bg-white/[0.03]">
                  {component.columns.map((column) => (
                    <td key={column.key} className="max-w-[280px] break-words px-4 py-3 text-[#d7d7df]">
                      {displayCell(row[column.key])}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
