import React from 'react';

export default function Header({ role, onChangeRole, orgId }) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">▲</span>
        <span className="brand-name">Supply Chain Ops</span>
        <span className="org-pill">{orgId}</span>
      </div>
      <label className="persona-select">
        <span className="persona-label">Persona</span>
        <select value={role} onChange={(e) => onChangeRole(e.target.value)}>
          <option value="executive">Executive</option>
          <option value="driver">Driver</option>
        </select>
      </label>
    </header>
  );
}
