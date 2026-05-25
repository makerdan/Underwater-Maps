import React, { useState, useRef, useEffect } from "react";

const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");

interface QAMessage {
  role: "user" | "assistant";
  content: string;
}

const STARTERS = [
  "How do I drop a marker?",
  "What is the AI assistant for?",
  "How do I upload my own depth data?",
  "How do I correct a zone the AI got wrong?",
];

export const HelpQA: React.FC = () => {
  const [messages, setMessages] = useState<QAMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || loading) return;
    setError(null);
    setMessages((m) => [...m, { role: "user", content: q }]);
    setInput("");
    setLoading(true);
    try {
      const resp = await fetch(`${apiBase}/api/poe/help`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
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
