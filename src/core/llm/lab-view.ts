import { redactMessages } from "../../vendor/kit-obsidian/chat-client";
import type { ChatMessage } from "../types";

/** Das, was das llm-lab sehen soll: der GESENDETE Text, nicht die Originale. Die Verbindung schwaerzt
 *  vor dem Senden (umkehrbar) und gibt dem Plugin die Originale zurueck — ein Log, das diese Originale
 *  traegt, wuerde die Geheimnisse an einen Ort schreiben, den der Server nie sah. Nachrichten, Antwort
 *  und Denkspur laufen durch EINE Sitzung, damit derselbe Wert in allen dreien denselben Platzhalter hat. */
export function labView(
  messages: ChatMessage[], content: string, reasoning: string | null,
): { messages: ChatMessage[]; content: string; reasoning: string | null } {
  const extra = [{ role: "assistant", content }, ...(reasoning !== null ? [{ role: "assistant", content: reasoning }] : [])];
  const out = redactMessages([...messages, ...extra]).messages;
  const sent = out.slice(0, messages.length) as ChatMessage[];
  const answer = out[messages.length]?.content;
  const thought = reasoning !== null ? out[messages.length + 1]?.content : null;
  return {
    messages: sent,
    content: typeof answer === "string" ? answer : content,
    reasoning: typeof thought === "string" ? thought : reasoning,
  };
}
