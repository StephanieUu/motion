import { Navigate, Route, Routes } from 'react-router-dom'

import { AppShell } from '../components/AppShell'
import { BodyScreen } from '../features/body/BodyScreen'
import { FoodScreen } from '../features/food/FoodScreen'
import { MeScreen } from '../features/me/MeScreen'
import { TodayScreen } from '../features/today/TodayScreen'
import { TrainingScreen } from '../features/training/TrainingScreen'

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<TodayScreen />} />
        <Route path="/training" element={<TrainingScreen />} />
        <Route path="/food" element={<FoodScreen />} />
        <Route path="/body" element={<BodyScreen />} />
        <Route path="/me" element={<MeScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  )
}
