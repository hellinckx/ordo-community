/** The community edition has no admin function – deleting an account runs through summa_delete_self. */
export function AdminFunctionStep(_props: { copy: (text: string, what: string) => Promise<void>; save: (name: string, text: string) => Promise<void> }) {
  return null;
}
