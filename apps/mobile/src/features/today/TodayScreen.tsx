import { AppIcon } from '../../components/AppIcon'

const week = [
  { day: 'M', state: 'done' },
  { day: 'T', state: 'done' },
  { day: 'W', state: 'today' },
  { day: 'T', state: 'open' },
  { day: 'F', state: 'open' },
  { day: 'S', state: 'open' },
  { day: 'S', state: 'open' },
] as const

export function TodayScreen() {
  return (
    <div className="today-screen">
      <header className="today-header">
        <div>
          <span className="today-header__date">Wednesday · 10 September</span>
          <h1>Good morning.</h1>
          <p>One steady step is enough for today.</p>
        </div>
        <div className="orbital-mark" aria-hidden="true">
          <span />
        </div>
      </header>

      <section className="workout-card" aria-labelledby="today-workout-title">
        <svg className="workout-card__botanical" viewBox="0 0 170 250" aria-hidden="true">
          <path d="M145 258C124 212 117 172 124 132c7-40 22-73 45-98" />
          <path d="M123 151c-29-12-49-32-58-61 28 3 49 23 58 61Z" />
          <path d="M129 116c28-10 45-29 51-56-25 5-42 24-51 56Z" />
          <path d="M132 190c-28-8-51-3-69 15 26 10 49 5 69-15Z" />
        </svg>
        <div className="workout-card__content">
          <span className="eyebrow">Today’s movement</span>
          <h2 id="today-workout-title">Full-body reset</h2>
          <p>Gentle strength and mobility to begin the week with room to breathe.</p>
          <div className="workout-card__meta">
            <span>
              <AppIcon name="clock" /> 28 min
            </span>
            <span>Low impact</span>
          </div>
          <button type="button" disabled aria-label="Start workout preview">
            <span>Start workout</span>
            <AppIcon name="arrow" />
          </button>
        </div>
      </section>

      <section className="streak-card" aria-labelledby="streak-title">
        <div className="streak-card__heading">
          <div>
            <span className="eyebrow">Your rhythm</span>
            <h2 id="streak-title">8 day streak</h2>
          </div>
          <div className="sun-mark" aria-hidden="true">
            <span />
          </div>
        </div>
        <div className="week-row" aria-label="Weekly activity preview">
          {week.map((item, index) => (
            <div className="week-day" key={`${item.day}-${index}`}>
              <span className={`week-day__dot is-${item.state}`}>
                {item.state === 'done' ? '✓' : ''}
              </span>
              <span>{item.day}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="today-grid">
        <section className="metric-card nutrition-card" aria-labelledby="nutrition-title">
          <span className="eyebrow">Nourishment</span>
          <h2 id="nutrition-title">Today</h2>
          <div className="nutrition-stat">
            <span>Calories</span>
            <strong>1,580 <small>/ 2,050</small></strong>
            <div className="progress-track" aria-hidden="true">
              <span style={{ width: '77%' }} />
            </div>
          </div>
          <div className="nutrition-stat">
            <span>Protein</span>
            <strong>92 g <small>/ 125 g</small></strong>
            <div className="progress-track is-pink" aria-hidden="true">
              <span style={{ width: '74%' }} />
            </div>
          </div>
        </section>

        <section className="metric-card weight-card" aria-labelledby="weight-title">
          <span className="eyebrow">Weight trend</span>
          <h2 id="weight-title">64.8 <small>kg</small></h2>
          <span className="trend-label">−0.4 kg this month</span>
          <svg className="trend-line" viewBox="0 0 150 62" aria-hidden="true">
            <path className="trend-line__area" d="M2 18c20 1 24 14 41 13 17-2 24-10 42-7 17 4 29 24 63 18v20H2Z" />
            <path d="M2 18c20 1 24 14 41 13 17-2 24-10 42-7 17 4 29 24 63 18" />
            <circle cx="148" cy="42" r="3.5" />
          </svg>
        </section>
      </div>

      <p className="today-footer-note">Keep going gently.</p>
    </div>
  )
}
