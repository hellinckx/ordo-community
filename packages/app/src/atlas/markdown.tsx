import { Fragment, type ReactNode } from "react";
import { Link } from "react-router";
import { openExternal } from "@/components/LegalLinks";

/**
 * Light markdown for Atlas answers: paragraphs, headings, lists, **bold**, *italic*, `code`, links and tables.
 * Builds React nodes (never raw HTML), so nothing in an answer can inject markup.
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return <div className={className}>{blocks(text)}</div>;
}

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "h"; level: number; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "code"; text: string };

const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

function parse(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.trim().startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith("```")) body.push(lines[i++]!);
      i++;
      out.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      out.push({ kind: "h", level: h[1]!.length, text: h[2]! });
      i++;
      continue;
    }
    if (line.trim().startsWith("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1]!)) {
      const head = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) rows.push(splitRow(lines[i++]!));
      out.push({ kind: "table", head, rows });
      continue;
    }
    const ul = /^\s*[-*•]\s+(.*)$/;
    const ol = /^\s*\d+[.)]\s+(.*)$/;
    if (ul.test(line) || ol.test(line)) {
      const kind = ul.test(line) ? "ul" : "ol";
      const re = kind === "ul" ? ul : ol;
      const items: string[] = [];
      while (i < lines.length && (re.test(lines[i]!) || (items.length && /^\s{2,}\S/.test(lines[i]!)))) {
        const m = lines[i]!.match(re);
        if (m) items.push(m[1]!);
        else items[items.length - 1] += " " + lines[i]!.trim();
        i++;
      }
      out.push({ kind, items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,4})\s/.test(lines[i]!) && !ul.test(lines[i]!) && !ol.test(lines[i]!) && !lines[i]!.trim().startsWith("```") && !(lines[i]!.trim().startsWith("|") && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? ""))) para.push(lines[i++]!);
    out.push({ kind: "p", lines: para });
  }
  return out;
}

const numeric = (s: string) => /^[-+−]?\s?[\d.,\s]+\s?(€|%|Std\.?|h)?$/.test(s.trim()) && /\d/.test(s);

function blocks(text: string): ReactNode {
  return parse(text).map((b, i) => {
    switch (b.kind) {
      case "h":
        return (
          <p key={i} className={b.level <= 2 ? "mt-4 mb-1.5 text-[15px] font-semibold first:mt-0" : "mt-3 mb-1 font-semibold first:mt-0"}>
            {inline(b.text)}
          </p>
        );
      case "ul":
        return (
          <ul key={i} className="my-2 list-disc space-y-1 pl-5 marker:text-(--text-muted) first:mt-0 last:mb-0">
            {b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}
          </ul>
        );
      case "ol":
        return (
          <ol key={i} className="my-2 list-decimal space-y-1 pl-5 marker:text-(--text-muted) first:mt-0 last:mb-0">
            {b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}
          </ol>
        );
      case "code":
        return <pre key={i} className="my-2 overflow-x-auto rounded-xl bg-(--surface-2) px-3 py-2 font-mono text-[12.5px] first:mt-0 last:mb-0">{b.text}</pre>;
      case "table":
        return (
          <div key={i} className="my-3 overflow-x-auto rounded-xl border border-(--border) first:mt-0 last:mb-0">
            <table className="w-full text-[13px]">
              <thead className="bg-(--surface-2) text-(--text-muted)">
                <tr>{b.head.map((c, j) => <th key={j} className={`px-3 py-2 text-left font-medium whitespace-nowrap ${numeric(b.rows[0]?.[j] ?? "") ? "text-right" : ""}`}>{inline(c)}</th>)}</tr>
              </thead>
              <tbody>
                {b.rows.map((r, j) => (
                  <tr key={j} className="border-t border-(--border)">
                    {b.head.map((_, k) => <td key={k} className={`px-3 py-1.5 align-top ${numeric(r[k] ?? "") ? "text-right tabular whitespace-nowrap" : ""}`}>{inline(r[k] ?? "")}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      default:
        return (
          <p key={i} className="my-2 first:mt-0 last:mb-0">
            {b.lines.map((l, j) => (
              <Fragment key={j}>
                {j ? <br /> : null}
                {inline(l)}
              </Fragment>
            ))}
          </p>
        );
    }
  });
}

const TOKEN = /(\*\*[^*]+\*\*|(?<![\p{L}\d])__[^_]+__(?![\p{L}\d])|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*[^*\s][^*]*\*|(?<![\p{L}\d])_[^_\s][^_]*_(?![\p{L}\d]))/gu;

function inline(text: string): ReactNode {
  const parts = text.split(TOKEN);
  return parts.map((p, i) => {
    if (!p) return null;
    if ((p.startsWith("**") && p.endsWith("**")) || (p.startsWith("__") && p.endsWith("__"))) return <strong key={i} className="font-semibold">{inline(p.slice(2, -2))}</strong>;
    if (p.startsWith("`") && p.endsWith("`")) return <code key={i} className="rounded-md bg-(--surface-2) px-1 py-0.5 font-mono text-[12.5px]">{p.slice(1, -1)}</code>;
    const link = p.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) {
      const [, label, href] = link;
      if (href!.startsWith("/") && !href!.startsWith("//")) return <Link key={i} to={href!} className="font-medium text-brand-700 hover:underline dark:text-brand-400">{label}</Link>;
      if (/^https?:\/\//.test(href!)) return <a key={i} href={href} onClick={(e) => { e.preventDefault(); openExternal(href!); }} className="font-medium text-brand-700 hover:underline dark:text-brand-400">{label}</a>;
      return <span key={i}>{label}</span>;
    }
    if ((p.startsWith("*") && p.endsWith("*") && p.length > 2) || (p.startsWith("_") && p.endsWith("_") && p.length > 2)) return <em key={i}>{p.slice(1, -1)}</em>;
    return <Fragment key={i}>{p}</Fragment>;
  });
}
