import Link from 'next/link'

export default function Home() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: '2rem',
        gap: '3rem',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1rem',
          maxWidth: '600px',
          textAlign: 'center',
        }}
      >
        <h1
          style={{
            fontSize: '4rem',
            fontWeight: 700,
            letterSpacing: '-0.04em',
            lineHeight: 1,
          }}
        >
          Agora
        </h1>
        <p
          style={{
            fontSize: '1.25rem',
            color: 'var(--muted)',
            lineHeight: 1.6,
            maxWidth: '520px',
          }}
        >
          Where AI minds gather to debate, investigate, and play.
          A multi-agent collaboration platform.
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '1rem',
          maxWidth: '560px',
          width: '100%',
        }}
      >
        <ModeCard
          href="/create"
          title="Roundtable Debate"
          description="Structured argument across rounds — 2-8 agents with distinct personas."
          accent="var(--accent)"
        />
        <ModeCard
          href="/create-werewolf"
          title="Werewolf 狼人杀"
          description="Social deduction with hidden roles — 6-12 agents, Chinese standard rules."
          accent="#7f6df2"
        />
      </div>

      <Link
        href="/replays"
        style={{
          fontSize: '0.8rem',
          color: 'var(--muted)',
          textDecoration: 'none',
          borderBottom: '1px solid var(--border)',
          paddingBottom: '0.2rem',
        }}
      >
        Browse replays →
      </Link>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1.5rem',
          padding: '2rem',
          maxWidth: '640px',
          width: '100%',
        }}
      >
        <p
          style={{
            fontSize: '0.8rem',
            color: 'var(--muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            fontWeight: 500,
          }}
        >
          How it works
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '1.5rem',
            width: '100%',
          }}
        >
          {[
            { step: '1', title: 'Pick a mode', desc: 'Debate or werewolf' },
            { step: '2', title: 'Configure agents', desc: 'Models + personas per slot' },
            { step: '3', title: 'Watch it play out', desc: 'Live token cost + phase tracking' },
          ].map((item) => (
            <div
              key={item.step}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                gap: '0.5rem',
              }}
            >
              <div
                style={{
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
                }}
              >
                {item.step}
              </div>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 600 }}>{item.title}</h3>
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

function ModeCard({
  href,
  title,
  description,
  accent,
}: {
  href: string
  title: string
  description: string
  accent: string
}) {
  return (
    <Link
      href={href}
      style={{
        display: 'block',
        padding: '1.25rem',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        textDecoration: 'none',
        color: 'var(--foreground)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '3px',
          background: accent,
        }}
      />
      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.375rem' }}>{title}</h2>
      <p style={{ fontSize: '0.85rem', color: 'var(--muted)', lineHeight: 1.5 }}>{description}</p>
    </Link>
  )
}
