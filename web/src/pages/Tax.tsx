import { useState } from 'react'
import { Link } from 'react-router-dom'
import { InfoFoot, Term, Tier } from '../components/ui'
import { N } from '../lib/format'
import { useT } from '../lib/i18n'
import { askTaxPot, confirmOrder } from '../state/actions'
import { useApp } from '../state/store'

// the quarter's numbers (2026 Q2, from the seeded sales record)
const RESALE_Q = 22551
const THRESHOLD_Q = 300000
const PLATFORM_Q = 54388
const OWN_Q = 31837
// the last 12 months
const OWN_12 = 135000
const RESALE_12 = 85000

/**
 * My tax situation, answered in the order the owner asks it:
 * 1. Where do I stand this quarter?  2. What is my sales made of?  3. Why do the platforms say more than my record?
 * 4. What do I need to do?  Everything else (the set-up comparison) is one tap away, not in the way.
 */
export default function Tax() {
  const t = useT()
  const taxRule = useApp((s) => s.taxRule)
  const order = useApp((s) => s.orderConfirmed)
  const [compare, setCompare] = useState(false)

  const pctUsed = (RESALE_Q / THRESHOLD_Q) * 100
  const resalePct = Math.round((RESALE_12 / (OWN_12 + RESALE_12)) * 100)
  const todo = (order ? 0 : 1) + (taxRule ? 0 : 1)

  const cell = (text: string, rule: string, tbc?: boolean) => (
    <td className={tbc ? 'tbc' : ''}>
      {tbc ? <Term k="tbc" /> : text}
      <div className="rule">{rule}</div>
    </td>
  )

  return (
    <div className="page pad-ask">
      {/* 1. where do I stand */}
      <div className="card em">
        <div className="eyebrow">{t('2026年第二季度（4–6月）', '2026 Q2 (Apr–Jun)')}</div>
        <div style={{ fontSize: '1.15rem', color: 'var(--ink)', fontWeight: 650 }}>
          {t('按规则，这个季度要交的增值税', 'By the rules, VAT you owe this quarter')}
        </div>
        <div className="big num">{t('0 元', '0 yuan')}</div>
        <div>
          {t('因为您转卖的销售额还没到', 'Because your resale sales are still below the ')}
          <Term k="threshold" />
          {t('。低于门槛，转卖也免征。', '. Below it, resale is exempt too.')}
        </div>
        <div className="gauge" role="img" aria-label={t(`已转卖${N(RESALE_Q)}元，门槛${N(THRESHOLD_Q)}元`, `Resale ${N(RESALE_Q)}, threshold ${N(THRESHOLD_Q)}`)}>
          <b style={{ width: `${Math.max(pctUsed, 3)}%` }} />
        </div>
        <div className="gauge-end">
          <span>{t('已转卖', 'Resold')} <b className="num" style={{ color: 'var(--ink)' }}>{N(RESALE_Q)}</b></span>
          <span>{t('门槛', 'Threshold')} <b className="num" style={{ color: 'var(--ink)' }}>{N(THRESHOLD_Q)}</b></span>
        </div>
        <div className="small">
          {t('所得税：', 'Income tax: ')}
          <Term k="tbc" />
          {t('（还没核对规则，所以不给数字）', ' (we have not checked this rule yet, so no figure)')}
        </div>
        <div className="rule">vat_ann2026_no10_threshold · vat_law_art24_own_produce</div>
      </div>

      {/* 4. what to do — surfaced early because it is what matters */}
      <h2 className="lg">
        {todo > 0 ? t(`有 ${todo} 件事要您处理`, `${todo} thing${todo > 1 ? 's' : ''} for you to do`) : t('都处理好了 ✓', 'All done ✓')}
      </h2>
      <div className="list">
        {!order && (
          <div className="li" style={{ alignItems: 'flex-start', flexDirection: 'column' }}>
            <span>
              <b>{t('确认1笔订单：这是老李家的蜂蜜吗？', 'Confirm 1 order: is this Old Li’s honey?')}</b>
              <br />
              <span className="small">{t('直播间 · 7月20日 · 2罐 · 136元。是邻居的，就算转卖。', 'Livestream · 20 Jul · 2 jars · 136 yuan. If it is a neighbour’s, it counts as resale.')}</span>
            </span>
            <span className="btns" style={{ width: '100%' }}>
              <button className="btn wide" onClick={() => confirmOrder('res')}>{t('是，邻居的', 'Yes, a neighbour’s')}</button>
              <button className="btn wide" onClick={() => confirmOrder('own')}>{t('不是，自家的', 'No, my own')}</button>
            </span>
          </div>
        )}
        {order && (
          <div className="li">
            <span className="grow">
              <b>✓ {t('订单已确认', 'Order confirmed')}</b>
              <br />
              <span className="small">{order === 'res' ? t('记为转卖（老李家的蜂蜜）', 'Marked as resale (Old Li’s honey)') : t('记为自家产的', 'Marked as your own produce')}</span>
            </span>
          </div>
        )}
        <div className="li">
          <span className="grow">
            <b>{taxRule ? '✓ ' : ''}{t('税金罐：每笔转卖收入自动留1%', 'Tax pot: set aside 1% of each resale payout')}</b>
            <br />
            <span className="small">{t('钱还在您账户里，先留着，万一要交税就够用。', 'The money stays in your account, kept ready in case tax is due.')}</span>
          </span>
          {taxRule ? <span className="pill acc">{t('已开启', 'On')}</span> : (<><Tier t="y" /><button className="btn" onClick={askTaxPot}>{t('开启', 'Turn on')}</button></>)}
        </div>
        <Link to="/tax/check" className="li press">
          <span className="grow">
            <b>{t('记一笔新的买卖', 'Record a new purchase or sale')}</b>
            <br />
            <span className="small">{t('一步一步，告诉您这笔算什么', 'Step by step, we tell you what it counts as')}</span>
          </span>
          <span className="chev">›</span>
        </Link>
      </div>

      {/* 2. what is my sales made of */}
      <h2 className="lg">{t('您的销售是什么构成的', 'What your sales are made of')}</h2>
      <div className="card">
        <div className="small">{t('近12个月，共 220,000 元', 'Last 12 months, 220,000 yuan in total')}</div>
        <div className="stackbar" role="img" aria-label={t(`自产${100 - resalePct}%，转卖${resalePct}%`, `Own produce ${100 - resalePct}%, resale ${resalePct}%`)}>
          <i className="seg-own" style={{ width: `${100 - resalePct}%` }} />
          <i className="seg-resale" style={{ width: `${resalePct}%` }} />
        </div>
        <div className="kv"><span><i className="swatch seg-own" />{t('自家养的、自家产的', 'Your own produce')}</span><b className="num" style={{ color: 'var(--ink)' }}>{N(OWN_12)} · {100 - resalePct}%</b></div>
        <div className="kv"><span><i className="swatch seg-resale" /><Term k="resale" />{t('（收邻居的再卖）', ' (bought from neighbours)')}</span><b className="num" style={{ color: 'var(--ink)' }}>{N(RESALE_12)} · {resalePct}%</b></div>
        <div className="small">{t('自家产的，按规则免征增值税。转卖的不在免征里，所以才要留意上面那条“门槛”。', 'Your own produce is VAT-exempt by the rules. Resale is not, which is why the threshold above matters.')}</div>
        <div className="rule">vat_law_art24_own_produce</div>
      </div>

      {/* 3. why do the platforms say more than my record */}
      <h2 className="lg">{t('平台报的，为什么比您的记录多？', 'Why do platforms say more than your record?')}</h2>
      <div className="card">
        <div className="small">{t('平台每个季度，会把您的销售额报给税务局。', 'Every quarter, platforms report your sales to the tax office.')}</div>
        <div className="kv"><span>{t('平台报给税务局的', 'Platforms reported')}</span><b className="num" style={{ color: 'var(--ink)' }}>{N(PLATFORM_Q)}</b></div>
        <div className="kv"><span>{t('您自产的记录', 'Your own-produce record')}</span><b className="num" style={{ color: 'var(--ink)' }}>{N(OWN_Q)}</b></div>
        <div className="kv"><span><b>{t('差额', 'Gap')}</b></span><b className="num" style={{ color: 'var(--ink)' }}>{N(PLATFORM_Q - OWN_Q)}</b></div>
        <div className="small">{t('差的这部分，都是您收邻居蜂蜜再卖的。这不是错误，只是要分开记。', 'The gap is all honey you bought from neighbours and resold. It is not a mistake, it just has to be recorded separately.')}</div>
        <div className="rule">platform_reporting_2025</div>
      </div>

      {/* 5. optional */}
      <button className="li press boxed" onClick={() => setCompare(!compare)} aria-expanded={compare}>
        <span className="grow">
          <b>{t('想了解不同的经营方式吗？', 'Curious about other ways to set up?')}</b>
          <br />
          <span className="small">{t('个人、个体户、合作社、公司，用您的数字对比。只是了解，不是建议。', 'Individual, sole trader, co-op, company, with your numbers. For information, not advice.')}</span>
        </span>
        <span className="chev">{compare ? '▾' : '›'}</span>
      </button>
      {compare && (
        <>
          <div className="tbl-x">
            <table>
              <thead>
                <tr><th></th><th>A {t('个人', 'Individual')}</th><th>B {t('个体户', 'Sole trader')}</th><th>C {t('合作社', 'Co-op')}</th><th>D {t('公司', 'Company')}</th></tr>
              </thead>
              <tbody>
                <tr><th>{t('自家蜂蜜 增值税', 'Own honey: VAT')}</th>{cell(t('免征', 'Exempt'), 'vat_art24')}{cell(t('免征', 'Exempt'), 'vat_art24')}{cell('', 'coop_continuity', true)}{cell(t('免征', 'Exempt'), 'vat_art24')}</tr>
                <tr><th>{t('转卖 增值税', 'Resale: VAT')}</th>{cell(t('门槛内免征', 'Exempt below threshold'), 'vat_no10')}{cell(t('门槛内免征', 'Exempt below threshold'), 'vat_no10')}{cell(t('门槛内免征', 'Exempt below threshold'), 'vat_no10')}{cell('1%', 'vat_no10')}</tr>
                <tr><th>{t('所得税', 'Income tax')}</th>{cell('', 'iit_individual', true)}{cell(t('减半', 'Halved'), 'iit_gtgsh_half')}{cell('', 'coop_iit', true)}{cell(t('约5%', 'about 5%'), 'eit_small_low_profit')}</tr>
              </tbody>
            </table>
          </div>
          <div className="small">{t('每格都标着规则编号。', 'Every cell shows its rule id.')}</div>
        </>
      )}
      <InfoFoot />
    </div>
  )
}
