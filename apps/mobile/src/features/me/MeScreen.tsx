import { SectionPlaceholder } from '../../components/SectionPlaceholder'
import { uiCopy } from '../../locales'

export function MeScreen() {
  return (
    <SectionPlaceholder
      {...uiCopy.placeholders.me}
      motif={<span className="motif-profile" />}
    />
  )
}
