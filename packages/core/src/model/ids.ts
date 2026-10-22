import { nanoid } from "nanoid";

/** Collision-safe, URL-safe id with a short type prefix for readability in exports/logs. */
export function newId(prefix: string): string {
  return `${prefix}_${nanoid(16)}`;
}

export const ids = {
  profile: () => newId("prf"),
  contact: () => newId("ctc"),
  category: () => newId("cat"),
  transaction: () => newId("txn"),
  document: () => newId("doc"),
  attachment: () => newId("att"),
  recurring: () => newId("rec"),
  asset: () => newId("ast"),
  invoice: () => newId("inv"),
  journal: () => newId("jrn"),
  audit: () => newId("aud"),
  notification: () => newId("ntf"),
  member: () => newId("mbr"),
  project: () => newId("prj"),
  task: () => newId("tsk"),
  milestone: () => newId("mst"),
  timeEntry: () => newId("tim"),
  offer: () => newId("ofr"),
  line: () => newId("lin"),
  product: () => newId("prd"),
  stockMove: () => newId("stk"),
  workOrder: () => newId("wko"),
  folder: () => newId("fld"),
  file: () => newId("fil"),
  chat: () => newId("cht"),
  message: () => newId("msg"),
};
