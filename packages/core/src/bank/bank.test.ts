import { describe, expect, it } from "vitest";
import { parseBankCsv, parseCamt, parseBankPdfText, selectBankExtraction } from "./parse";
import { reconcile, reconcileStats, transactionFromBankLine } from "./reconcile";
import { bankIgnoreError, bankSettlementInstructions } from "./settlement";
import { DEFAULT_CATEGORIES } from "../model/defaults";
import type { BankLine, Transaction } from "../model/types";
import { lineFromGross } from "../model/vat";

const GEORGE_CSV = `Buchungsdatum;Partnername;Partner IBAN;Partner BIC;Buchungs-Details;Betrag;Währung;Valutadatum
03.03.2026;BILLA AG;AT123;GIBAATWW;POS 02.03.2026 17:42 Billa 1234;-12,77;EUR;03.03.2026
05.03.2026;Max Kunde;AT61 1904 3002 3457 3201;BKAUATWW;Rechnung 2026-0042;1.200,00;EUR;05.03.2026
06.03.2026;;;;Kontoführung Q1;-9,90;EUR;06.03.2026
`;

const CAMT = `<?xml version="1.0"?><Document><BkToCstmrStmt><Stmt><Acct><Id><IBAN>AT611904300234573201</IBAN></Id><Nm>Firma</Nm></Acct>
<Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">1000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>
<Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">1187.23</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>
<Ntry><Amt Ccy="EUR">12.77</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-03-03</Dt></BookgDt><ValDt><Dt>2026-03-03</Dt></ValDt><NtryDtls><TxDtls><RltdPties><Cdtr><Nm>BILLA AG</Nm></Cdtr></RltdPties><RmtInf><Ustrd>POS Billa</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
<Ntry><Amt Ccy="EUR">200.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-03-05</Dt></BookgDt><NtryDtls><TxDtls><RltdPties><Dbtr><Nm>Max Kunde</Nm></Dbtr></RltdPties><RmtInf><Ustrd>RE 2026-0042</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
</Stmt></BkToCstmrStmt></Document>`;

const PDF_TEXT = `Raiffeisenbank Musterstadt
Kontoauszug 3/2026 vom 01.03.2026 bis 31.03.2026
IBAN AT61 1904 3002 3457 3201
Alter Saldo 1.000,00 H
03.03.2026 03.03.2026 BILLA AG POS 1234 12,77-
05.03.2026 Max Kunde Rechnung 2026-0042 1.200,00 H
Neuer Saldo 2.187,23 H`;

describe("bank parsing", () => {
  it("parses George-style CSV", () => {
    const s = parseBankCsv(GEORGE_CSV);
    expect(s.lines).toHaveLength(3);
    expect(s.lines[0]).toMatchObject({ date: "2026-03-03", amountCents: -1277, counterparty: "BILLA AG" });
    expect(s.lines[1]).toMatchObject({ date: "2026-03-05", amountCents: 120000, counterpartyIban: "AT611904300234573201" });
    expect(s.from).toBe("2026-03-03");
  });
  it("parses CAMT.053", () => {
    const s = parseCamt(CAMT);
    expect(s.iban).toBe("AT611904300234573201");
    expect(s.openingBalanceCents).toBe(100000);
    expect(s.closingBalanceCents).toBe(118723);
    expect(s.lines).toEqual([
      expect.objectContaining({ date: "2026-03-03", amountCents: -1277, counterparty: "BILLA AG", purpose: "POS Billa" }),
      expect.objectContaining({ date: "2026-03-05", amountCents: 20000, counterparty: "Max Kunde" }),
    ]);
    expect(s.warnings).toEqual([]);
  });
  it("parses PDF text layer", () => {
    const s = parseBankPdfText(PDF_TEXT);
    expect(s.iban).toBe("AT611904300234573201");
    expect(s.lines).toHaveLength(2);
    expect(s.lines[0]).toMatchObject({ date: "2026-03-03", amountCents: -1277 });
    expect(s.lines[1]).toMatchObject({ date: "2026-03-05", amountCents: 120000 });
    expect(s.openingBalanceCents).toBe(100000);
    expect(s.closingBalanceCents).toBe(218723);
  });
  it("preserves source balance checks when AI returns more rows or omits balances", () => {
    const local = parseBankPdfText(PDF_TEXT);
    const bad = { ...local, format: "ai" as const, openingBalanceCents: undefined, closingBalanceCents: undefined, lines: [...local.lines, { ...local.lines[0]!, amountCents: 7000 }], warnings: [] };
    const chosen = selectBankExtraction(local, bad);
    expect(chosen.lines).toHaveLength(2);
    expect(chosen.warnings.join(" ")).toContain("verworfen");
    const incomplete = { ...local, lines: local.lines.slice(0, 1), warnings: ["Saldenprüfung: unvollständig"] };
    const checked = selectBankExtraction(incomplete, { ...bad, lines: local.lines });
    expect(checked.lines).toHaveLength(2);
    expect(checked.openingBalanceCents).toBe(100000);
    expect(checked.closingBalanceCents).toBe(218723);
    expect(checked.warnings).toEqual([]);
  });
});

describe("reconcile", () => {
  const now = "2026-03-01T00:00:00.000Z";
  const tx = (id: string, kind: Transaction["kind"], gross: number, date: string, extra: Partial<Transaction> = {}): Transaction => ({ id, profileId: "p1", kind, date, description: "", vatLines: [lineFromGross(gross, 20)], grossCents: gross, currency: "EUR", vatTreatment: "standard", vatDeductiblePct: 100, paymentMethod: "bank", invoiceNumber: "", reference: "", documentIds: [], tags: [], notes: "", origin: "manual", reviewed: true, createdAt: now, updatedAt: now, ...extra });
  const line = (id: string, amount: number, date: string, counterparty: string, purpose = ""): BankLine => ({ id, profileId: "p1", statementId: "s1", date, amountCents: amount, currency: "EUR", counterparty, counterpartyIban: "", purpose, reference: "", hash: id, status: "unmatched", createdAt: now, updatedAt: now });
  it("auto-matches unique amount+date and suggests ambiguous ones", () => {
    const txs = [tx("t1", "expense", 1277, "2026-03-02", { contactId: "c1" }), tx("t2", "income", 120000, "2026-02-28", { invoiceNumber: "2026-0042", dueDate: "2026-03-14" }), tx("t3", "expense", 5000, "2026-03-10"), tx("t4", "expense", 5000, "2026-03-11")];
    const contacts = [{ id: "c1", profileId: "p1", name: "Billa AG", kind: "vendor" as const, uid: "", email: "", phone: "", street: "", zip: "", city: "", country: "AT", iban: "", notes: "", aliases: [], createdAt: now, updatedAt: now }];
    const lines = [line("l1", -1277, "2026-03-03", "BILLA AG", "POS"), line("l2", 120000, "2026-03-05", "Max Kunde", "Rechnung 2026-0042"), line("l3", -5000, "2026-03-10", "Irgendwer"), line("l4", -999, "2026-03-12", "Bankspesen")];
    const r = reconcile(lines, txs, contacts);
    expect(r.lines[0]).toMatchObject({ status: "matched", matchedTransactionId: "t1" });
    expect(r.lines[1]).toMatchObject({ status: "matched", matchedTransactionId: "t2" });
    expect(r.lines[2]!.status).toBe("suggested"); // t3 vs t4 ambiguous-ish
    expect(r.lines[3]!.status).toBe("unmatched");
    expect(r.autoMatched).toBe(2);
  });
  it("drafts a transaction from a bank line", () => {
    const l = line("l9", -4990, "2026-03-15", "OMV Tankstelle", "Diesel");
    const t = transactionFromBankLine(l, "p1", "business", DEFAULT_CATEGORIES, [], "regelbesteuerung");
    expect(t.kind).toBe("expense");
    expect(t.grossCents).toBe(4990);
    expect(t.categoryId).toBe("cat_b_ex_treibstoff");
    expect(t.paymentMethod).toBe("bank");
    expect(t.reviewed).toBe(false);
  });
  it("counts pocket money and gifts as household income, including generic bank transfer labels", () => {
    for (const purpose of ["Taschengeld", "Übertrag Taschengeld", "Osterhase"]) {
      const l = line("pocket", 7000, "2026-03-02", "Familie Beispiel", purpose);
      const draft = transactionFromBankLine(l, "p1", "employee", DEFAULT_CATEGORIES, [], "regelbesteuerung");
      expect(draft).toMatchObject({ kind: "income", grossCents: 7000, categoryId: "cat_e_in_geschenke" });
      expect(draft.vatLines[0]?.vatCents).toBe(0);
      expect(bankIgnoreError(l, "employee", "Privater Umsatz")).toContain("Privatprofil");
    }
    expect(bankSettlementInstructions("employee")).toContain("Private Umsätze nicht aussortieren");
    expect(bankSettlementInstructions("business")).toContain("nicht als betrieblichen Umsatz");
  });
  it("rejects wrong-kind contact categories and archived category guesses", () => {
    const l = line("credit", 7000, "2026-03-02", "Familie Beispiel", "Taschengeld");
    const contact = { id: "c", name: "Familie Beispiel", aliases: [], defaultCategoryId: "cat_e_p_sonst" } as unknown as import("../model/types").Contact;
    expect(transactionFromBankLine(l, "p1", "employee", DEFAULT_CATEGORIES, [contact], "kleinunternehmer").categoryId).toBe("cat_e_in_geschenke");
    const archived = DEFAULT_CATEGORIES.map((c) => c.id === "cat_e_in_geschenke" ? { ...c, isArchived: true } : c);
    expect(transactionFromBankLine(l, "p1", "employee", archived, [], "kleinunternehmer").categoryId).toBe("cat_e_in_sonst");
  });
  it("keeps ignored credits visible in reconciliation totals and requires a reason for exclusion", () => {
    const l = { ...line("ignored", 7000, "2026-03-02", "Familie", "Taschengeld"), status: "ignored" as const };
    const stats = reconcileStats([l], []);
    expect(stats).toMatchObject({ total: 1, matched: 0, booked: 0, ignored: 1, ignoredCredits: 1, ignoredCreditCents: 7000 });
    expect(reconcile([l], [], []).lines[0]?.status).toBe("ignored"); // recovery is explicit
    expect(bankIgnoreError(l, "business")).toContain("Begründung");
    expect(bankIgnoreError(l, "business", "Private Einlage")).toBeUndefined();
  });
});
