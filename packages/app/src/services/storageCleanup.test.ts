import { describe, expect, it } from "vitest";
import type { Vault } from "@ordo/core";
import { referencedAttachmentIds } from "./storageCleanup";

describe("referencedAttachmentIds", () => {
  it("finds every field that points to a file, also in the trash, but not the attachments themselves", () => {
    const v = {
      profiles: [{ id: "p1", company: { logoAttachmentId: "att_logo" } }],
      documents: [
        { id: "d1", attachmentId: "att_doc", previewAttachmentId: "att_prev" },
        { id: "d2", attachmentId: "att_trash", deletedAt: "2026-10-01T00:00:00Z" },
      ],
      invoices: [{ id: "i1", pdfAttachmentId: "att_pdf" }],
      members: [{ id: "m1", avatarAttachmentId: "att_avatar" }],
      files: [{ id: "f1", attachmentId: "att_file" }],
      contacts: [{ id: "c1", logoAttachmentId: "att_contact", notes: "att_not_a_reference" }],
      attachments: [{ id: "att_unused" }, { id: "att_doc" }],
    } as unknown as Vault;
    const used = referencedAttachmentIds(v);
    expect([...used].sort()).toEqual(["att_avatar", "att_contact", "att_doc", "att_file", "att_logo", "att_pdf", "att_prev", "att_trash"]);
    expect(used.has("att_unused")).toBe(false);
  });
});
