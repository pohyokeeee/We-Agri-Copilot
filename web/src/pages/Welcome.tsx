import { Link, useNavigate } from 'react-router-dom'
import { LangButton } from '../components/Shell'
import { Tier } from '../components/ui'
import { useT } from '../lib/i18n'
import { markVisited } from '../state/actions'

/** First visit: what the service does, what support the user may get, and who approves before money moves. */
export default function Welcome() {
  const t = useT()
  const nav = useNavigate()
  const start = () => {
    markVisited()
    nav('/')
  }
  const Svc = (p: { to: string; title: string; get: string; say: string; cta: string }) => (
    <div className="card">
      <b style={{ fontSize: '1.25rem', color: 'var(--ink)', letterSpacing: '-0.012em' }}>{p.title}</b>
      <div>{p.get}</div>
      <div className="small">
        {t('可以这样说', 'You can say')}：“{p.say}”
      </div>
      <div className="btns" style={{ marginTop: 'auto' }}>
        <Link to={p.to} className="btn pri wide" onClick={markVisited}>
          {p.cta}
        </Link>
      </div>
    </div>
  )
  return (
    <div style={{ minHeight: '100%', background: 'var(--bg)' }}>
      <header className="topbar">
        <button className="brand" style={{ display: 'inline' }} onClick={start} aria-label={t('回到首页', 'Back to Home')}>
          元农民
        </button>
        <span className="title" />
        <span className="badge-sim">{t('模拟账户', 'Simulated')}</span>
        <LangButton />
      </header>
      <div className="page" style={{ paddingBottom: 48 }}>
        <section className="hero">
          <div className="eyebrow">{t('欢迎来到元农民', 'Welcome to Yuan Nongmin')}</div>
          <h1>{t('您的生意后台，我们来帮您管', 'We run the back office of your farm business')}</h1>
          <p className="muted" style={{ maxWidth: '62ch' }}>
            {t(
              '点一下，或者按住说一句话：帮您看税合不合规、找能领的补贴、备好收购的钱。动钱的事，每一笔都要您点头。',
              'Tap, or hold and say one sentence: we check your tax set-up, find support you may get, and get cash ready for the buying season. Nothing moves money without your OK.',
            )}
          </p>
        </section>

        <h2 className="lg">{t('我们能帮您做的 4 件事', '4 things we do for you')}</h2>
        <div className="grid2">
          <Svc
            to="/tax/check"
            title={t('税务合规', 'Tax compliance')}
            get={t('买了或卖了东西，告诉我们。我们按规则告诉您这笔算什么、合不合规、要不要留税金。', 'Tell us what you bought or sold. We show what it counts as under the rules and whether to set tax aside.')}
            say={t('我收了老李的蜂蜜，要交税吗？', 'I bought Old Li’s honey, do I owe tax?')}
            cta={t('开始税务检查', 'Start a tax check')}
          />
          <Svc
            to="/support"
            title={t('补贴和便宜贷款', 'Subsidies and cheaper loans')}
            get={t('您可能领到：耕地补贴每亩100元 · 贷款利息补一半（最多5,000元）· 加入合作社最多20,000元。', 'You may get: 100 yuan per mu farmland subsidy · half your loan interest back (up to 5,000) · up to 20,000 if you join a co-op.')}
            say={t('有什么补贴我能申请？', 'Any subsidies I can apply for?')}
            cta={t('看我能领什么', 'See what I may get')}
          />
          <Svc
            to="/season"
            title={t('收购前备好钱', 'Cash ready for buying season')}
            get={t('收邻居蜂蜜前，提前告诉您钱够不够；不够的话给您一个办法。', 'Before you buy neighbours’ honey, we tell you early whether the cash is enough, and what to do if not.')}
            say={t('收蜂蜜的钱够不够？', 'Will I have enough to buy the honey?')}
            cta={t('看看够不够', 'Check my cash')}
          />
          <Svc
            to="/pay"
            title={t('安全付款', 'Safe payments')}
            get={t('给邻居付蜂蜜钱。金额大或第一次付的人，要您和家人一起确认。', 'Pay neighbours for honey. Large amounts or first-time payees need you and your family to confirm.')}
            say={t('给老李转800，蜂蜜钱', 'Pay Old Li 800 for honey')}
            cta={t('去付款', 'Make a payment')}
          />
        </div>

        <h2 className="lg">{t('怎么用', 'How it works')}</h2>
        <div className="list">
          {[
            [t('告诉我们您的买卖', 'Tell us what you bought or sold'), t('点选项，或者按住屏幕下面的“按住说话”直接说。', 'Tap an option, or hold “Hold to talk” at the bottom and just say it.')],
            [t('我们按规则算给您看', 'We check it against the rules'), t('每个数字都写着来自哪条规则。', 'Every number shows which rule it comes from.')],
            [t('动钱前您来确认', 'You confirm before money moves'), t('新的人或大额，家人也要确认。', 'New people or large amounts also need your family.')],
          ].map((s, i) => (
            <div key={i} className="li">
              <b className="mid" style={{ width: 34 }}>{i + 1}</b>
              <span className="grow">
                <b>{s[0]}</b>
                <br />
                <span className="small">{s[1]}</span>
              </span>
            </div>
          ))}
        </div>

        <div className="card">
          <b style={{ color: 'var(--ink)' }}>{t('动钱前要谁同意', 'Who approves before money moves')}</b>
          <div className="legendrow"><Tier t="g" /><span className="small">{t('查看、计算', 'Looking and calculating')}</span></div>
          <div className="legendrow"><Tier t="y" /><span className="small">{t('熟人、小额付款', 'Known people, small amounts')}</span></div>
          <div className="legendrow"><Tier t="r" /><span className="small">{t('新的人、一天超过1,000元、大额', 'New people, over 1,000 a day, large amounts')}</span></div>
        </div>

        <div className="row">
          <span className="chip static">{t('模拟账户', 'Simulated account')}</span>
          <span className="chip static">{t('信息，不是建议', 'Information, not advice')}</span>
          <span className="chip static">{t('每一步都有记录', 'Every step is recorded')}</span>
        </div>
        <div className="btns">
          <button className="btn pri lg" onClick={start}>{t('开始使用', 'Get started')}</button>
        </div>
      </div>
    </div>
  )
}
