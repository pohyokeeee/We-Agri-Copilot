import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState } from 'react'
import { Incoming } from '../../components/AgentPanel'
import DemoCard from '../../components/DemoCard'
import TracePanel from '../../components/TracePanel'
import { Tap } from '../../components/ui'
import { getSettings } from '../../utils/settings'
import Chat, { ASK_TEXT } from '../chat'
import { CosignerPanel } from '../cosigner'
import './index.scss'

// Web only (H5): the farmer's phone on the left, the judge panel on the right; under 1024px they become two tabs.
const PRESETS = ['下个月要收蜂蜜了，帮我准备一下', '像去年一样给六家付蜂蜜钱', '给老李转800，蜂蜜钱', ...Object.values(ASK_TEXT)]
const JUDGE_TABS = [['trace', '执行轨迹 Trace'], ['cosign', '家人确认 Co-signer'], ['demo', '演示工具 Demo tools']] as const
type JudgeTab = typeof JUDGE_TABS[number][0]

export default function Web() {
  const [side, setSide] = useState<'farmer' | 'judge'>('farmer')
  const [tab, setTab] = useState<JudgeTab>('trace')
  const [send, setSend] = useState<Incoming | null>(null)
  const [reset, setReset] = useState(0) // changing the key starts a fresh farmer session
  const [resetMsg, setResetMsg] = useState('')

  // 重置演示: the backend has no reset endpoint (seed is a CLI), so this clears the on-screen conversation only.
  const doReset = () => { setReset(reset + 1); setSend(null); setResetMsg('已清空对话 Conversation cleared. To restore data: python -m seed.seed') }

  return (
    <View className={`web ${getSettings().reducedMotion ? 'rm' : ''}`}>
      <View className='topbar'>
        <Text className='brand'>元农民 We-Agri-Copilot</Text>
        <Text className='badge'>模拟账户 · 演示环境 Simulated accounts · demo</Text>
      </View>
      <View className='side-tabs'>
        {([['farmer', '农户'], ['judge', '评委']] as const).map(([k, l]) => (
          <View key={k} className={`side-tab ${side === k ? 'on' : ''}`} onClick={() => setSide(k)}><Text>{l}</Text></View>
        ))}
      </View>
      <View className='cols'>
        <View className={`col farmer ${side === 'farmer' ? '' : 'away'}`}>
          <Text className='col-label'>农户端</Text>
          <View className='phone'><View className='phone-scroll'><Chat key={reset} external={send} /></View></View>
        </View>
        <View className={`col judge ${side === 'judge' ? '' : 'away'}`}>
          <Text className='col-label'>评委面板 Judge panel</Text>
          <View className='judge-tabs'>
            {JUDGE_TABS.map(([k, l]) => <View key={k} className={`judge-tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}><Text>{l}</Text></View>)}
          </View>
          <View className='judge-body'>
            {tab === 'trace' && <TracePanel />}
            {tab === 'cosign' && <CosignerPanel hint='演示：家人密码 Demo co-signer PIN 654321' />}
            {tab === 'demo' && (
              <View className='stack'>
                <Text className='card-q'>演示脚本 Demo script（点一下，替农户说）</Text>
                <View className='row'>
                  {PRESETS.map((p) => <Tap key={p} kind='secondary' onClick={() => { setSide('farmer'); setSend({ id: Date.now(), text: p, voice: false }) }}>{p}</Tap>)}
                </View>
                <DemoCard onChanged={() => Taro.eventCenter.trigger('lock')} />
                <Tap kind='secondary' wide onClick={doReset}>重置演示 Reset demo</Tap>
                {resetMsg && <Text className='note'>{resetMsg}</Text>}
              </View>
            )}
          </View>
        </View>
      </View>
    </View>
  )
}
