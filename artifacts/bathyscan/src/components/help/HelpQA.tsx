import React, { useState, useRef, useEffect } from "react";
import { useOfflineStore } from "@/lib/offlineStore";
import { authorizedFetch } from "@/lib/authorizedFetch";

const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");

export function validateHelpInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  return trimmed;
}

interface QAMessage {
  role: "user" | "assistant";
  content: string;
}

const STARTERS = [
  "How do I drop a marker?",
  "What is the AI assistant for?",
  "How do I upload my own depth data?",
  "How do I correct a zone the AI got wrong?",
  "How do I record my GPS track?",
  "What does METAR mean?",
  "How do I use the overview map?",
];

export const HelpQA: React.FC = () => {
  const [messages, setMessages] = useState<QAMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isOnline = useOfflineStore((s) => s.isOnline);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function ask(question: string) {
    if (!isOnline) return;
    const q = validateHelpInput(question);
    if (!q || loading) return;
    setError(null);
    setMessages((m) => [...m, { role: "user", content: q }]);
    setInput("");
    setLoading(true);
    try {
      const resp = await authorizedFetch(`${apiBase}/api/poe/help`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          history: messages.slice(-8).map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      if (resp.status === 429) {
        setError("You've reached the AI usage limit for now. Please wait a minute and try again.");
        setLoading(false);
        return;
      }
      if (!resp.ok) {
        setError("Sorry — the assistant is unavailable right now. Please try again in a moment.");
        setLoading(false);
        return;
      }
      const data = (await resp.json()) as { answer?: string };
      const answer = (data.answer ?? "").trim() || "I'm not sure how to answer that one.";
      setMessages((m) => [...m, { role: "assistant", content: answer }]);
    } catch {
      setError("Network problem reaching the assistant. Check your connection and retry.");
    } finally {
      setLoading(false);
    }
  }

  if (!isOnline) {
    return (
      <div className="help-qa">
        <div className="help-qa-header">
          <span className="help-qa-title">Ask the BathyScan assistant</span>
        </div>
        <div style={{
          margin: "8px 0",
          padding: "10px 12px",
          background: "rgba(251,191,36,0.07)",
          border: "1px solid rgba(251,191,36,0.3)",
          borderRadius: 4,
          fontSize: 16.5,
          color: "#fbbf24",
          lineHeight: 1.5,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 15, letterSpacing: "0.12em" }}>
            ⚡ OFFLINE MODE
          </div>
          The AI assistant requires a network connection. Reconnect to the internet to ask questions.
          <div style={{ marginTop: 6, fontSize: 15, color: "#94a3b8" }}>
            Offline help articles and walkthroughs in the Articles tab are still available.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="help-qa">
      <div className="help-qa-header">
        <span className="help-qa-title">Ask the BathyScan assistant</span>
        {messages.length > 0 && (
          <button className="help-qa-clear" onClick={() => setMessages([])} type="button">
            Clear
          </button>
        )}
      </div>

      {messages.length === 0 && (
        <div className="help-qa-starters">
          <div className="help-qa-starter-label">Try a starter question:</div>
          <div className="help-qa-starter-row">
            {STARTERS.map((s) => (
              <button key={s} type="button" className="help-qa-starter" onClick={() => ask(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {messages.length > 0 && (
        <div className="help-qa-thread" ref={scrollRef}>
          {messages.map((m, i) => (
            <div key={i} className={`help-qa-msg help-qa-msg-${m.role}`}>
              <div className="help-qa-msg-role">{m.role === "user" ? "You" : "Assistant"}</div>
              <div className="help-qa-msg-body">{m.content}</div>
            </div>
          ))}
          {loading && (
            <div className="help-qa-msg help-qa-msg-assistant">
              <div className="help-qa-msg-role">Assistant</div>
              <div className="help-qa-msg-body help-qa-thinking">Thinking…</div>
            </div>
          )}
        </div>
      )}

      {error && <div className="help-qa-error">{error}</div>}

      <form
        className="help-qa-form"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
      >
        <input
          type="text"
          className="help-qa-input"
          placeholder="Ask about anything in BathyScan…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading}
        />
        <button type="submit" className="help-qa-send" disabled={loading || !input.trim()}>
          {loading ? "…" : "Ask"}
        </button>
      </form>
    </div>
  );
};
