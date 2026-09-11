import { SectionPlaceholder } from '../../components/SectionPlaceholder'

export function MeScreen() {
  return (
    <SectionPlaceholder
      eyebrow="Me"
      title="Make Motion yours."
      description="Your preferences and personal details will live here."
      motif={<span className="motif-profile" />}
    />
  )
}
