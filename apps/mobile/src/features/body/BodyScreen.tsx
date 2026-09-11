import { SectionPlaceholder } from '../../components/SectionPlaceholder'

export function BodyScreen() {
  return (
    <SectionPlaceholder
      eyebrow="Body"
      title="Notice the change."
      description="Measurements and longer trends will appear without judgment."
      motif={<span className="motif-ring motif-ring--lilac" />}
    />
  )
}
