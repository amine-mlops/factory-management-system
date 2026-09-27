async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = new Error(`Request failed with status ${res.status}`);
    err.status = res.status;
    try {
      err.body = await res.text();
    } catch {
      err.body = null;
    }
    throw err;
  }
  return res.json();
}

export function sendChat({ orgId, role, message }) {
  return postJson('/api/chat', { org_id: orgId, role, message });
}

export function runAudit({ orgId }) {
  return postJson('/api/audit/run', { org_id: orgId });
}
