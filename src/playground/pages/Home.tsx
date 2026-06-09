import { Link } from 'react-router'

interface Variant {
  path: string
  name: string
  desc: string
  status: 'active' | 'planned'
}

const VARIANTS: Variant[] = [
  { path: '/dom', name: 'DOM shell', desc: 'Absolute-positioned cells + transform. The committed architecture.', status: 'active' },
  { path: '/css-grid', name: 'CSS Grid shell', desc: 'display:grid comparison variant. Deferred (DECISIONS.md D5).', status: 'planned' },
  { path: '/canvas', name: 'Canvas shell', desc: 'Future spike, plain cells only — cannot host AntD (DECISIONS.md D0).', status: 'planned' },
]

export function Home() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px', lineHeight: 1.6 }}>
      <p style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#4f46e5', fontWeight: 700, margin: 0 }}>
        Data Grid · Playground
      </p>
      <h1 style={{ fontSize: 28, margin: '6px 0 8px' }}>Rendering shells</h1>
      <p style={{ color: '#57534e', marginTop: 0 }}>
        A headless data grid study. Phase 0: scaffold + FPS harness. See <code>DECISIONS.md</code> for the locked architecture and roadmap.
      </p>

      <div style={{ display: 'grid', gap: 12, marginTop: 24 }}>
        {VARIANTS.map((v) => {
          const card = (
            <div
              style={{
                border: '1px solid #e7e5e4',
                borderRadius: 10,
                padding: '16px 18px',
                background: v.status === 'active' ? '#fff' : '#fafaf9',
                opacity: v.status === 'active' ? 1 : 0.6,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <strong style={{ fontSize: 16 }}>{v.name}</strong>
                <span
                  style={{
                    fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, color: '#fff',
                    background: v.status === 'active' ? '#16a34a' : '#a8a29e',
                  }}
                >
                  {v.status === 'active' ? 'ACTIVE' : 'PLANNED'}
                </span>
              </div>
              <p style={{ margin: '6px 0 0', fontSize: 14, color: '#57534e' }}>{v.desc}</p>
            </div>
          )
          return v.status === 'active' ? (
            <Link key={v.path} to={v.path} style={{ textDecoration: 'none', color: 'inherit' }}>
              {card}
            </Link>
          ) : (
            <div key={v.path}>{card}</div>
          )
        })}
      </div>
    </main>
  )
}
