import { SectionPlaceholder } from '../../components/SectionPlaceholder'
import { uiCopy } from '../../locales'

export function BodyScreen() {
  return (
    <SectionPlaceholder
      {...uiCopy.placeholders.body}
      motif={<span className="motif-ring motif-ring--lilac" />}
    />
  )
}
