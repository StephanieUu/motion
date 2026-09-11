export type IconName =
  | 'today'
  | 'training'
  | 'food'
  | 'body'
  | 'me'
  | 'spark'
  | 'clock'
  | 'arrow'

interface AppIconProps {
  name: IconName
}

const paths: Record<IconName, React.ReactNode> = {
  today: (
    <>
      <path d="M4.5 10.5 12 4l7.5 6.5" />
      <path d="M6.5 9.5v10h11v-10M9.5 19.5v-6h5v6" />
    </>
  ),
  training: (
    <>
      <path d="M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10" />
    </>
  ),
  food: (
    <>
      <path d="M7 3v7M4.5 3v4.5A2.5 2.5 0 0 0 7 10v11M9.5 3v4.5A2.5 2.5 0 0 1 7 10" />
      <path d="M17 3c-2 2-3 5-3 8h3v10M17 3v8" />
    </>
  ),
  body: (
    <>
      <circle cx="12" cy="5" r="2.2" />
      <path d="M8.5 21c.8-3.2 1-5.5.7-7.5L7.5 9.7A2 2 0 0 1 9.3 7h5.4a2 2 0 0 1 1.8 2.7l-1.7 3.8c-.3 2 .1 4.3.7 7.5M9.8 12h4.4" />
    </>
  ),
  me: (
    <>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5.5 20c.8-4 3-6 6.5-6s5.7 2 6.5 6" />
    </>
  ),
  spark: (
    <>
      <path d="m12 2 1.6 5.1L19 9l-5.4 1.9L12 16l-1.6-5.1L5 9l5.4-1.9L12 2Z" />
      <path d="m18 15 .8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15Z" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  arrow: <path d="M5 12h14M14 7l5 5-5 5" />,
}

export function AppIcon({ name }: AppIconProps) {
  return (
    <svg
      className="app-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}
