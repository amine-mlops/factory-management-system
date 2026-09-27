import React, { useState } from 'react';
import Header from './components/Header.jsx';
import Chat from './components/Chat.jsx';
import Audit from './components/Audit.jsx';

const ORG_ID = 'org_morocco_logistics';

export default function App() {
  const [role, setRole] = useState('executive');
  const [violations, setViolations] = useState([]);
  const breached = violations.length > 0;

  return (
    <div className="app">
      <Header role={role} onChangeRole={setRole} orgId={ORG_ID} />
      {breached && (
        <div className="alert-banner">
          <span className="alert-tag">⚠ BREACHED</span>
          <span className="alert-text">
            {violations.length} compliance violation{violations.length === 1 ? '' : 's'} detected
          </span>
        </div>
      )}
      <main className="layout">
        <section className="panel chat-panel">
          <Chat orgId={ORG_ID} role={role} />
        </section>
        <section className="panel audit-panel">
          <Audit orgId={ORG_ID} onViolations={setViolations} />
        </section>
      </main>
    </div>
  );
}
