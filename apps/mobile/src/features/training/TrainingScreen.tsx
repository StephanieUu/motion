import { SectionPlaceholder } from '../../components/SectionPlaceholder'

export function TrainingScreen() {
  return (
    <SectionPlaceholder
      eyebrow="Training"
      title="Move with intention."
      description="Your training days will gather here in a calm, flexible rhythm."
      motif={<span className="motif-ring motif-ring--green" />}
    />
  )
}
