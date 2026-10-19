import { Text, View } from '@tarojs/components'
import { useEffect, useState } from 'react'
import { ApiError, AgentApproval, Approval, api } from '../services/api'
import PinPad from './PinPad'
import ReadBackCard from './ReadBackCard'
import FamilyCard, { FamilyStatus } from './FamilyCard'
import { Tap, TierChip } from './ui'

type Step = 'readback' | 'busy' | 'pin' | 'wait'

// One bank approval, from the read-back to a token: confirm -> PIN (red) -> co-signer (protection mode).
// The bank says which step is next; this component only shows it and passes the finished token up.
export default function ApprovalFlow({ approval, readback, onToken, onStopped }: {
  approval: AgentApproval; readback: string; onToken: (token: string) => void; onStopped: (why: string) => void
}) {
  const [step, setStep] = useState<Step>(approval.next === 'pin' ? 'pin' : approval.next === 'cosign' ? 'wait' : 'readback')
  const [wrong, setWrong] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [family, setFamily] = useState<FamilyStatus>('waiting')
  const id = approval.approval_id

  const go = (v: Approval) => {
    if (v.next === 'ready' && v.approval_token) return onToken(v.approval_token)
    if (v.next === 'pin') return setStep('pin')
    if (v.next === 'cosign') return setStep('wait')
    onStopped(v.next === 'expired' ? '等得太久了，女儿没有回复，这一步没有办。' : v.next === 'declined' ? '女儿没有同意，这一步没有办。' : '这一步没有批准。')
  }
  const stopOn = (e: unknown) => {
    if (e instanceof ApiError && e.status === 423) return onStopped('账户已锁住，这一步没有办。')
    onStopped('现在连不上银行，这一步没有批准。')
  }

  useEffect(() => { // the approval may already be granted (e.g. the co-signer answered while this was closed)
    if (approval.next === 'ready') api.approval(id).then(go).catch(stopOn)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const yes = () => {
    setStep('busy')
    api.confirmApproval(id).then(go).catch(stopOn)
  }
  const pin = (code: string) => {
    setVerifying(true)
    setWrong(false)
    api.verifyPin(id, code).then(go).catch((e) => (e instanceof ApiError && e.status === 401 ? setWrong(true) : stopOn(e))).finally(() => setVerifying(false))
  }
  const cancel = () => api.cancelApproval(id).catch(() => undefined).finally(() => onStopped('已取消，这一步没有办。'))

  useEffect(() => { // waiting for the co-signer: ask the bank every 2 seconds
    if (step !== 'wait') return undefined
    const t = setInterval(() => {
      api.approval(id).then((v) => {
        if (v.next === 'cosign') return
        clearInterval(t)
        setFamily(v.next === 'ready' ? 'approved' : v.next === 'declined' ? 'declined' : 'expired')
        setTimeout(() => go(v), 1500) // let the status be read before the card moves on
      }).catch(() => undefined)
    }, 2000)
    return () => clearInterval(t)
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  if (step === 'pin') {
    return (
      <View className='card enter-up'>
        <Text className='card-q'>这一步要输入密码</Text>
        <Text className='card-title'>请输入6位密码</Text>
        <View className='row'><TierChip tier={approval.tier} /></View>
        {approval.reasons_zh.map((r) => <Text key={r} className='muted'>· {r}</Text>)}
        {wrong && <Text className='chip chip-red'>■ 密码不对，请再试一次</Text>}
        <PinPad busy={verifying} onComplete={pin} />
        <Tap kind='quiet' onClick={cancel}>取消，不办了</Tap>
      </View>
    )
  }
  if (step === 'wait') return <FamilyCard what={readback} why={approval.reasons_zh} status={family} onCancel={cancel} />
  return <ReadBackCard text={readback} tier={approval.tier} onYes={step === 'busy' ? undefined : yes} onNo={cancel} />
}
