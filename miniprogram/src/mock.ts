// Static mock props for the cards until the agent backend exists. SYNTHETIC data only.
export type Tier = 'green' | 'yellow' | 'red'

export const mockPlan = {
  title: '收蜂蜜前的准备',
  steps: [
    { id: 'n1', label: '预测八九月收购蜂蜜要花多少钱', tier: 'green' as Tier, status: '已预测完', state: 'done' as const },
    { id: 'n2', label: '预留 20,000 元', tier: 'yellow' as Tier, status: '等您确认', state: 'pending' as const },
    { id: 'n3', label: '付给 6 位邻居蜂农', tier: 'red' as Tier, status: '稍后', state: 'pending' as const },
  ],
}

export const mockSupport = {
  name: '农业经营主体流动资金贴息 (模拟)',
  wording: '你可能符合条件 (may qualify)',
  documents: ['营业执照或经营证明', '贷款合同', '利息支付凭证'],
  deadline: '2026-12-31',
}

export const mockReadBack = { text: '付给 李国强 4,250 元，对吗？', tier: 'yellow' as Tier }

export const mockTrace = [
  { step: '语音转文字', detail: '下个月要收蜂蜜了，帮我准备一下' },
  { step: '任务图 (DAG)', detail: 'n1 预测 → n2 预留 → n3 付款' },
  { step: '风险等级', detail: 'red · 新收款人; 需要家人确认' },
  { step: '银行接口调用', detail: 'POST /bank/reserves → 202' },
  { step: '审计哈希', detail: '9f2c…a71e (示例)' },
]
