import { z } from "zod";

type Json = Record<string, unknown>;

/** Keywords strict tool use (structured outputs) does not accept – zod still checks them on our side. */
const DROP = new Set(["$schema", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "pattern", "format", "minItems", "maxItems", "uniqueItems", "default", "examples", "propertyNames", "minProperties", "maxProperties"]);

function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean);
  if (!node || typeof node !== "object") return node;
  const out: Json = {};
  for (const [k, v] of Object.entries(node as Json)) {
    if (DROP.has(k)) continue;
    if (k === "properties" && v && typeof v === "object") {
      const props: Json = {};
      for (const [pk, pv] of Object.entries(v as Json)) props[pk] = clean(pv);
      out[k] = props;
    } else out[k] = clean(v);
  }
  if (out.type === "object" || "properties" in out) {
    out.type = "object";
    out.properties ??= {};
    out.additionalProperties = false;
    out.required ??= [];
  }
  return out;
}

/** JSON schema for a tool input: zod v4 → JSON schema, input view (defaults optional), strict-ready. */
export function toolJsonSchema(schema: z.ZodType): Json {
  const raw = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
  return clean(raw) as Json;
}

/** Complexity of a schema for the strict-tool limits: optional parameters and parameters with union types. */
export function schemaComplexity(schema: Json): { optional: number; unions: number } {
  let optional = 0;
  let unions = 0;
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(walk);
    const n = node as Json;
    if (n.properties && typeof n.properties === "object") {
      const required = new Set((n.required as string[] | undefined) ?? []);
      for (const [k, v] of Object.entries(n.properties as Json)) {
        if (!required.has(k)) optional++;
        const p = v as Json;
        if (Array.isArray(p.anyOf) || Array.isArray(p.oneOf) || Array.isArray(p.type)) unions++;
        walk(v);
      }
    }
    if (n.items) walk(n.items);
    if (Array.isArray(n.anyOf)) n.anyOf.forEach(walk);
  };
  walk(schema);
  return { optional, unions };
}

/**
 * Limits for strict tools in one request (structured outputs). Tools beyond the budget are still sent, just without
 * `strict` – their input is validated with zod before anything runs, so nothing invalid ever reaches the data.
 * Besides the documented counts the API also rejects a compiled grammar that is too large, so the total schema size
 * is capped too (kept well below the point where it failed: ~7.5k chars over 20 tools).
 */
export const STRICT_LIMITS = { tools: 12, optional: 16, unions: 8, chars: 4000 };

/** Picks which tools get `strict: true`: write tools first (they change data), then the rest in the given order. */
export function pickStrict(tools: { name: string; kind: "read" | "write"; schema: Json }[]): Set<string> {
  const ordered = [...tools.filter((t) => t.kind === "write"), ...tools.filter((t) => t.kind !== "write")];
  const picked = new Set<string>();
  let optional = 0;
  let unions = 0;
  let chars = 0;
  for (const t of ordered) {
    if (picked.size >= STRICT_LIMITS.tools) break;
    const c = schemaComplexity(t.schema);
    const size = JSON.stringify(t.schema).length;
    if (optional + c.optional > STRICT_LIMITS.optional || unions + c.unions > STRICT_LIMITS.unions || chars + size > STRICT_LIMITS.chars) continue;
    optional += c.optional;
    unions += c.unions;
    chars += size;
    picked.add(t.name);
  }
  return picked;
}

/** Short German description of zod issues, for the model to correct its input. */
export function zodIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((i) => `${i.path.length ? i.path.join(".") : "(Eingabe)"}: ${i.message}`)
    .join("; ");
}
