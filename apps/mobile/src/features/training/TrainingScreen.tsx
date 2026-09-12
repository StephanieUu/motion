import { SectionPlaceholder } from '../../components/SectionPlaceholder'
import { uiCopy } from '../../locales'

export function TrainingScreen() {
  return (
    <SectionPlaceholder
      {...uiCopy.placeholders.training}
      motif={<span className="motif-ring motif-ring--green" />}
    />
  )
}
