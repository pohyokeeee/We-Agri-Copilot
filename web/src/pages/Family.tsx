import { useEffect } from 'react'
import { FamilyLayout } from '../components/Shell'
import { setRole } from '../state/role'

/** /family: a dedicated daughter window. Opening it signs this window in as the family account. */
export default function Family() {
  useEffect(() => setRole('family'), [])
  return <FamilyLayout />
}
