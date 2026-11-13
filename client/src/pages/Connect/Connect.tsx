import { Link } from 'react-router-dom';

/** Placeholder until the full team-setup screen lands in Milestone 3c. */
export default function Connect() {
  return (
    <main style={{ padding: '48px 24px', maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1>Connect your team</h1>
      <p>The team setup form is coming in the next milestone.</p>
      <p><Link to="/teams/1">Open the demo team →</Link></p>
    </main>
  );
}
