"use client";
import { forwardRef, useEffect, useRef, useState } from 'react'
import { useT, useLang } from '../i18n.jsx'
import { STEPS, MAX_DOCS, MAX_DOC_MB, MAX_TOTAL_MB, OTP_KURAL, KURALS, DEFAULT_KURAL } from '../data.jsx'
import { Valluvar } from './logo.jsx'
import { generateKeynote, localKeynote, geminiEnabled } from '../gemini.js'
import { useBrandFile } from '../brand.jsx'

const PREFIX = { school: 'SCH', tamil: 'TAM', information: 'INF', film: 'FLM' }
const ref5 = () => Math.random().toString(36).slice(2, 7).toUpperCase()

/* Contact-step validation. The phone entered here is the number the OTP is
   sent to, so it must be a real Indian mobile. Accepts an optional +91 / 91
   prefix and spaces/hyphens, then checks for a 10-digit number starting 6–9. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const normalisePhone = (v) => String(v || '').replace(/[\s-]/g, '').replace(/^\+?91/, '')
const isValidPhone = (v) => /^[6-9]\d{9}$/.test(normalisePhone(v))
const isValidEmail = (v) => EMAIL_RE.test(String(v || '').trim())
// A name/org must contain at least one letter (Latin or Tamil) — a purely
// numeric or symbol-only value like "123" is not a name. Kept lenient (allows
// punctuation) since org names legitimately have "." "&" "'" "-".
const isValidName = (v) => /[a-zA-Z஀-௿]/.test(String(v || '').trim())

export function ProposalForm({ open, category, onClose, onChangeDesk, onFiled }) {
  const t = useT()
  const { lang } = useLang()
  const ta = lang === 'ta'

  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState({})
  const [ack, setAck] = useState('')
  const [error, setError] = useState(false)
  const [anim, setAnim] = useState('enter-r')
  const [phase, setPhase] = useState('form')   // form | otp | processing | done | error
  const [tracking, setTracking] = useState('')
  const [stamp, setStamp] = useState('')
  const [keynote, setKeynote] = useState(null)
  const [submitError, setSubmitError] = useState(null) // { message, status? } — surfaced on error phase
  const inputRef = useRef(null)
  const stageRef = useRef(null)

  const s = STEPS[step]
  const last = step === STEPS.length - 1

  /* reset whenever the dialog is opened afresh */
  useEffect(() => {
    if (!open) return
    setStep(0); setAnswers({}); setAck(''); setError(false)
    setAnim('enter-r'); setPhase('form'); setTracking(''); setStamp(''); setKeynote(null)
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [open])

  useEffect(() => {
    if (stageRef.current) stageRef.current.scrollTop = 0
    const id = setTimeout(() => inputRef.current?.focus(), 260)
    return () => clearTimeout(id)
  }, [step, open, phase])

  useEffect(() => {
    if (!open) return
    const onEsc = (e) => e.key === 'Escape' && phase !== 'processing' && onClose()
    addEventListener('keydown', onEsc)
    return () => removeEventListener('keydown', onEsc)
  }, [open, phase, onClose])

  if (!open) return null

  const get = (k) => answers[k] ?? ''
  const put = (k, v) => { setAnswers((a) => ({ ...a, [k]: v })); setError(false) }

  /* slide the card out, swap the question, slide the next one in */
  const glide = (delta) => {
    setAnim(delta > 0 ? 'leave-l' : 'leave-r')
    setTimeout(() => {
      setStep((n) => n + delta)
      setAck(''); setError(false)
      setAnim(delta > 0 ? 'enter-r' : 'enter-l')
    }, 300)
  }

  const docsIdx = STEPS.findIndex((x) => x.key === 'docs')

  /* Flow: org → person → contact → OTP → docs → processing.
     Verifying identity right after the contact details, before the upload. */
  const proceed = () => {
    if (s.key === 'contact') { setPhase('otp'); return }        // contact hands off to OTP
    if (s.key === 'docs') { setPhase('processing'); return }    // docs is the final step
    glide(1)
  }

  // OTP verified → mint the reference, then move on to the document upload
  const onVerified = () => {
    const key = PREFIX[category?.key] || 'GEN'
    setTracking(`NK/${key}/2026/${ref5()}`)
    setStamp(new Date().toLocaleString(ta ? 'ta-IN' : 'en-IN', { dateStyle: 'medium', timeStyle: 'short' }))
    setPhase('form')
    setStep(docsIdx)
    setAnim('enter-r'); setAck(''); setError(false)
  }

  // "change" on the OTP screen walks back to the contact question
  const editPhone = () => {
    setPhase('form')
    setStep(STEPS.findIndex((x) => x.key === 'contact'))
    setAnim('enter-l'); setAck(''); setError(false)
  }

  /* The real work behind the loading bar: read the PDFs, summarise with Gemini,
     compose the keynote. Always resolves to a keynote (local fallback on any
     failure) so the submission experience never breaks. */
  const runKeynote = () => {
    const ctx = {
      categoryKey: category?.key,
      categoryTitle: category ? (ta ? category.title.ta : category.title.en) : '',
      org: answers.org,
      personName: answers.personName,
      lang,
    }
    const files = answers.docs || []
    if (!geminiEnabled()) {
      console.info('[keynote] Gemini not configured (no VITE_GEMINI_API_KEY at build time) — using local keynote.')
      return Promise.resolve(localKeynote(ctx))
    }
    return generateKeynote(files, ctx).catch((e) => {
      console.warn('[keynote] Gemini failed, falling back to local keynote:', e.message || e)
      return localKeynote(ctx)
    })
  }

  // Real backend submission: persist the proposal + its PDFs and queue Gemini
  // extraction for the Minister's Proposal Review. The form fields are the
  // authoritative identity; the server mints the tracking reference (its value
  // replaces the placeholder shown on the success screen).
  //
  // CRITICAL: never swallow the failure. A silent "Success" screen after a
  // 500 tells the citizen their proposal is filed when it isn't — a real
  // data-loss bug. Returns {ok, error?} so the processing → done handoff
  // can route to the error screen instead of green-lighting a phantom.
  const submitProposal = async () => {
    try {
      const fd = new FormData()
      fd.append('category', category?.key || '')
      fd.append('org_name', answers.org || '')
      fd.append('person_name', answers.personName || '')
      fd.append('designation', answers.designation || '')
      fd.append('email', answers.email || '')
      fd.append('phone', normalisePhone(answers.phone))
      ;(answers.docs || []).forEach((f) => fd.append('files', f))
      const res = await fetch('/api/v1/proposal/submit', { method: 'POST', body: fd })
      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        if (data && data.tracking_ref) setTracking(data.tracking_ref)  // server ref wins
        return { ok: true }
      }
      // Try to surface the FastAPI `detail` field so the reason is human-readable.
      let detail = null
      try {
        const body = await res.json()
        detail = body?.detail || body?.error || null
      } catch { /* body wasn't JSON */ }
      return { ok: false, status: res.status, message: detail || `Server returned ${res.status}` }
    } catch (e) {
      return { ok: false, message: e?.message || 'Network error — please check your connection.' }
    }
  }

  // Processing bar drives the real submit first; keynote is animated in
  // parallel afterwards. Returns { ok, keynote?, error? }. Note keynote failure
  // is NOT fatal (we fall back to a local one) — only a submit failure aborts.
  const runSubmitAndKeynote = async () => {
    const submit = await submitProposal()
    if (!submit.ok) return { ok: false, error: submit }
    try {
      const k = await runKeynote()
      return { ok: true, keynote: k }
    } catch {
      // Local keynote fallback — submit succeeded, so the citizen still sees Success.
      return { ok: true, keynote: localKeynote({
        categoryKey: category?.key,
        categoryTitle: category ? (ta ? category.title.ta : category.title.en) : '',
        org: answers.org, personName: answers.personName, lang,
      }) }
    }
  }

  const missing = () => {
    if (s.optional) return false
    if (s.type === 'duo') return s.fields.some((f) => !String(get(f.key)).trim())
    if (s.type === 'files') return !(get(s.key) || []).length
    return !String(get(s.key)).trim()
  }

  const ackValue = () => {
    if (s.type === 'duo') return String(get(s.fields[0].key)).trim()
    if (s.type === 'files') return (get(s.key) || []).length
    return String(get(s.key)).trim()
  }

  const next = () => {
    if (missing()) {
      setError(true)
      setAck(s.type === 'files'
        ? (ta ? 'குறைந்தது ஒரு PDF ஆவணம் இணைக்கவும்.' : 'Attach at least one PDF document to continue.')
        : (ta ? 'இதற்குப் பதில் தேவை.' : 'This one needs an answer before we continue.'))
      inputRef.current?.focus()
      return
    }
    // Name / org must contain letters — reject a purely numeric or symbol value.
    if (s.key === 'org' && !isValidName(get('org'))) {
      setError(true)
      setAck(ta ? 'சரியான பெயரை உள்ளிடவும் (எண்கள் மட்டும் அல்ல).' : 'Please enter a valid name (not only numbers).')
      return
    }
    if (s.key === 'person' && !isValidName(get('personName'))) {
      setError(true)
      setAck(ta ? 'சரியான பெயரை உள்ளிடவும்.' : 'Please enter a valid name.')
      return
    }
    // Contact step: the phone becomes the OTP destination, so validate both
    // fields before we move on to verification.
    if (s.key === 'contact') {
      if (!isValidEmail(get('email'))) {
        setError(true)
        setAck(ta ? 'சரியான மின்னஞ்சல் முகவரியை உள்ளிடவும்.' : 'Please enter a valid email address.')
        return
      }
      if (!isValidPhone(get('phone'))) {
        setError(true)
        setAck(ta
          ? 'சரியான 10 இலக்க கைபேசி எண்ணை உள்ளிடவும் (OTP இந்த எண்ணுக்கே அனுப்பப்படும்).'
          : 'Enter a valid 10-digit mobile number. The OTP is sent to this number.')
        return
      }
    }
    setAck(t(s.ack)(ackValue()))
    setTimeout(proceed, 640)
  }

  const onKey = (e) => {
    if (e.key !== 'Enter') return
    if (s.type === 'area' && !(e.metaKey || e.ctrlKey)) return
    e.preventDefault(); next()
  }

  const fieldCls = (big) =>
    `w-full bg-transparent border-b-2 outline-none py-2.5 transition-colors placeholder:text-white/30 ${
      big ? 'text-[clamp(18px,2vw,25px)]' : 'text-[clamp(16px,1.5vw,20px)]'
    } ${error ? 'border-red-400' : 'border-white/25 focus:border-gold-500'}`

  return (
    <div className="fixed inset-0 z-50 bg-ink-950 text-white flex flex-col overflow-hidden" role="dialog" aria-modal="true">
      <div className="absolute inset-0 form-aura pointer-events-none" aria-hidden="true" />

      {/* ---------- top bar ---------- */}
      {/* In normal flow (shrink-0) with an OPAQUE backdrop, so question cards
          scroll cleanly UNDERNEATH it instead of bleeding through — the header
          no longer overlaps the content on short mobile viewports. */}
      <div className="relative z-20 shrink-0 bg-ink-950/95 backdrop-blur-md px-4 sm:px-6 lg:px-10 pt-4 sm:pt-5 pb-3 sm:pb-4">
        <div className="flex justify-between items-center gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="font-disp font-bold text-[14px] sm:text-[15px] whitespace-nowrap">நம் குரல்</span>
            {category && (
              <span className="hidden sm:flex items-center gap-2.5 rounded-full border border-white/20 bg-white/[0.06] px-3.5 py-1.5 min-w-0 max-w-[38ch]">
                <span className="text-[12.5px] text-white/85 truncate">{t(category.short || category.title)}</span>
                {phase === 'form' && onChangeDesk && (
                  <button onClick={onChangeDesk} className="text-[11px] text-white/45 hover:text-white transition-colors shrink-0">
                    {ta ? 'மாற்று' : 'change'}
                  </button>
                )}
              </span>
            )}
          </div>
          {phase !== 'processing' && (
            <button onClick={onClose} className="pill shrink-0">
              {ta ? 'மூடு ✕' : 'Close ✕'}
            </button>
          )}
        </div>

        {/* segmented progress — OTP sits between contact and docs */}
        {(phase === 'form' || phase === 'otp') && (() => {
          // milestones: org · person · contact · otp · docs
          const cur = phase === 'otp' ? 3 : (s.key === 'docs' ? 4 : step)
          return (
            <div className="flex gap-1.5 mt-4 sm:mt-5">
              {[0, 1, 2, 3, 4].map((i) => (
                <span key={i} className="h-[3px] flex-1 rounded-full bg-white/15 overflow-hidden">
                  <span className={`block h-full rounded-full bg-gold-500 origin-left transition-transform duration-500 ease-out
                    ${i <= cur ? 'scale-x-100' : 'scale-x-0'}`} />
                </span>
              ))}
            </div>
          )
        })()}
      </div>

      {/* ---------- stage ---------- */}
      {/* flex-1 + min-h-0 makes THIS the only scroll region, bounded between the
          top bar and the kural rail. items-start + my-auto centres a short card
          yet lets a tall one (e.g. the contact step) scroll from the top, so its
          Submit button is always reachable on small screens. */}
      <div ref={stageRef} className="relative z-10 flex-1 min-h-0 overflow-y-auto flex items-start justify-center px-5 sm:px-6 lg:px-[8vw] py-7 sm:py-10">

        {phase === 'form' && (
          <div className={`w-full max-w-3xl my-auto qcard ${anim}`}>
            <div className="eyebrow text-gold-400">
              {ta ? 'கேள்வி' : 'Question'} {step + 1} <span className="text-white/35">/ {STEPS.length}</span>
            </div>
            <h2 className="h-display text-[clamp(23px,3.2vw,40px)] mt-3.5 sm:mt-4 mb-2.5">{t(typeof s.q === 'function' ? s.q(answers) : s.q)}</h2>
            <p className="text-white/60 text-[14px] sm:text-[15px] mb-7 sm:mb-9 leading-relaxed max-w-[62ch]">{t(s.help)}</p>

            {s.type === 'text' && (
              <input ref={inputRef} value={get(s.key)} onChange={(e) => put(s.key, e.target.value)} onKeyDown={onKey}
                placeholder={t(s.ph)} className={fieldCls(true)} />
            )}

            {s.type === 'duo' && (
              <div className="grid sm:grid-cols-2 gap-x-8 gap-y-7">
                {s.fields.map((f, i) => (
                  <input key={f.key} ref={i === 0 ? inputRef : null} type={f.inputType || 'text'}
                    value={get(f.key)} onChange={(e) => put(f.key, e.target.value)} onKeyDown={onKey}
                    placeholder={t(f.ph)} className={fieldCls(false)} />
                ))}
              </div>
            )}

            {/* The contact step's phone is the OTP destination — say so up front. */}
            {s.key === 'contact' && (
              <p className="mt-5 flex items-start gap-2.5 text-[13px] sm:text-[13.5px] text-haze-100/85 leading-relaxed">
                <ShieldPhone className="w-[18px] h-[18px] shrink-0 mt-px text-gold-400" />
                <span>
                  {ta
                    ? 'இந்த கைபேசி எண்ணுக்கே OTP அனுப்பப்படும். அடுத்த படியில், ஒரு முறை பயன்படுத்தும் குறியீட்டை (OTP) SMS மூலம் அனுப்புகிறோம்.'
                    : "This mobile number will be used for OTP verification. In the next step, we'll text a one-time code (OTP) to it."}
                </span>
              </p>
            )}

            {s.type === 'files' && (
              <DocDrop ref={inputRef} ta={ta} error={error}
                value={get(s.key) || []}
                onChange={(files) => put(s.key, files)}
                onReject={(msg) => { setError(true); setAck(msg) }} />
            )}

            {/* acknowledgement */}
            <div className="mt-6 min-h-[26px] flex items-center gap-2.5">
              {ack && !error && <Tick className="w-[18px] h-[18px] text-gold-400 shrink-0" />}
              {ack && <p key={ack} className={`text-[14.5px] italic ack-in ${error ? 'text-red-300' : 'text-gold-300'}`}>{ack}</p>}
            </div>

            <div className="flex items-center gap-5 mt-7">
              <button onClick={next} className="btn-gold">
                {last ? (ta ? 'சமர்ப்பி →' : 'Submit proposal →') : (ta ? 'சரி ✓' : 'OK ✓')}
              </button>
              {step > 0 && (
                <button onClick={() => glide(-1)} className="btn-ghost !px-5 !py-3 ml-auto">{ta ? '← பின்' : '← Back'}</button>
              )}
            </div>
          </div>
        )}

        {phase === 'otp' && (
          <OtpGate phone={get('phone')} ta={ta} onVerified={onVerified} onBack={editPhone} />
        )}

        {phase === 'processing' && (
          <Processing run={runSubmitAndKeynote} category={category} ta={ta} t={t}
            onDone={(result) => {
              // A silent Success on a failed submit would be a data-loss lie
              // to the citizen; route to the error screen instead.
              if (!result || !result.ok) {
                setSubmitError(result?.error || { message: 'Submit failed.' })
                setPhase('error')
                return
              }
              setKeynote(result.keynote)
              setPhase('done')
            }} />
        )}

        {phase === 'done' && (
          <Success ta={ta} t={t} category={category} answers={answers} keynote={keynote}
            tracking={tracking} stamp={stamp} onClose={onFiled || onClose} />
        )}

        {phase === 'error' && (
          <SubmitError ta={ta} t={t} err={submitError}
            onRetry={() => { setSubmitError(null); setPhase('processing') }}
            onEdit={() => { setSubmitError(null); setPhase('form'); setStep(docsIdx) }}
            onClose={onClose}
          />
        )}
      </div>

      {/* ---------- kural rail: the chosen category's couplet ---------- */}
      {(phase === 'form' || phase === 'otp') && (
        <KuralRail
          kural={phase === 'otp' ? OTP_KURAL : (KURALS[category?.key] || DEFAULT_KURAL)}
          keyed={phase === 'otp' ? 'otp' : 'form'}
          ta={ta} t={t} />
      )}
    </div>
  )
}

/* ================= DOCUMENT DROP ================= */
const kb = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

const DocDrop = forwardRef(function DocDrop({ value, onChange, onReject, ta, error }, ref) {
  const [over, setOver] = useState(false)
  const picker = useRef(null)

  const take = (list) => {
    const all = Array.from(list || [])
    if (!all.length) return
    const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
    const pdfs = all.filter(isPdf)
    const sized = pdfs.filter((f) => f.size <= MAX_DOC_MB * 1024 * 1024)
    const seen = new Set(value.map((f) => `${f.name}:${f.size}`))
    const fresh = sized.filter((f) => !seen.has(`${f.name}:${f.size}`))
    const room = MAX_DOCS - value.length
    let taken = fresh.slice(0, room)

    // Total-bytes guard mirrors the backend cap so a big submission fails
    // here (with the actual filenames the user picked) rather than late in
    // the wizard with a generic 400 from the server. Accept files greedily
    // from the front of the pick until the running total would exceed the
    // cap; anything after that is rejected with a message that names both
    // limits so the user knows what to do.
    const capBytes = MAX_TOTAL_MB * 1024 * 1024
    const runningBefore = value.reduce((s, f) => s + f.size, 0)
    const accepted = []
    let running = runningBefore
    let overflow = false
    for (const f of taken) {
      if (running + f.size > capBytes) { overflow = true; break }
      accepted.push(f); running += f.size
    }
    taken = accepted

    const notes = []
    if (pdfs.length < all.length) notes.push(ta ? 'PDF கோப்புகள் மட்டுமே ஏற்கப்படும்.' : 'PDF files only.')
    if (sized.length < pdfs.length) notes.push(ta ? `ஒரு கோப்பு ${MAX_DOC_MB} MB-க்குள் இருக்க வேண்டும்.` : `Each file must be under ${MAX_DOC_MB} MB.`)
    if (fresh.length < sized.length) notes.push(ta ? 'சில கோப்புகள் ஏற்கனவே இணைக்கப்பட்டுள்ளன.' : 'Some files were already attached.')
    if (overflow) notes.push(ta
      ? `மொத்த அளவு ${MAX_TOTAL_MB} MB-ஐ மீறுகிறது. குறைவான அல்லது சிறிய கோப்புகளை அனுப்பவும்.`
      : `Total upload would exceed ${MAX_TOTAL_MB} MB. Please send fewer or smaller files.`)
    if (taken.length < fresh.length && !overflow) notes.push(ta ? `அதிகபட்சம் ${MAX_DOCS} ஆவணங்கள்.` : `Maximum ${MAX_DOCS} documents.`)

    if (taken.length) onChange([...value, ...taken])
    if (notes.length) onReject(notes.join(' '))
  }

  const full = value.length >= MAX_DOCS

  return (
    <div>
      <input ref={picker} type="file" accept="application/pdf,.pdf" multiple hidden
        onChange={(e) => { take(e.target.files); e.target.value = '' }} />

      <button ref={ref} type="button" disabled={full}
        onClick={() => picker.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files) }}
        className={`w-full rounded-2xl border border-dashed px-5 sm:px-6 py-8 sm:py-9 text-center transition-all duration-200 outline-none
          ${full ? 'border-white/15 cursor-not-allowed opacity-55'
            : over ? 'border-gold-500 bg-gold-500/10 scale-[1.01]'
              : error ? 'border-red-400/70 hover:border-red-300'
                : 'border-white/30 hover:border-gold-500 hover:bg-white/[0.03] focus-visible:border-gold-500'}`}>
        <Doc className="w-7 h-7 mx-auto mb-3.5 text-gold-400/85" />
        <span className="block font-disp font-semibold text-[13.5px] sm:text-[15px] text-white">
          {full ? (ta ? `${MAX_DOCS} ஆவணங்கள் இணைக்கப்பட்டன` : `${MAX_DOCS} documents attached`)
            : ta ? 'PDF கோப்புகளை இங்கே இழுத்துவிடவும், அல்லது தேர்ந்தெடுக்கச் சொடுக்கவும்'
              : 'Drop PDFs here, or click to browse'}
        </span>
        <span className="block text-[12.5px] text-white/45 mt-1.5">
          {ta
            ? `PDF மட்டுமே · அதிகபட்சம் ${MAX_DOCS} கோப்புகள் · ஒன்று ${MAX_DOC_MB} MB வரை · மொத்தம் ${MAX_TOTAL_MB} MB`
            : `PDF only · up to ${MAX_DOCS} files · ${MAX_DOC_MB} MB each · ${MAX_TOTAL_MB} MB total`}
        </span>
        <span className="block text-[11px] text-white/35 mt-0.5">
          {ta
            ? 'PPT அல்லது Word ஆவணங்களை PDF ஆக மாற்றி பதிவேற்றவும்.'
            : 'For PPT or Word documents, please save as PDF before uploading.'}
        </span>
      </button>

      {value.length > 0 && (
        <ul className="mt-5 rounded-xl border border-white/12 overflow-hidden">
          {value.map((f, i) => (
            <li key={`${f.name}:${f.size}`}
              style={{ animationDelay: `${i * 55}ms` }}
              className={`doc-in flex items-center gap-3 sm:gap-3.5 px-3.5 sm:px-4 py-3 ${i > 0 ? 'border-t border-white/10' : ''}`}>
              <Doc className="w-4 h-4 shrink-0 text-gold-500/80" />
              <span className="text-[13.5px] text-white/90 truncate flex-1 min-w-0">{f.name}</span>
              <span className="text-[11.5px] text-white/40 shrink-0 tabular-nums">{kb(f.size)}</span>
              <button type="button" aria-label={ta ? 'நீக்கு' : 'Remove'}
                onClick={() => onChange(value.filter((_, k) => k !== i))}
                className="text-white/35 hover:text-red-300 transition-colors shrink-0 px-1 text-[15px] leading-none">✕</button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[11.5px] text-white/35 mt-3 tabular-nums">
        {value.length} / {MAX_DOCS} {ta ? 'இணைக்கப்பட்டது' : 'attached'}
      </p>
    </div>
  )
})

/* ================= KURAL RAIL =================
   Sits under every question. Couplet on the left, its meaning on the right. */
function KuralRail({ kural, keyed, ta, t }) {
  // public/brand/valluvar.* (transparent) overrides the drawn icon when present
  const valluvarImg = useBrandFile('valluvar')
  return (
    <div className="relative z-20 shrink-0 border-t border-white/15 bg-ink-900/85 backdrop-blur-md px-4 sm:px-6 lg:px-10 py-3 sm:py-4">
      <div key={keyed} className="fact-in flex items-start gap-3 sm:gap-4 max-w-5xl">
        {valluvarImg ? (
          <span className="w-10 h-10 sm:w-12 sm:h-12 shrink-0 grid place-items-center" title={ta ? 'திருவள்ளுவர்' : 'Thiruvalluvar'}>
            <img src={valluvarImg} alt="Thiruvalluvar" className="w-full h-full object-contain" />
          </span>
        ) : (
          <span className="w-9 h-9 sm:w-10 sm:h-10 shrink-0 rounded-xl border-[1.5px] border-gold-500 grid place-items-center text-gold-400"
                title={ta ? 'திருவள்ளுவர்' : 'Thiruvalluvar'}>
            <Valluvar className="w-[22px] h-[22px] sm:w-6 sm:h-6" />
          </span>
        )}
        <div className="min-w-0 flex-1 sm:flex sm:items-start sm:gap-6">
          <p className="font-disp text-haze-100 text-[12.5px] sm:text-[13.5px] leading-[1.75] shrink-0">
            {kural.lines[0]}<br className="hidden sm:block" />{' '}
            <span className="sm:hidden">{' '}</span>{kural.lines[1]}
          </p>
          <div className="min-w-0 mt-1.5 sm:mt-0 sm:border-l sm:border-white/15 sm:pl-6">
            <p className="text-[12px] sm:text-[12.5px] text-white/65 leading-relaxed hidden sm:block">{t(kural.gloss)}</p>
            <span className="block text-[9.5px] sm:text-[10px] text-gold-400/70 mt-0 sm:mt-1.5 tracking-wide2 uppercase">
              {ta ? `திருக்குறள் ${kural.no}` : `Tirukkural ${kural.no}`} · {t(kural.chapter)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ================= OTP GATE =================
   Real verification: the code is sent by the backend over SMS (APM gateway) via
   POST /api/v1/proposal/otp/request, and checked via /api/v1/proposal/otp/verify.
   The form is shared as a plain link, so this uses the session-less proposal OTP
   endpoints (not the QR-gated citizen ones). In dummy mode (SMS not configured on
   the server) the request returns the code, shown as a dev hint. */
const LEN = 6
const OTP_REQUEST_URL = '/api/v1/proposal/otp/request'
const OTP_VERIFY_URL = '/api/v1/proposal/otp/verify'

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  let data = null
  try { data = await res.json() } catch { /* non-JSON error body */ }
  return { ok: res.ok, status: res.status, data }
}

/** Pull a human message out of FastAPI's { detail } (string or object). */
function detailOf(data, fallback) {
  const d = data && data.detail
  if (typeof d === 'string') return d
  if (d && typeof d === 'object') return d.en || d.message || fallback
  return fallback
}

function OtpGate({ phone, ta, onVerified, onBack }) {
  const mobile = normalisePhone(phone)
  const [code, setCode] = useState(Array(LEN).fill(''))
  // sending | sent | checking | ok | bad | error
  const [state, setState] = useState('sending')
  const [message, setMessage] = useState('')     // server-provided error detail
  const [devCode, setDevCode] = useState(null)    // dummy-mode code hint (no SMS configured)
  const [left, setLeft] = useState(0)
  const [popped, setPopped] = useState(-1)
  const boxes = useRef([])
  const sendingRef = useRef(false)

  const send = async () => {
    if (sendingRef.current) return
    sendingRef.current = true
    setState('sending'); setMessage(''); setDevCode(null); setCode(Array(LEN).fill(''))
    try {
      const { ok, data } = await postJSON(OTP_REQUEST_URL, { mobile_number: mobile })
      if (ok) {
        setState('sent'); setLeft(30)
        if (data && data.otp_code) setDevCode(String(data.otp_code))
        setTimeout(() => boxes.current[0]?.focus(), 60)
      } else {
        setState('error')
        setMessage(detailOf(data, ta ? 'எண்ணை அனுப்ப முடியவில்லை. மீண்டும் முயற்சிக்கவும்.' : 'Could not send the code. Please try again.'))
      }
    } catch {
      setState('error')
      setMessage(ta ? 'இணைப்பு பிழை. மீண்டும் முயற்சிக்கவும்.' : 'Network error. Please try again.')
    } finally {
      sendingRef.current = false
    }
  }

  // Send once on mount.
  useEffect(() => { send() /* eslint-disable-next-line */ }, [])

  useEffect(() => {
    if (left <= 0) return
    const id = setTimeout(() => setLeft((n) => n - 1), 1000)
    return () => clearTimeout(id)
  }, [left])

  const verify = async (entered) => {
    setState('checking')
    try {
      const { ok, data } = await postJSON(OTP_VERIFY_URL, { mobile_number: mobile, otp_code: entered })
      if (ok && data && data.verified) {
        setState('ok')
        setTimeout(onVerified, 1100)
      } else {
        setState('bad')
        setMessage(detailOf(data, ta ? 'எண் பொருந்தவில்லை. மீண்டும் முயற்சிக்கவும்.' : 'That code did not match. Try once more.'))
        setTimeout(() => {
          setCode(Array(LEN).fill('')); setState('sent'); boxes.current[0]?.focus()
        }, 1100)
      }
    } catch {
      setState('bad')
      setMessage(ta ? 'இணைப்பு பிழை. மீண்டும் முயற்சிக்கவும்.' : 'Network error. Please try again.')
      setTimeout(() => { setCode(Array(LEN).fill('')); setState('sent'); boxes.current[0]?.focus() }, 1100)
    }
  }

  const put = (i, raw) => {
    if (state === 'checking' || state === 'ok' || state === 'sending') return
    const digits = raw.replace(/\D/g, '')
    const n = [...code]
    if (!digits) { n[i] = ''; setCode(n); return }
    digits.split('').forEach((d, k) => { if (i + k < LEN) n[i + k] = d })
    setCode(n)
    setPopped(i); setTimeout(() => setPopped(-1), 300)
    const to = Math.min(i + digits.length, LEN - 1)
    boxes.current[to]?.focus()
    const full = n.join('')
    if (full.length === LEN && !n.includes('')) verify(full)
  }

  const onKey = (i, e) => {
    if (e.key === 'Backspace' && !code[i] && i > 0) { e.preventDefault(); boxes.current[i - 1]?.focus() }
    if (e.key === 'ArrowLeft' && i > 0) boxes.current[i - 1]?.focus()
    if (e.key === 'ArrowRight' && i < LEN - 1) boxes.current[i + 1]?.focus()
  }

  const locked = state === 'checking' || state === 'ok' || state === 'sending'

  return (
    <div className="w-full max-w-xl my-auto text-center qcard enter-r">
      <div className="eyebrow text-gold-400 mb-3.5">{ta ? 'கடைசிப் படி' : 'Final step'}</div>
      <h2 className="h-display text-[clamp(23px,3vw,36px)] mb-3">
        {ta ? 'இது நீங்கள்தான் என உறுதி செய்யுங்கள்' : 'Confirm it is really you'}
      </h2>
      <p className="text-white/60 text-[14px] leading-relaxed max-w-[42ch] mx-auto mb-9">
        {state === 'sending'
          ? (ta ? 'சரிபார்ப்பு எண் அனுப்பப்படுகிறது' : 'Sending a six-digit code to')
          : (ta ? 'ஆறு இலக்க எண் SMS மூலம் அனுப்பப்பட்டது' : 'We sent a six-digit code by SMS to')}{' '}
        <b className="text-white/90 tabular-nums">{phone || '—'}</b>.{' '}
        <button onClick={onBack} className="text-gold-400 hover:text-gold-300 underline underline-offset-4 transition-colors">
          {ta ? 'மாற்று' : 'change'}
        </button>
      </p>

      {/* digits */}
      {/* 6 boxes + 5 gaps must clear the narrowest phone (320px minus page padding) */}
      <div className={`flex justify-center gap-1.5 sm:gap-3 ${state === 'bad' ? 'otp-shake' : ''} ${state === 'ok' ? 'otp-ok' : ''}`}>
        {code.map((d, i) => (
          <input
            key={i}
            ref={(el) => (boxes.current[i] = el)}
            value={d}
            onChange={(e) => put(i, e.target.value)}
            onKeyDown={(e) => onKey(i, e)}
            onFocus={(e) => e.target.select()}
            disabled={locked}
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label={`${ta ? 'இலக்கம்' : 'Digit'} ${i + 1}`}
            maxLength={LEN}
            className={`w-[clamp(38px,12vw,58px)] h-[clamp(48px,15vw,68px)] shrink-0 rounded-xl sm:rounded-2xl border-2 bg-white/[0.04]
              text-center font-disp font-bold text-[clamp(18px,5vw,26px)] text-white outline-none tabular-nums
              transition-all duration-200 disabled:opacity-100
              ${popped === i ? 'otp-pop' : ''}
              ${state === 'bad' ? 'border-red-400 text-red-200'
                : state === 'ok' ? 'border-gold-500 bg-gold-500/20 text-gold-200'
                  : d ? 'border-gold-500/70 bg-gold-500/[0.08]'
                    : 'border-white/20 focus:border-gold-500 focus:bg-white/[0.07]'}`}
          />
        ))}
      </div>

      {/* status line — the part the person watches */}
      <div className="mt-7 min-h-[46px] flex flex-col items-center justify-center gap-2">
        {(state === 'sending' || state === 'checking') && (
          <div className="flex items-center gap-2.5 text-white/70 text-[14px]">
            <span className="flex gap-1">
              {[0, 1, 2].map((k) => (
                <span key={k} className="w-1.5 h-1.5 rounded-full bg-gold-400 wait-dot" style={{ animationDelay: `${k * 0.16}s` }} />
              ))}
            </span>
            {state === 'sending'
              ? (ta ? 'எண் அனுப்பப்படுகிறது…' : 'Sending the code…')
              : (ta ? 'சரிபார்க்கிறோம்…' : 'Verifying with the Ministry gateway…')}
          </div>
        )}
        {state === 'ok' && (
          <div className="flex items-center gap-2.5 text-gold-300 text-[15px] font-disp font-semibold ack-in">
            <Tick className="w-5 h-5 text-gold-400" />
            {ta ? 'உறுதி செய்யப்பட்டது. கோப்பு திறக்கப்படுகிறது…' : 'Verified. Opening your file…'}
          </div>
        )}
        {state === 'bad' && (
          <p className="text-red-300 text-[14px] italic ack-in">
            {message || (ta ? 'எண் பொருந்தவில்லை. மீண்டும் முயற்சிக்கவும்.' : 'That code did not match. Try once more.')}
          </p>
        )}
        {state === 'error' && (
          <p className="text-red-300 text-[14px] italic ack-in">{message}</p>
        )}
        {(state === 'sent' || state === 'error') && (
          <p className="text-white/35 text-[13px]">
            {left > 0
              ? (ta ? `${left} வினாடிகளில் மீண்டும் அனுப்பலாம்` : `Resend available in ${left}s`)
              : <button onClick={send} className="text-gold-400 hover:text-gold-300 underline underline-offset-4 transition-colors">
                  {ta ? 'எண்ணை மீண்டும் அனுப்பு' : 'Resend the code'}
                </button>}
          </p>
        )}
      </div>

      {/* Dev hint — only present when the server is in dummy mode (SMS not configured). */}
      {devCode && (
        <p className="text-[11px] text-gold-300/70 mt-8 leading-relaxed">
          {ta ? 'டெவலப்மென்ட்: SMS அமைக்கப்படவில்லை. குறியீடு' : 'Dev mode: SMS not configured. Code is'}{' '}
          <b className="tracking-[0.25em] text-gold-200">{devCode}</b>
        </p>
      )}
    </div>
  )
}

/* ================= PROCESSING =================
   The bar tracks the real Gemini call. It eases toward a target that creeps up
   while the request is in flight, then snaps to 100% the moment the keynote
   arrives — with a short floor so the work always reads as substantial. */
const STAGES = {
  en: ['Securing your document', 'Analyzing key details from the proposal', 'Routing to the Proposal review team'],
  ta: ['ஆவணம் பாதுகாப்பாகப் பெறப்படுகிறது', 'முன்மொழிவிலிருந்து முக்கிய விவரங்கள் பகுப்பாய்வு', 'முன்மொழிவு ஆய்வுக் குழுவிற்கு அனுப்பப்படுகிறது'],
}

function Processing({ run, category, ta, t, onDone }) {
  const [active, setActive] = useState(0)
  const barRef = useRef(null)
  const pctRef = useRef(null)
  const lines = ta ? STAGES.ta : STAGES.en

  useEffect(() => {
    let raf, finished = false, result = null
    const start = performance.now()
    let value = 0

    Promise.resolve(run())
      .then((k) => { result = k })
      .catch(() => { result = null })
      .finally(() => {
        // floor: even a fast response shows a real animation
        const wait = Math.max(0, 2400 - (performance.now() - start))
        setTimeout(() => { finished = true }, wait)
      })

    const lineFor = (v) => (v < 25 ? 0 : v < 75 ? 1 : 2)
    const tick = (now) => {
      const el = now - start
      // asymptotic creep toward 92% while waiting; jump to 100% when done
      const target = finished ? 100 : 92 * (1 - Math.exp(-el / 3200))
      value += (target - value) * 0.045
      const shown = Math.min(value, finished ? 100 : 99)
      if (barRef.current) barRef.current.style.width = `${shown}%`
      if (pctRef.current) pctRef.current.textContent = String(Math.round(shown)).padStart(2, '0')
      setActive(lineFor(shown))
      if (finished && shown > 99.5) { onDone(result); return }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="w-full max-w-xl my-auto text-center qcard enter-r">
      {/* minimal spinner: one thin arc */}
      <div className="relative w-7 h-7 mx-auto mb-7">
        <span className="absolute inset-0 rounded-full border border-white/12" />
        <span className="absolute inset-0 rounded-full border border-transparent border-t-gold-500 seal-spin" />
      </div>

      <div className="eyebrow text-haze-300 mb-3">{ta ? 'செயலாக்கத்தில்' : 'In progress'}</div>
      <h2 className="h-display text-[clamp(22px,2.6vw,32px)] mb-2">
        {ta ? 'உங்கள் முன்மொழிவைப் படித்து புரிந்துகொள்கிறோம்' : 'Reading and understanding your proposal'}
      </h2>
      {category && (
        <p className="text-white/50 text-[13px] mb-9">{ta ? 'செல்லும் இடம்' : 'Routing to'} · {t(category.dept)}</p>
      )}

      {/* bar */}
      <div className="flex items-baseline justify-between mb-2.5">
        <span className="text-[10.5px] uppercase tracking-wide2 text-white/35">{ta ? 'நிலை' : 'Progress'}</span>
        <span className="font-disp text-[12px] text-gold-400 tabular-nums"><span ref={pctRef}>00</span>%</span>
      </div>
      <div className="h-[2px] bg-white/12 overflow-hidden mb-9">
        <div ref={barRef} className="h-full bg-gold-500 w-0" />
      </div>

      {/* live stages */}
      <ul className="text-left space-y-3.5 max-w-md mx-auto">
        {lines.map((line, k) => {
          const done = k < active, live = k === active
          return (
            <li key={k} className={`flex items-center gap-3.5 text-[14px] transition-all duration-500 ${done ? 'text-white/55' : live ? 'text-white' : 'text-white/25'}`}>
              <span className="w-[18px] h-[18px] shrink-0 grid place-items-center">
                {done ? <Tick className="w-[16px] h-[16px] text-gold-500" />
                  : live ? <span className="w-[13px] h-[13px] rounded-full border-2 border-gold-500/30 border-t-gold-500 seal-spin" />
                    : <span className="w-[5px] h-[5px] rounded-full bg-white/25" />}
              </span>
              <span className={live ? 'line-live' : ''}>{line}</span>
            </li>
          )
        })}
      </ul>

      <p className="text-[11.5px] text-white/30 mt-10 tracking-wide2">
        {ta ? 'இந்த சாளரத்தை மூடாதீர்கள்' : 'Please do not close this window'}
      </p>
    </div>
  )
}

/* Split a string into segments, marking runs wrapped in **double asterisks**
   as emphasised. Gemini (and the local fallback) mark key phrases this way. */
function parseEmphasis(text) {
  const out = []
  const re = /\*\*(.+?)\*\*/g
  let last = 0, m
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), em: false })
    out.push({ text: m[1], em: true })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last), em: false })
  return out
}

/* Reveals text one word at a time — the keynote's cascade. Emphasised runs
   render bold-gold. Whitespace tokens are preserved so spacing survives the
   inline-block word spans. */
function Cascade({ text, className = '', base = 0, step = 26, dur = 520 }) {
  let wi = 0
  const segs = parseEmphasis(String(text || ''))
  return (
    <span className={className}>
      {segs.map((seg, si) =>
        seg.text.split(/(\s+)/).map((tok, ti) =>
          tok.trim() === ''
            ? <span key={`${si}-${ti}`}>{tok}</span>
            : (
              <span key={`${si}-${ti}`} className={`word-rise${seg.em ? ' kw-em' : ''}`}
                style={{ animationDelay: `${base + wi++ * step}ms`, animationDuration: `${dur}ms` }}>
                {tok}
              </span>
            )
        )
      )}
    </span>
  )
}

/* ================= SUCCESS =================
   The Gemini keynote is the hero: title, then the thank-you cascading in word
   by word, then the essence as chips. The official record sits beneath it. */
/* Submission failure screen — replaces the phantom Success that used to appear
   on any server / network error. Tells the citizen honestly that the proposal
   was NOT filed, shows a short reason, and offers two escapes: retry the
   submit (files are still in state) or go back to review the documents. */
function SubmitError({ ta, err, onRetry, onEdit, onClose }) {
  const reason = err?.message || (ta ? 'சமர்ப்பிக்க முடியவில்லை.' : 'Submission did not go through.')
  return (
    <div className="w-full max-w-xl my-auto text-center qcard enter-r">
      <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-red-100 text-red-700">
        <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
        </svg>
      </div>
      <h2 className="text-xl font-bold text-slate-900 mb-2">
        {ta ? 'சமர்ப்பிக்க முடியவில்லை' : 'Your proposal was not filed'}
      </h2>
      <p className="text-slate-600 max-w-md mx-auto mb-1">
        {ta
          ? 'உங்கள் ஆவணங்கள் சர்வரில் சேமிக்கப்படவில்லை. மீண்டும் முயற்சிக்கவும்.'
          : 'Your documents were not saved on the server. Please try again — nothing you entered was lost.'}
      </p>
      <p className="text-[13px] text-slate-500 max-w-md mx-auto mb-6">
        <span className="font-semibold">{ta ? 'காரணம்:' : 'Reason:'}</span> {reason}
      </p>
      <div className="flex flex-col sm:flex-row gap-2 justify-center">
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg bg-slate-900 text-white px-5 py-2.5 text-sm font-semibold hover:bg-slate-800"
        >
          {ta ? 'மீண்டும் சமர்ப்பிக்க' : 'Try submitting again'}
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="rounded-lg border border-slate-300 bg-white text-slate-700 px-5 py-2.5 text-sm font-semibold hover:bg-slate-50"
        >
          {ta ? 'ஆவணங்களை மாற்று' : 'Change the documents'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg text-slate-500 px-5 py-2.5 text-sm hover:text-slate-800"
        >
          {ta ? 'மூடு' : 'Close'}
        </button>
      </div>
    </div>
  )
}

function Success({ ta, t, category, answers, keynote, tracking, stamp, onClose }) {
  const [copied, setCopied] = useState(false)
  const k = keynote || {}
  const words = String(k.keynote || '').split(/\s+/).filter(Boolean).length
  // when the keynote finishes cascading, everything below it fades up
  const afterKeynote = 1.5 + Math.min(words, 60) * 0.026

  const docs = answers.docs || []
  const rows = [
    [{ en: 'Organisation', ta: 'நிறுவனம்' }, answers.org],
    [{ en: 'Submitted by', ta: 'சமர்ப்பித்தவர்' }, [answers.personName, answers.designation].filter(Boolean).join(' · ')],
    [{ en: 'Contact', ta: 'தொடர்பு' }, [answers.email, answers.phone].filter(Boolean).join(' · ')],
    [{ en: 'Documents', ta: 'ஆவணங்கள்' }, docs.map((f) => f.name).join(', ')],
    [{ en: 'Routed to', ta: 'செல்லும் இடம்' }, category ? t(category.dept) : ''],
    [{ en: 'Received', ta: 'பெறப்பட்டது' }, stamp],
  ].filter(([, v]) => v)

  const copy = () => {
    navigator.clipboard?.writeText(tracking).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  return (
    <div className="w-full max-w-2xl my-auto text-center">
      {/* seal */}
      <div className="relative w-[104px] h-[104px] mx-auto mb-7">
        <span className="absolute inset-0 rounded-full border border-gold-500/40 ring-pop" />
        <span className="absolute inset-0 rounded-full border border-gold-500/25 ring-pop" style={{ animationDelay: '.18s' }} />
        <span className="absolute inset-0 rounded-full border border-gold-500/15 ring-pop" style={{ animationDelay: '.36s' }} />
        <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full -rotate-90">
          <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="2" className="text-gold-500 draw-ring" />
        </svg>
        <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full">
          <path d="M30 51 L44 65 L71 36" fill="none" stroke="currentColor" strokeWidth="5.5"
            strokeLinecap="round" strokeLinejoin="round" className="text-gold-400 draw-tick" />
        </svg>
      </div>

      <div className="eyebrow text-gold-400 rise" style={{ animationDelay: '.5s' }}>
        {ta ? 'அதிகாரப்பூர்வமாக பதிவு செய்யப்பட்டது' : 'Officially recorded'}
      </div>

      {/* the generated proposal title */}
      {k.title && (
        <h2 className="h-display text-white text-[clamp(24px,3.4vw,40px)] mt-4 mb-1 leading-[1.15]">
          <Cascade text={k.title} base={640} step={44} dur={560} />
        </h2>
      )}
      {k.beneficiary && (
        <p className="text-gold-300/90 text-[13px] tracking-wide2 uppercase mb-7 rise" style={{ animationDelay: '1.0s' }}>
          {ta ? 'இதன் பயன்' : 'For'} · {k.beneficiary}
        </p>
      )}

      {/* the keynote — the emotional centre, cascading in. Given room to breathe
          across the full card width rather than a narrow column. */}
      <p className="keynote-text mx-auto max-w-[54ch] text-[clamp(19px,2.5vw,30px)] leading-[1.6] font-disp text-haze-100">
        <Cascade text={k.keynote} base={950} step={26} dur={520} />
      </p>

      {/* essence chips */}
      {Array.isArray(k.highlights) && k.highlights.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2.5 mt-7">
          {k.highlights.map((h, i) => (
            <span key={i} className="chip-pop rounded-full border border-gold-500/40 bg-gold-500/[0.08] px-4 py-1.5 text-[12.5px] text-gold-200"
              style={{ animationDelay: `${afterKeynote + i * 0.12}s` }}>
              {h}
            </span>
          ))}
        </div>
      )}

      {/* hairline divider into the official record */}
      <div className="flex items-center gap-4 my-9 rise" style={{ animationDelay: `${afterKeynote + 0.5}s` }}>
        <span className="h-px flex-1 bg-white/12" />
        <span className="text-[10px] uppercase tracking-wide2 text-white/35">{ta ? 'அதிகாரப்பூர்வப் பதிவு' : 'On the record'}</span>
        <span className="h-px flex-1 bg-white/12" />
      </div>

      {/* tracking reference */}
      <div className="font-disp font-extrabold text-[clamp(22px,3vw,38px)] text-gold-400 tracking-wide2 rise" style={{ animationDelay: `${afterKeynote + 0.6}s` }}>
        {tracking}
      </div>
      <button onClick={copy} className="text-[11.5px] text-white/40 hover:text-white transition-colors mt-2 tracking-wide2 uppercase rise" style={{ animationDelay: `${afterKeynote + 0.68}s` }}>
        {copied ? (ta ? '✓ நகலெடுக்கப்பட்டது' : '✓ Copied') : (ta ? 'எண்ணை நகலெடு' : 'Copy reference')}
      </button>

      {/* receipt */}
      <div className="mt-8 rounded-2xl border border-white/15 bg-white/[0.03] text-left overflow-hidden rise" style={{ animationDelay: `${afterKeynote + 0.78}s` }}>
        {rows.map(([label, v], i) => (
          <div key={label.en} className={`flex flex-col sm:flex-row sm:flex-wrap gap-x-6 gap-y-1 px-4 sm:px-5 py-3.5 ${i > 0 ? 'border-t border-white/10' : ''}`}>
            <span className="text-[10.5px] uppercase tracking-wide2 text-white/40 sm:w-[118px] shrink-0 sm:pt-0.5">{t(label)}</span>
            <span className="text-[13px] sm:text-[13.5px] text-white/90 flex-1 min-w-0 break-words">{v}</span>
          </div>
        ))}
      </div>

      <div className="mt-10 rise" style={{ animationDelay: `${afterKeynote + 0.95}s` }}>
        <button onClick={onClose} className="btn-gold">{ta ? 'முடிந்தது' : 'Done'}</button>
      </div>
    </div>
  )
}

/* ================= bits ================= */
function Doc({ className = '' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  )
}

function Tick({ className = '' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path d="M4 12.5 L9.5 18 L20 6.5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="draw-tick-sm" />
    </svg>
  )
}

/* Shield with a tick — marks the line telling the citizen their number is used
   for OTP verification. */
function ShieldPhone({ className = '' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2.5 4.5 5.5v5c0 4.4 3.1 7.6 7.5 9 4.4-1.4 7.5-4.6 7.5-9v-5L12 2.5Z" />
      <path d="M9 11.6 11.2 14 15 9.7" />
    </svg>
  )
}
