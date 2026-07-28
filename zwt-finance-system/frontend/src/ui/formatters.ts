export function formatFinanceAmount(
  value: string | number | null | undefined,
  currency = "",
): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  const formatted = new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric);
  return currency ? `${currency} ${formatted}` : formatted;
}

export function formatFinanceDateTime(
  value: string | null | undefined,
): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
}
