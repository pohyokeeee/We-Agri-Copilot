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

export const mockReadBack = { text: '付给 李国强 4,250 元，对吗？', tier: 'yellow' as Tier }
