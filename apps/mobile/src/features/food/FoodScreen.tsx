import { SectionPlaceholder } from '../../components/SectionPlaceholder'

export function FoodScreen() {
  return (
    <SectionPlaceholder
      eyebrow="Food"
      title="Nourish the day."
      description="Meals and daily nutrition will have a simple home here."
      motif={<span className="motif-bloom" />}
    />
  )
}
