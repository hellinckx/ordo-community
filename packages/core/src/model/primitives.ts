import { z } from "zod";

/* Shared building blocks for every schema – kept apart from model/types.ts so module schemas can use them
   without importing the vault schema (which imports the module schemas). */

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum muss YYYY-MM-DD sein");
export const isoDateTime = z.string().min(10);
export const cents = z.number().int();
export const vatRate = z.union([z.literal(0), z.literal(10), z.literal(13), z.literal(19), z.literal(20)]);

export const baseEntity = {
  id: z.string(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  deletedAt: isoDateTime.optional(),
};

/** Origin in another system, e.g. "erp:project:12" – re-imports update instead of duplicating. */
export const legacyRef = z.string().optional();
