import React, { useEffect, useRef, useState } from 'react';
import { sendChat } from '../api.js';

let nextId = 1;

export default function Chat({ orgId, role }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, sending]);

  async function handleSend(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    const userMsg = { id: nextId++, kind: 'user', text };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setSending(true);
    try {
      const data = await sendChat({ orgId, role, message: text });
      setMessages((m) => [...m, { id: nextId++, kind: 'assistant', data }]);
    } catch (err) {
      if (err.status === 403) {
        setMessages((m) => [
          ...m,
          { id: nextId++, kind: 'assistant', denied: true, text: 'Access denied' },
        ]);
      } else {
        setMessages((m) => [
          ...m,
          { id: nextId++, kind: 'assistant', error: true, text: `Error: ${err.message}` },
        ]);
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="chat">
      <div className="chat-header">
        <h2>Operations Chat</h2>
        <span className="chat-role">role: {role}</span>
      </div>
      <div className="chat-messages" ref={listRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            Ask about batches, delays, or root causes. Persona: <strong>{role}</strong>.
          </div>
        )}
        {messages.map((m) => {
          if (m.kind === 'user') {
            return (
              <div key={m.id} className="bubble-row user">
                <div className="bubble user-bubble">{m.text}</div>
              </div>
            );
          }
          if (m.denied) {
            return (
              <div key={m.id} className="bubble-row assistant">
                <div className="bubble assistant-bubble denied">⛔ Access denied</div>
              </div>
            );
          }
          if (m.error) {
            return (
              <div key={m.id} className="bubble-row assistant">
                <div className="bubble assistant-bubble error">{m.text}</div>
              </div>
            );
          }
          return <AssistantMessage key={m.id} data={m.data} />;
        })}
        {sending && (
          <div className="bubble-row assistant">
            <div className="bubble assistant-bubble typing">
              <span className="dot" /> <span className="dot" /> <span className="dot" />
            </div>
          </div>
        )}
      </div>
      <form className="chat-input" onSubmit={handleSend}>
        <input
          type="text"
          placeholder={`Message as ${role}…`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={sending}
        />
        <button type="submit" disabled={sending || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

function AssistantMessage({ data }) {
  const [open, setOpen] = useState(false);
  const d = data.diagnostics || {};
  const structured = d.structured_data || [];
  const context = d.retrieved_context || [];
  const verdict = d.root_cause_verdict;
  const citations = data.citations || [];

  return (
    <div className="bubble-row assistant">
      <div className="bubble assistant-bubble">
        <div className="response-text">{data.response}</div>
        {verdict && <div className="verdict">Root cause: {verdict}</div>}
        <button className="drawer-toggle" onClick={() => setOpen((o) => !o)}>
          {open ? '▾' : '▸'} Diagnostics
          <span className="drawer-count">
            {structured.length} rows · {context.length} sources · {citations.length} citations
          </span>
        </button>
        {open && (
          <div className="drawer">
            {structured.length > 0 && (
              <div className="drawer-section">
                <h4>Structured data</h4>
                <StructuredTable rows={structured} />
              </div>
            )}
            {context.length > 0 && (
              <div className="drawer-section">
                <h4>Retrieved context</h4>
                {context.map((c, i) => (
                  <div key={i} className="context-card">
                    <div className="context-source">{c.source}</div>
                    <div className="context-snippet">{c.snippet}</div>
                  </div>
                ))}
              </div>
            )}
            {citations.length > 0 && (
              <div className="drawer-section">
                <h4>Citations</h4>
                <div className="chips">
                  {citations.map((c, i) => (
                    <span key={i} className="chip">
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {structured.length === 0 && context.length === 0 && citations.length === 0 && (
              <div className="drawer-empty">No diagnostics returned.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StructuredTable({ rows }) {
  const headers = Object.keys(rows[0] || {});
  if (headers.length === 0) return null;
  return (
    <div className="table-wrap">
      <table className="mini-table">
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {headers.map((h) => (
                <td key={h}>{row[h] === null || row[h] === undefined ? '—' : String(row[h])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
