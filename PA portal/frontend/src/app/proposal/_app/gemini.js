/* Gemini-backed proposal summarisation + keynote generation.
 *
 * SECURITY: when VITE_GEMINI_API_KEY is set, the key is bundled into the client
 * and is visible to anyone who loads the page. That is acceptable for a local
 * prototype demo. Before any public deployment, set VITE_GEMINI_PROXY to your
 * own backend endpoint instead — callGemini() posts the same body there, so no
 * other code changes. Never commit a real key.
 *
 * If neither a key nor a proxy is configured, generateKeynote() throws and the
 * caller falls back to localKeynote() — a warm, category-aware message composed
 * on the client. The submission experience is identical either way.
 */

const KEY = process.env.NEXT_PUBLIC_GEMINI_API_KEY
const PROXY = process.env.NEXT_PUBLIC_GEMINI_PROXY
// `gemini-flash-latest` is an alias Google keeps pointed at the current flash
// model, so this won't 404 when a specific version is retired. Override with
// VITE_GEMINI_MODEL (e.g. gemini-2.5-flash) to pin a version.
const MODEL = process.env.NEXT_PUBLIC_GEMINI_MODEL || 'gemini-flash-latest'

export const geminiEnabled = () => Boolean(KEY || PROXY)

// Keep the whole inline request comfortably under Gemini's ~20 MB cap.
const MAX_INLINE = 18 * 1024 * 1024

const pick = (obj, lang) => (obj && (obj[lang] ?? obj.en)) || ''

const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] || '')
    r.onerror = () => reject(new Error('read failed'))
    r.readAsDataURL(file)
  })

// Gemini's REST Schema.Type enum is UPPERCASE (STRING/OBJECT/ARRAY). Lowercase
// values get rejected with a 400, so we spell them out correctly here.
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    focus: { type: 'STRING' },
    beneficiary: { type: 'STRING' },
    highlights: { type: 'ARRAY', items: { type: 'STRING' } },
    keynote: { type: 'STRING' },
  },
  required: ['title', 'keynote', 'highlights'],
}

const buildPrompt = (ctx) => `You are the keynote writer for Nam Kural, the digital channel through which institutions, corporates, associations and unions place proposals before the Hon'ble Minister for Education, Government of Tamil Nadu.

${ctx.org || 'An applicant'} has submitted a proposal to the "${ctx.categoryTitle}" desk. Read the attached proposal document(s) carefully and understand the specific idea being proposed.

Write everything in ${ctx.lang === 'ta' ? 'TAMIL' : 'ENGLISH'}.

Return these fields:
- title: a crisp 4 to 8 word title that names the proposal
- focus: one sentence stating the specific intervention proposed
- beneficiary: who this helps, in 2 to 5 words
- highlights: exactly three short phrases, 2 to 4 words each, capturing the essence
- keynote: a warm, dignified thank-you of 3 to 4 sentences, addressed directly to ${ctx.personName || 'the applicant'}. Name their specific idea and the lives it will touch. Make them feel their contribution genuinely matters to Tamil Nadu. Sincere and grounded, never gushing, no stacked exclamation marks. Wrap the 4 to 6 most important phrases — the specific numbers, places, beneficiaries and the core intervention — in **double asterisks** to mark them for emphasis. Do not emphasise whole sentences, only the key phrases.

Ground every field in what the document actually says. If the document is sparse, infer sensibly from its content and the desk it was sent to. Be specific to THIS proposal — never generic.`

async function callGemini(parts) {
  const url =
    PROXY ||
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.75,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Gemini ${res.status}: ${body.slice(0, 300)}`)
  }
  const data = await res.json()
  const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('')
  return JSON.parse(text)
}

/** Normalise whatever Gemini returned into a stable, trimmed keynote object. */
function clean(out, ctx) {
  const highlights = Array.isArray(out?.highlights)
    ? out.highlights.map((h) => String(h).trim()).filter(Boolean).slice(0, 3)
    : []
  const fb = localKeynote(ctx)
  return {
    title: String(out?.title || fb.title).trim(),
    focus: String(out?.focus || '').trim(),
    beneficiary: String(out?.beneficiary || fb.beneficiary).trim(),
    highlights: highlights.length ? highlights : fb.highlights,
    keynote: String(out?.keynote || fb.keynote).trim(),
    source: 'gemini',
  }
}

/**
 * Read the attached PDFs, summarise them with Gemini, and compose a keynote.
 * Throws if Gemini is not configured or no PDF is usable — callers catch and
 * fall back to localKeynote().
 */
export async function generateKeynote(files, ctx) {
  if (!geminiEnabled()) throw new Error('gemini-disabled')
  const usable = (files || []).filter((f) => f.size <= MAX_INLINE).slice(0, 3)
  if (!usable.length) throw new Error('no-usable-files')

  const parts = []
  for (const f of usable) {
    // eslint-disable-next-line no-await-in-loop
    parts.push({ inlineData: { mimeType: 'application/pdf', data: await fileToBase64(f) } })
  }
  parts.push({ text: buildPrompt(ctx) })

  const out = await callGemini(parts)
  return clean(out, ctx)
}

/* ---------- local fallback ---------- */
/* One warm descriptor per desk, so the keynote is category-aware even with no
   API. Not as specific as reading the PDF, but never generic-sounding. */
const DESK = {
  school: {
    field: { en: 'how Tamil Nadu teaches its children', ta: 'தமிழ்நாடு தன் குழந்தைகளுக்குக் கற்பிக்கும் விதம்' },
    who: { en: 'students across the state', ta: 'மாநிலம் முழுவதும் உள்ள மாணவர்கள்' },
    hi: { en: ['Stronger classrooms', 'Brighter futures', 'Every child counts'], ta: ['வலிமையான வகுப்பறைகள்', 'ஒளிமிகு எதிர்காலம்', 'ஒவ்வொரு குழந்தையும்'] },
  },
  tamil: {
    field: { en: 'the Tamil language and the heritage it carries', ta: 'தமிழ் மொழியும் அது சுமக்கும் பாரம்பரியமும்' },
    who: { en: 'the Tamil people and the generations to come', ta: 'தமிழ் மக்களும் வரும் தலைமுறைகளும்' },
    hi: { en: ['Living language', 'Rooted heritage', 'Carried forward'], ta: ['வாழும் மொழி', 'வேரூன்றிய பாரம்பரியம்', 'தொடரும் பயணம்'] },
  },
  information: {
    field: { en: 'how the government reaches and hears its people', ta: 'அரசு மக்களை அடையும், கேட்கும் விதம்' },
    who: { en: 'every citizen the state speaks to', ta: 'அரசு உரையாடும் ஒவ்வொரு குடிமகனும்' },
    hi: { en: ['Clearer voice', 'Wider reach', 'Open government'], ta: ['தெளிந்த குரல்', 'விரிந்த எட்டல்', 'திறந்த ஆட்சி'] },
  },
  film: {
    field: { en: 'the craft and community of Tamil cinema', ta: 'தமிழ்த் திரையுலகின் கலையும் சமூகமும்' },
    who: { en: 'the artists and workers behind the screen', ta: 'திரைக்குப் பின்னால் உள்ள கலைஞர்களும் தொழிலாளர்களும்' },
    hi: { en: ['Craft honoured', 'Workers protected', 'Stories preserved'], ta: ['கலைக்கு மதிப்பு', 'தொழிலாளர் பாதுகாப்பு', 'கதைகள் பேணல்'] },
  },
}

export function localKeynote(ctx) {
  const d = DESK[ctx.categoryKey] || DESK.school
  const lang = ctx.lang === 'ta' ? 'ta' : 'en'
  const org = ctx.org || (lang === 'ta' ? 'உங்கள் நிறுவனம்' : 'your organisation')
  const name = ctx.personName ? `, ${ctx.personName}` : ''

  return {
    title: lang === 'ta' ? 'உங்கள் முன்மொழிவு, பதிவாகியது' : 'Your proposal, received',
    focus: '',
    beneficiary: pick(d.who, lang),
    highlights: pick(d.hi, lang),
    keynote:
      lang === 'ta'
        ? `நன்றி${name}. **${pick(d.field, 'ta')}** மேம்படுத்த **${org}** முன்வைத்த இந்த முன்மொழிவு இப்போது **அரசுப் பதிவில்** உள்ளது. **${pick(d.who, 'ta')}** சார்பாக, உங்கள் குரலுக்கு தமிழ்நாடு நன்றி சொல்கிறது.`
        : `Thank you${name}. The idea **${org}** has brought forward — to strengthen **${pick(d.field, 'en')}** — is now **on the state's record**. On behalf of **${pick(d.who, 'en')}**, Tamil Nadu is grateful you lent your voice.`,
    source: 'local',
  }
}
