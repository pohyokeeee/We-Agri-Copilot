import { AnimatePresence, motion, useDragControls, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { GLOSSARY } from '../data/mock'
import { useT } from '../lib/i18n'
import { closeSheet, pressPin, sheetDone, sheetOk } from '../state/actions'
import { uiStore, useApp, useUi } from '../state/store'
import type { SheetState } from '../state/types'
import { setRole } from '../state/role'
import { Tier } from './ui'

/**
 * A bottom sheet that behaves like a physical object (Apple, "Designing Fluid Interfaces"):
 * - it moves in and out along the same path (up from the bottom, back down), with a spring (response ~0.3-0.4s);
 * - it can be grabbed at any moment by its handle and follows the finger 1:1;
 * - on release, the finger's velocity is projected forward to decide whether to dismiss, so a flick works;
 * - with reduced motion it cross-fades instead.
 */
export function Modal(props: { onDismiss: () => void; children: ReactNode; label: string; draggable?: boolean }) {
  const reduce = useReducedMotion()
  const controls = useDragControls()
  const project = (v: number, d = 0.99) => ((v / 1000) * d) / (1 - d)
  return (
    <motion.div
      className="scrim"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduce ? 0.15 : 0.25 }}
      onPointerDown={(e) => e.target === e.currentTarget && props.draggable !== false && props.onDismiss()}
    >
      <motion.div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={props.label}
        initial={reduce ? { opacity: 0 } : { y: '100%' }}
        animate={{ y: 0, opacity: 1 }}
        exit={reduce ? { opacity: 0 } : { y: '100%' }}
        transition={reduce ? { duration: 0.15 } : { type: 'spring', bounce: 0.18, duration: 0.42 }}
        drag={reduce || props.draggable === false ? false : 'y'}
        dragControls={controls}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0.04, bottom: 0.7 }}
        onDragEnd={(_, info) => {
          if (info.offset.y + project(info.velocity.y) > 140) props.onDismiss()
        }}
      >
        <div className="grab" onPointerDown={(e) => controls.start(e)} style={{ touchAction: 'none', cursor: 'grab' }} aria-hidden />
        {props.children}
      </motion.div>
    </motion.div>
  )
}

function InfoSheet({ k }: { k: string }) {
  const t = useT()
  const g = GLOSSARY[k]
  const close = () => uiStore.update((u) => void (u.info = null))
  if (!g) return null
  return (
    <Modal label={g.title[0]} onDismiss={close}>
      <div className="mid">{t(g.title[0], g.title[1])}</div>
      <p style={{ fontSize: '1.15rem' }}>{t(g.body[0], g.body[1])}</p>
      <button className="btn pri lg" onClick={close}>
        {t('知道了', 'Got it')}
      </button>
    </Modal>
  )
}

function ApprovalSheet({ s }: { s: SheetState }) {
  const t = useT()
  const locked = useApp((a) => a.locked)
  const nav = useNavigate()
  if (locked && s.step !== 'locked') {
    return (
      <Modal label="locked" onDismiss={closeSheet}>
        <div className="mid">{t('账户已锁定', 'Account locked')}</div>
        <p>{t('现在不能转账或预留。查询还能用。要解锁，请家人和工作人员一起核实。', 'Payments and set-asides are blocked. Looking things up still works. Unlocking needs your family and a staff member.')}</p>
        <button className="btn pri lg" onClick={closeSheet}>
          {t('知道了', 'OK')}
        </button>
      </Modal>
    )
  }
  const red = s.tier === 'r'
  const order = red ? (s.fam ? ['pin', 'done'] : ['readback', 'pin', 'family', 'done']) : ['readback', 'done']
  const idx = Math.max(0, order.indexOf(s.step))
  const onDismiss = s.step === 'done' ? sheetDone : closeSheet
  return (
    <Modal label="approval" onDismiss={onDismiss}>
      <div className="kv">
        <b style={{ color: 'var(--ink)', fontSize: '1.1rem' }}>{red ? t('要您和家人确认', 'You and your family confirm') : t('要您确认', 'Please confirm')}</b>
        {s.step !== 'locked' && <span className="small">{t(`第${idx + 1}步，共${order.length}步`, `Step ${idx + 1} of ${order.length}`)}</span>}
      </div>
      <div className="steps">
        {order.map((_, i) => (
          <span key={i} className={i <= idx ? 'on' : ''} />
        ))}
      </div>

      {s.step === 'readback' && (
        <>
          <div className="readback">
            {t(s.zh, s.en)}
            {t('。对吗？', '. Is that right?')}
          </div>
          {s.raised ? (
            <div className="row">
              <Tier t="y" /> → <Tier t="r" />
              <span className="small">{t('原因：' + s.raised[0], 'Reason: ' + s.raised[1])}</span>
            </div>
          ) : (
            <div className="row">
              <Tier t={s.tier} />
            </div>
          )}
          <div className="btns">
            <button className="btn pri wide lg" onClick={sheetOk}>
              {t('对，确认', 'Yes, confirm')}
            </button>
            <button className="btn wide lg" onClick={closeSheet}>
              {t('不对，取消', 'No, cancel')}
            </button>
          </div>
        </>
      )}

      {s.step === 'pin' && (
        <>
          {s.fam && <div className="readback" style={{ fontSize: '1.05rem' }}>{t('同意：', 'Approve: ')}{t(s.zh, s.en)}</div>}
          <div style={{ fontSize: '1.15rem', fontWeight: 650 }}>{s.fam ? t('请输入您（王小丽）的6位密码', 'Enter your (Wang Xiaoli’s) 6-digit PIN') : t('请输入6位密码', 'Enter your 6-digit PIN')}</div>
          <div className="pins" aria-label={`${s.pin.length}/6`}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <i key={i} className={i < s.pin.length ? 'f' : ''} />
            ))}
          </div>
          {s.err && (
            <div className="err" role="alert" style={{ textAlign: 'center' }}>
              {s.err}
            </div>
          )}
          <div className="pad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) =>
              k ? (
                <button key={`k${k}`} onClick={() => pressPin(k)} aria-label={k === '⌫' ? t('删除', 'Delete') : k}>
                  {k}
                </button>
              ) : (
                <span key={`s${i}`} />
              ),
            )}
          </div>
          <div className="small">{t('输错3次会锁定 · 模拟账户的密码：王大叔 123456，女儿 654321', '3 wrong tries locks the account · PINs on this simulated account: Uncle Wang 123456, daughter 654321')}</div>
          <button className="btn" onClick={closeSheet}>
            {t('取消', 'Cancel')}
          </button>
        </>
      )}

      {s.step === 'family' && (
        <>
          <div style={{ fontSize: '1.2rem', fontWeight: 650 }}>{t('已发给女儿王小丽，等她同意', 'Sent to your daughter Wang Xiaoli for her OK')}</div>
          <p>{t('她在自己的手机上同意后，就会自动完成，结果会通知您。', 'Once she approves on her own phone, it completes by itself and you are told.')}</p>
          <button className="btn pri lg" onClick={closeSheet}>
            {t('好的', 'OK')}
          </button>
          <button
            className="btn lg"
            onClick={() => {
              closeSheet()
              setRole('family')
            }}
          >
            {t('切换到家人账号', 'Switch to the family account')}
          </button>
        </>
      )}

      {s.step === 'locked' && (
        <>
          <div className="mid err">{t('密码错了3次，账户已锁定', '3 wrong PINs: the account is locked')}</div>
          <p>{t('查询还能用。要解锁，请家人和工作人员一起核实。', 'Look-ups still work. Unlocking needs your family and a staff member.')}</p>
          <button className="btn pri lg" onClick={closeSheet}>
            {t('知道了', 'OK')}
          </button>
        </>
      )}

      {s.step === 'done' && (
        <>
          <div className="mid">✓ {t('已完成', 'Done')}</div>
          {s.before && (
            <div className="kv">
              <span>{t('余额', 'Balance')}</span>
              <b style={{ color: 'var(--ink)' }}>
                {s.before} → {s.after}
              </b>
            </div>
          )}
          <button className={`btn lg ${s.fam ? '' : 'pri'}`} onClick={sheetDone}>
            {t('好的', 'OK')}
          </button>
          {s.fam && (
            <button
              className="btn pri lg"
              onClick={() => {
                sheetDone()
                setRole('farmer')
                if (location.pathname === '/family') nav('/')
              }}
            >
              {t('切换回王建国', 'Switch back to Uncle Wang')}
            </button>
          )}
        </>
      )}
    </Modal>
  )
}

export function Overlays() {
  const sheet = useUi((u) => u.sheet)
  const info = useUi((u) => u.info)
  return (
    <AnimatePresence>
      {info ? <InfoSheet key="info" k={info} /> : sheet ? <ApprovalSheet key="sheet" s={sheet} /> : null}
    </AnimatePresence>
  )
}
