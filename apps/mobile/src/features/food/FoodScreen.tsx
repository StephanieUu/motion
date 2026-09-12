import { SectionPlaceholder } from '../../components/SectionPlaceholder'
import { uiCopy } from '../../locales'

export function FoodScreen() {
  return (
    <SectionPlaceholder
      {...uiCopy.placeholders.food}
      motif={<span className="motif-bloom" />}
    />
  )
}
