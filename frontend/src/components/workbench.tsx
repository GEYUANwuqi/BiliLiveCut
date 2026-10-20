import { statusLabels } from "@/lib/status";
import { useId, useState, type ReactNode, type FormEvent } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  Inbox,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useDraft } from "@/lib/drafts";
import { cn } from "@/lib/utils";
import { text } from "@/lib/data";
import type { Row } from "@/api/client";

export function Page({
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="page-enter space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h1 className="text-2xl font-semibold tracking-tight md:text-[30px]">
            {title}
          </h1>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </header>
      {children}
    </section>
  );
}

export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-60 flex-col items-center justify-center rounded-2xl border border-dashed bg-card/60 px-6 py-12 text-center">
      <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-muted text-muted-foreground">
        <Inbox className="size-6" />
      </div>
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-2 mb-5 max-w-md text-sm leading-6 text-muted-foreground">
        {description}
      </p>
      {action}
    </div>
  );
}

export function QueryState<T>({
  query,
  children,
}: {
  query: UseQueryResult<T>;
  children: ReactNode;
}) {
  if (query.isPending)
    return (
      <div role="status" aria-label="正在加载" className="space-y-4">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-44 rounded-2xl" />
          <Skeleton className="h-44 rounded-2xl" />
        </div>
      </div>
    );
  if (query.isError && query.data === undefined)
    return (
      <div role="alert" className="error-panel">
        <AlertCircle className="size-5 shrink-0" />
        <div className="flex-1">
          <p className="font-medium">读取失败</p>
          <p className="mt-1 text-sm">{query.error.message}</p>
        </div>
        <Button variant="outline" onClick={() => void query.refetch()}>
          重试
        </Button>
      </div>
    );
  return (
    <>
      {query.isError && (
        <div role="alert" className="error-panel">
          <AlertCircle className="size-4" />
          更新失败，正在显示上次成功的数据。{query.error.message}
        </div>
      )}
      {children}
    </>
  );
}

export function Status({ value }: { value: unknown }) {
  const status = text(value, "unknown");
  const danger = /error|failed|unavailable|rejected|interrupted/.test(status);
  const active =
    /recording|running|processing|uploading|starting|reconnecting|collecting|transcribing|analyzing|rendering|publishing/.test(
      status,
    );
  const good =
    /^(succeeded|completed|done|approved|published|available|success)$/.test(
      status,
    );
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 font-normal",
        danger &&
          "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
        active &&
          "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300",
        good &&
          "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full bg-current",
          active && "animate-pulse",
        )}
      />
      {statusLabels[status] || status}
    </Badge>
  );
}

export function Stat({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <Card className="gap-0 border-border/70 py-0 shadow-none">
      <CardContent className="p-5">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{label}</span>
          {icon}
        </div>
        <div className="mt-4 text-[30px] leading-none font-semibold tracking-tight tabular-nums">
          {value}
        </div>
        {hint && <p className="mt-3 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export function Refresh({
  refresh,
  busy,
}: {
  refresh: () => unknown;
  busy?: boolean;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => void refresh()}
      disabled={busy}
    >
      <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
      刷新
    </Button>
  );
}

export function ConfirmButton({
  children,
  title,
  description,
  confirm = "确认操作",
  onConfirm,
  destructive = false,
  disabled = false,
}: {
  children: ReactNode;
  title: string;
  description: string;
  confirm?: string;
  onConfirm: () => Promise<unknown>;
  destructive?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) {
          setOpen(next);
          setError("");
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          variant={destructive ? "destructive" : "outline"}
          size="sm"
          disabled={disabled}
        >
          {children}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(event) => {
              event.preventDefault();
              setBusy(true);
              void onConfirm()
                .then(() => setOpen(false))
                .catch((reason: Error) => setError(reason.message))
                .finally(() => setBusy(false));
            }}
            className={
              destructive
                ? "bg-destructive text-white hover:bg-destructive/90"
                : ""
            }
          >
            {busy && <LoaderCircle className="size-4 animate-spin" />}
            {confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export interface FieldSpec {
  name: string;
  label: string;
  type?:
    | "text"
    | "password"
    | "number"
    | "textarea"
    | "json"
    | "boolean"
    | "datetime-local"
    | "lines";
  required?: boolean;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  description?: string;
  options?: { label: string; value: string | number }[];
}

export function FormField({
  field,
  value,
  onChange,
  disabled,
}: {
  field: FieldSpec;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}) {
  const inputDisabled = disabled || field.disabled;
  const unique = useId();
  const id = `field-${field.name}-${unique}`;
  return (
    <div
      className={cn(
        "space-y-2",
        field.type === "boolean" &&
          "flex items-center justify-between gap-4 rounded-xl border p-3",
      )}
    >
      <div className="space-y-1">
        <Label htmlFor={id}>
          {field.label}
          {field.required && <span className="text-destructive"> *</span>}
        </Label>
        {field.description && (
          <p
            id={`${id}-help`}
            className="text-xs leading-5 text-muted-foreground"
          >
            {field.description}
          </p>
        )}
      </div>
      {field.type === "boolean" ? (
        <Switch
          id={id}
          checked={!!value}
          onCheckedChange={onChange}
          disabled={inputDisabled}
        />
      ) : field.options ? (
        <select
          id={id}
          className="native-select"
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value)}
          disabled={inputDisabled}
          required={field.required}
        >
          <option value="" disabled>
            请选择
          </option>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : ["textarea", "json", "lines"].includes(field.type || "") ? (
        <Textarea
          id={id}
          value={
            typeof value === "object"
              ? field.type === "lines" && Array.isArray(value)
                ? value.join("\n")
                : JSON.stringify(value, null, 2)
              : String(value ?? "")
          }
          onChange={(e) => onChange(e.target.value)}
          rows={field.type === "json" ? 6 : 3}
          disabled={inputDisabled}
          required={field.required}
          placeholder={field.placeholder}
          className={field.type === "json" ? "font-mono text-xs" : ""}
        />
      ) : (
        <Input
          id={id}
          type={field.type || "text"}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
          min={field.min}
          max={field.max}
          step={field.step ?? (field.type === "number" ? "any" : undefined)}
          placeholder={field.placeholder}
          disabled={inputDisabled}
          autoComplete={field.type === "password" ? "new-password" : undefined}
          aria-describedby={field.description ? `${id}-help` : undefined}
        />
      )}
    </div>
  );
}

export function serializeFields(value: Row, fields: FieldSpec[]) {
  const output: Row = {};
  for (const field of fields) {
    if (field.disabled) continue;
    const item = value[field.name];
    if (field.type === "number") {
      if (
        (item === "" || item === null || item === undefined) &&
        !field.required
      )
        continue;
      const numeric = Number(item);
      if (!Number.isFinite(numeric))
        throw new Error(`${field.label}必须是有效数字`);
      output[field.name] = numeric;
    } else if (field.type === "json") {
      try {
        output[field.name] =
          typeof item === "string" ? JSON.parse(item || "{}") : (item ?? {});
      } catch {
        throw new Error(`${field.label}不是有效的 JSON`);
      }
    } else if (field.type === "lines")
      output[field.name] = Array.isArray(item)
        ? item
        : String(item || "")
            .split("\n")
            .map((entry) => entry.trim())
            .filter(Boolean);
    else if (field.type === "boolean") output[field.name] = !!item;
    else if (item !== undefined && item !== null) output[field.name] = item;
  }
  return output;
}

export function FormDialog({
  id,
  title,
  description = "修改内容会作为草稿保留，确认后提交。",
  trigger,
  fields,
  initial = {},
  onSubmit,
  submit = "保存修改",
  onSaved,
}: {
  id: string;
  title: string;
  description?: string;
  trigger: ReactNode;
  fields: FieldSpec[];
  initial?: Row;
  onSubmit: (value: Row) => Promise<unknown>;
  submit?: string;
  onSaved?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const draft = useDraft<Row>(id, initial);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit(serializeFields(draft.value, fields));
      draft.reset();
      toast.success(submit === "保存修改" ? "修改已保存" : "请求已提交");
      setOpen(false);
      onSaved?.();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "操作失败，草稿已保留",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) setOpen(next);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void save(event)} className="space-y-5">
          <fieldset disabled={busy} className="space-y-4">
            {fields.map((field) => (
              <FormField
                key={field.name}
                field={field}
                value={draft.value[field.name]}
                onChange={(next) =>
                  draft.update({ ...draft.value, [field.name]: next })
                }
              />
            ))}
          </fieldset>
          {error && (
            <div role="alert" className="error-panel text-sm">
              {error}；未保存的草稿已保留。
            </div>
          )}
          <div className="flex items-center justify-between gap-3 border-t pt-4">
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                draft.reset();
                setError("");
              }}
            >
              放弃修改
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              {submit}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DetailList({
  values,
}: {
  values: { label: string; value: ReactNode }[];
}) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {values.map(({ label, value }) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="mt-1 break-words text-sm">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  if (!/^https?:\/\//.test(href)) return null;
  return (
    <a
      className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {children}
      <ArrowUpRight className="size-3" />
    </a>
  );
}
