"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { FormField, FormUIResponse, UIAction } from "@/types/ui-types";

interface DynamicFormProps {
  component: FormUIResponse;
  onAction: (action: UIAction) => void;
}

type FormValues = Record<string, string | number | boolean | null>;

function initialValues(fields: FormField[]): FormValues {
  return fields.reduce<FormValues>((values, field) => {
    if (field.defaultValue !== undefined) values[field.name] = field.defaultValue;
    else values[field.name] = field.type === "number" ? "" : "";
    return values;
  }, {});
}

/** 根据服务端字段定义生成轻量动态表单。 */
export function DynamicForm({ component, onAction }: DynamicFormProps) {
  const defaults = useMemo(() => initialValues(component.fields), [component.fields]);
  const [values, setValues] = useState<FormValues>(defaults);

  function updateValue(field: FormField, value: string) {
    setValues((current) => ({
      ...current,
      [field.name]: field.type === "number" && value !== "" ? Number(value) : value,
    }));
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onAction({
      type: "form_submit",
      componentId: component.id,
      values,
    });
  }

  function cancel() {
    onAction({
      type: "button",
      componentId: component.id,
      action: "cancel",
    });
  }

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-[#16161f] p-4 shadow-[0_12px_34px_rgba(0,0,0,0.16)]">
      <div>
        <h3 className="text-sm font-semibold text-[#e5e5e5]">{component.title}</h3>
        {component.description && (
          <p className="mt-1.5 text-xs leading-5 text-[#888894]">{component.description}</p>
        )}
      </div>

      <form className="mt-4 space-y-3.5" onSubmit={submit}>
        {component.fields.map((field) => (
          <label key={field.name} className="block">
            <span className="mb-1.5 block text-xs font-medium text-[#d7d7df]">
              {field.label}
              {field.required && <span className="ml-1 text-blue-300">*</span>}
            </span>
            {field.type === "textarea" ? (
              <Textarea
                required={field.required}
                value={String(values[field.name] ?? "")}
                placeholder={field.placeholder}
                onChange={(event) => updateValue(field, event.target.value)}
                className="min-h-24 resize-y border-white/[0.1] bg-[#111118] text-[#e5e5e5] placeholder:text-[#666672] focus-visible:ring-blue-400/30"
              />
            ) : field.type === "select" ? (
              <select
                required={field.required}
                value={String(values[field.name] ?? "")}
                onChange={(event) => updateValue(field, event.target.value)}
                className="flex h-10 w-full rounded-md border border-white/[0.1] bg-[#111118] px-3 py-2 text-sm text-[#e5e5e5] outline-none transition-colors focus:border-blue-400/60 focus:ring-2 focus:ring-blue-400/20"
              >
                <option value="">请选择</option>
                {field.options?.map((option) => (
                  <option key={option.value} value={option.value} disabled={option.disabled}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                type={field.type === "input" ? "text" : field.type}
                required={field.required}
                value={String(values[field.name] ?? "")}
                placeholder={field.placeholder}
                onChange={(event) => updateValue(field, event.target.value)}
                className="border-white/[0.1] bg-[#111118] text-[#e5e5e5] placeholder:text-[#666672] focus:border-blue-400/60 focus:ring-blue-400/20"
              />
            )}
          </label>
        ))}

        <div className="flex items-center justify-end gap-2 pt-1">
          {component.cancelLabel && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={cancel}
              className="text-xs text-[#9ca3af] hover:bg-white/[0.08] hover:text-white"
            >
              {component.cancelLabel}
            </Button>
          )}
          <Button type="submit" size="sm" className="bg-[#1e40af] text-xs text-white shadow-none hover:bg-[#1d4ed8]">
            {component.submitLabel ?? "提交"}
          </Button>
        </div>
      </form>
    </section>
  );
}
