import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import type { RulesMap, Structures } from '../services/api'

// The footer is not a prop on purpose: these cards must never render without it.
export const COMPARISON_FOOTER = '这是信息，不是建议 · 请咨询12366'

export function showCitation(ruleIds: string[], rules: RulesMap) {
  const lines = ruleIds.map((id) => {
    const r = rules[id]
    const src = !r || r.citation_url === 'TODO' ? '来源待补充' : r.citation_url
    return `${id}（${r?.status === 'verified' ? '已核实' : '待核实'}）\n${src}`
  })
  Taro.showModal({ title: '规则来源', content: lines.join('\n\n'), showCancel: false })
}

// Four columns A-D do not fit real sentences on a phone, so each row is a block with one line per structure.
export default function ComparisonCard({ data }: { data: Structures }) {
  return (
    <View className='card'>
      <Text className='card-title'>四种经营方式对比</Text>
      {data.rows.map((row) => (
        <View key={row.key} className='card'>
          <Text className='card-title'>{row.label_zh}</Text>
          {data.columns.map((col) => {
            const cell = row.cells[col.key]
            return (
              <View key={col.key} onClick={() => showCitation(cell.rule_ids, data.rules)} style={{ minHeight: 'var(--tap-min)' }}>
                <Text className='small'>{col.label_zh}：</Text>
                <Text>{cell.text_zh}</Text>
                <Text> ⓘ</Text>
              </View>
            )
          })}
        </View>
      ))}
      {data.assumptions.map((a) => <Text key={a} className='small'>· {a}</Text>)}
      <Text className='footer-note'>{COMPARISON_FOOTER}</Text>
    </View>
  )
}
