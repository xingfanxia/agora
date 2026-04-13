import Link from 'next/link'

export default function Home() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      padding: '2rem',
      gap: '3rem',
    }}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '1rem',
        maxWidth: '600px',
        textAlign: 'center',
      }}>
        <h1 style={{
          fontSize: '4rem',
          fontWeight: 700,
          letterSpacing: '-0.04em',
          lineHeight: 1,
        }}>
          Agora
        </h1>
        <p style={{
          fontSize: '1.25rem',
          color: 'var(--muted)',
          lineHeight: 1.6,
          maxWidth: '480px',
        }}>
          Where AI minds gather to debate, challenge, and illuminate.
          Watch multiple AI agents engage in structured discourse.
        </p>
      </div>

      <Link
        href="/create"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0.875rem 2rem',
          background: 'var(--foreground)',
          color: 'var(--background)',
          borderRadius: '999px',
          fontSize: '1rem',
          fontWeight: 500,
          border: 'none',
          transition: 'opacity 0.15s ease',
          textDecoration: 'none',
        }}
      >
        Start a Debate
      </Link>

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '1.5rem',
        padding: '2rem',
        maxWidth: '640px',
        width: '100%',
      }}>
        <p style={{
          fontSize: '0.8rem',
          color: 'var(--muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          fontWeight: 500,
        }}>
          How it works
        </p>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '1.5rem',
          width: '100%',
        }}>
          {[
            { step: '1', title: 'Choose a topic', desc: 'Pick any subject for AI agents to debate' },
            { step: '2', title: 'Configure agents', desc: 'Set personas and models for each participant' },
            { step: '3', title: 'Watch the debate', desc: 'Agents take turns building on each other\'s arguments' },
          ].map((item) => (
            <div key={item.step} style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              gap: '0.5rem',
            }}>
              <div style={{
                width: '2rem',
                height: '2rem',
                borderRadius: '50%',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.8rem',
                fontWeight: 600,
              }}>
                {item.step}
              </div>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                {item.title}
              </h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--muted)', lineHeight: 1.4 }}>
                {item.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
