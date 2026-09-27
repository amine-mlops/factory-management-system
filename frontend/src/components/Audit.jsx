import React, { useState } from 'react';
import { runAudit } from '../api.js';

export default function Audit({ orgId, onViolations }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function handleRun() {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      const data = await runAudit({ orgId });
      setResult(data);
      if (onViolations) onViolations(data.violations || []);
    } catch (err) {
      setError(err.message);
      if (onViolations) onViolations([]);
    } finally {
      setRunning(false);
    }
  }

  const violations = (result && result.violations) || [];

  return (
    <div className="audit">
      <div className="audit-header">
        <h2>Operational Audit</h2>
        <button className="primary-btn" onClick={handleRun} disabled={running}>
          {running ? (
            <>
              <span className="spinner" /> Running…
            </>
          ) : (
            'Run Operational Audit'
          )}
        </button>
      </div>

      {error && <div className="audit-error">Audit failed: {error}</div>}

      {result && (
        <div className="audit-summary">
          <span className={`status-badge ${violations.length > 0 ? 'status-bad' : 'status-ok'}`}>
            {result.status || 'done'}
          </span>
          <span className="summary-count">{result.total_rules_evaluated} rules evaluated</span>
        </div>
      )}

      {violations.length > 0 ? (
        <div className="violations">
          {violations.map((v, i) => (
            <div key={v.rule_id || i} className={`violation-card sev-${(v.severity || 'unknown').toLowerCase()}`}>
              <div className="violation-head">
                <span className={`sev-badge sev-${(v.severity || 'unknown').toLowerCase()}`}>
                  {v.severity || 'UNKNOWN'}
                </span>
                <span className="violation-label">{v.label}</span>
              </div>
              {v.affected_records && v.affected_records.length > 0 && (
                <div className="affected">
                  <div className="affected-title">Affected batches</div>
                  <div className="table-wrap">
                    <table className="mini-table breached-table">
                      <tbody>
                        {v.affected_records.map((r, j) => (
                          <tr key={j}>
                            <td className="affected-id">
                              {typeof r === 'string' ? r : recordId(r)}
                            </td>
                            <td className="breached-cell">BREACHED</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        result && violations.length === 0 && (
          <div className="audit-clean">✓ No violations found — all rules passed.</div>
        )
      )}
    </div>
  );
}

function recordId(r) {
  if (typeof r === 'object' && r !== null) {
    return r.batch_id || r.id || r.record_id || JSON.stringify(r);
  }
  return String(r);
}
