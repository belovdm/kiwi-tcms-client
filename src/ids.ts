/** Достаёт id из результата filter: [{id:..}] или [..id..]. */
export function firstId(rows: unknown[] | undefined): number | undefined {
  const first = rows?.[0] as { id?: unknown } | number | undefined;
  if (first === undefined || first === null) return undefined;
  if (typeof first === "number") return first;
  return extractId((first as { id?: unknown }).id);
}

/** Унифицированно извлекает числовой id из разных форматов сериализации Kiwi. */
export function extractId(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\d+$/.test(v)) return parseInt(v, 10);
  if (v && typeof v === "object") {
    const o = v as { id?: unknown; pk?: unknown };
    if (o.id !== undefined) return extractId(o.id);
    if (o.pk !== undefined) return extractId(o.pk);
  }
  return undefined;
}

/** Имя связанного объекта из разных форматов сериализации (id, "NAME", {name}). */
export function extractName(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const o = v as { name?: unknown; value?: unknown };
    if (typeof o.name === "string") return o.name;
    if (typeof o.value === "string") return o.value;
  }
  return undefined;
}
