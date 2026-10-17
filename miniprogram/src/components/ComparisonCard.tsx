import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import type { RulesMap, Structures } from '../services/api'
import { yuan } from './ui'

export const COMPARISON_FOOTER = '这是信息，不是建议 · 请咨询12366'

export function showCitation(ruleIds: string[], rules: RulesMap) {
  const lines = ruleIds.map((id) => {
    const r = rules[id]
    const src = !r || r.citation_url === 'TODO' ? '来源待补充' : r.citation_url
    return `${id}（${r?.status === 'verified' ? '已核实' : '待核实'}）\n${src}`
  })
  Taro.showModal({ title: '规则来源', content: lines.join('\n\n'), showCancel: false })
}

// Four columns do not fit 18px sentences, so each structure is its own card: same three rows in every card.
// One question per card: "what does this way of running the business mean for me?"
export default function ComparisonCard({ data }: { data: Structures }) {
  return (
    <View className='stack'>
      <Text className='card-q'>四种经营方式，一样的三项对比</Text>
      {data.columns.map((col) => (
        <View key={col.key} className='card enter-down'>
          <Text className='card-title'>{col.label_zh}</Text>
          {data.rows.map((row) => {
            const cell = row.cells[col.key]
            return (
              <View key={row.key} className='inset tappable' hoverClass='pressed' hoverStartTime={0} hoverStayTime={100}
                onClick={() => showCitation(cell.rule_ids, data.rules)}>
                <Text className='small muted'>{row.label_zh}</Text>
                {cell.value !== null && <View><Text className='figure'>{yuan(cell.value)}</Text><Text className='unit'>元</Text></View>}
                {cell.status === 'recall'
                  ? <Text className='chip chip-recall'>▲ 待核实</Text>
                  : <Text>{cell.text_zh}</Text>}
                <Text className='small'>规则来源 ⓘ</Text>
              </View>
            )
          })}
        </View>
      ))}
      {data.assumptions.map((a) => <Text key={a} className='note'>· {a}</Text>)}
      <Text className='note'>{COMPARISON_FOOTER}</Text>
    </View>
  )
}
