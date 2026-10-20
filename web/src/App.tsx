import { Route, Routes } from 'react-router-dom'
import { JudgeRoute, Shell } from './components/Shell'
import Applications from './pages/Applications'
import Family from './pages/Family'
import Home from './pages/Home'
import Pay from './pages/Pay'
import Plan from './pages/Plan'
import Season from './pages/Season'
import Support from './pages/Support'
import Tax from './pages/Tax'
import TaxCheck from './pages/TaxCheck'
import Welcome from './pages/Welcome'

/** Routes: the farmer's site (with the shell), plus the welcome page, the daughter's window and the judge panel on their own. */
export default function App() {
  return (
    <Routes>
      <Route path="/welcome" element={<Welcome />} />
      <Route path="/family" element={<Family />} />
      <Route path="/judge" element={<JudgeRoute />} />
      <Route element={<Shell />}>
        <Route path="/" element={<Home />} />
        <Route path="/tax/check" element={<TaxCheck />} />
        <Route path="/tax" element={<Tax />} />
        <Route path="/support" element={<Support />} />
        <Route path="/applications" element={<Applications />} />
        <Route path="/season" element={<Season />} />
        <Route path="/plan" element={<Plan />} />
        <Route path="/pay" element={<Pay />} />
        <Route path="*" element={<Home />} />
      </Route>
    </Routes>
  )
}
