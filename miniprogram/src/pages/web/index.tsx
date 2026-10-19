import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState } from 'react'
import { Incoming } from '../../components/AgentPanel'
import DemoCard from '../../components/DemoCard'
import TracePanel from '../../components/TracePanel'
import { Tap } from '../../components/ui'
import { ApiError, api } from '../../services/api'
import { getSettings } from '../../utils/settings'
import Chat, { ASK_TEXT } from '../chat'
import { CosignerPanel } from '../cosigner'
import './index.scss'

// Web only (H5): the farmer's phone on the left, the judge panel on the right; under 1024px they become two tabs.
const PRESETS = ['下个月要收蜂蜜了，帮我准备一下', '像去年一样给六家付蜂蜜钱', '给老李转800，蜂蜜钱', ...Object.values(ASK_TEXT)]
const JUDGE_TABS = [['trace', '执行轨迹'], ['demo', '演示工具']] as const
type JudgeTab = typeof JUDGE_TABS[number][0]

export default function Web() {
  const [side, setSide] = useState<'farmer' | 'judge'>('farmer')
  const [tab, setTab] = useState<JudgeTab>('trace')
  const [view, setView] = useState<'judge' | 'family'>('judge') // the right side: the judge panel, or the daughter's phone
  const [send, setSend] = useState<Incoming | null>(null)
  const [reset, setReset] = useState(0) // changing the key starts a fresh farmer session
  const [resetMsg, setResetMsg] = useState('')

  // 重置演示: reseeds the database on the server (and forgets agent sessions), then starts a fresh conversation here.
  const doReset = () => {
    setResetMsg('正在重置…')
    api.demoReset().then(() => {
      setReset(reset + 1)
      setSend(null)
      Taro.eventCenter.trigger('lock')
      setResetMsg('已经恢复到最初的演示状态。')
    }).catch((e) => setResetMsg(e instanceof ApiError && typeof e.data.detail === 'string' ? e.data.detail : '连不上后端，没有重置。'))
  }

  return (
    <View className={`web ${getSettings().reducedMotion ? 'rm' : ''}`}>
      <View className='topbar'>
        <Text className='brand'>元农民</Text>
        <Text className='badge'>模拟账户 · 演示环境</Text>
      </View>
      <View className='side-tabs'>
        {([['farmer', '农户'], ['judge', '评委']] as const).map(([k, l]) => (
          <View key={k} className={`side-tab ${side === k ? 'on' : ''}`} onClick={() => setSide(k)}><Text>{l}</Text></View>
        ))}
      </View>
      <View className='cols'>
        <View className={`col farmer ${side === 'farmer' ? '' : 'away'}`}>
          <Text className='col-label'>农户端</Text>
          <View className='phone'><Chat key={reset} external={send} /></View>
        </View>
        <View className={`col judge ${side === 'judge' ? '' : 'away'}`}>
          <View className='label-row'>
            {([['judge', '评委面板'], ['family', '家人端（女儿的手机）']] as const).map(([k, l]) => (
              <Text key={k} className={`col-label pick ${view === k ? 'on' : ''}`} onClick={() => setView(k)}>{l}</Text>
            ))}
          </View>
          <View className='panel'>
            {view === 'judge' && (
              <View className='judge-tabs'>
                {JUDGE_TABS.map(([k, l]) => <View key={k} className={`judge-tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}><Text>{l}</Text></View>)}
              </View>
            )}
            <View className='judge-body'>
              {view === 'family' && <CosignerPanel hint='这是女儿的手机：她在这里同意或拒绝。演示密码是 654321。' />}
              {view === 'judge' && tab === 'trace' && <TracePanel />}
              {view === 'judge' && tab === 'demo' && (
                <View className='stack'>
                  <Text className='card-q'>预设问题</Text>
                  <Text className='note'>点一下，就像农户自己说了这句话。</Text>
                  <View className='row'>
                    {PRESETS.map((p) => <Tap key={p} kind='secondary' onClick={() => { setSide('farmer'); setSend({ id: Date.now(), text: p, voice: false }) }}>{p}</Tap>)}
                  </View>
                  <Text className='card-q'>演示操作</Text>
                  <DemoCard onChanged={() => Taro.eventCenter.trigger('lock')}>
                    <View className='op'><Tap kind='secondary' wide onClick={doReset}>重置演示</Tap><Text className='note'>清空左边的对话，从头再演一遍。</Text></View>
                  </DemoCard>
                  {resetMsg && <Text className='note'>{resetMsg}</Text>}
                </View>
              )}
            </View>
          </View>
        </View>
      </View>
    </View>
  )
}
