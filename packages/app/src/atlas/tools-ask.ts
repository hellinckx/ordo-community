import { z } from "zod";
import { AtlasToolError, defineTool, type AtlasTool } from "./tools";

/** A question with ready answers. The chat shows it as a card; the loop waits until the person picks or types. */
export const ASK_TOOL = "ask_choice";

export function askTools(): AtlasTool[] {
  return [
    defineTool({
      name: ASK_TOOL,
      description:
        "Stellt der Person eine Rückfrage mit fertigen Antworten (2 bis 5, kurz). Ordo zeigt sie als Karte mit Knöpfen und einem Feld für eine eigene Antwort; die Antwort kommt als Ergebnis zurück. Nimm das, wenn etwas unklar ist und es wenige sinnvolle Möglichkeiten gibt (welches Projekt, welcher Zeitraum, welche Variante) – statt zu raten. Höchstens eine Frage pro Schritt.",
      input: z.object({
        question: z.string().describe("Die Frage, kurz und konkret"),
        options: z.array(z.string().describe("Eine mögliche Antwort, wenige Wörter")).min(2).max(5),
      }),
      kind: "read",
      preview: (i) => i.question,
      run() {
        throw new AtlasToolError("Die Rückfrage beantwortet die Person auf der Karte im Chat.");
      },
    }),
  ];
}
