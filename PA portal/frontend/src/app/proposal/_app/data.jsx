/* Nam Kural — Office of the Hon'ble Minister for Education, Government of Tamil Nadu.
   PROTOTYPE. Statistics carry their source inline. Imagery: Wikimedia Commons (CC);
   selected frames AI-enhanced (Higgsfield 4K upscale). See footer disclaimer.
   Tirukkural couplets should be proof-read against a canonical edition before launch. */

const wm = (file) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=1600`

export const IMG = {
  // enhanced via Higgsfield upscale (URLs patched post-processing)
  fort: 'https://d8j0ntlcm91z4.cloudfront.net/user_3G1sgX3CkLyrb0SH3O2EFMloWoI/hf_20260729_155518_e09d0530-26db-48c1-be64-ebf4256c37ee_min.webp',
  metro: 'https://d8j0ntlcm91z4.cloudfront.net/user_3G1sgX3CkLyrb0SH3O2EFMloWoI/hf_20260729_155511_eefc755a-2c61-40b8-8edb-7efa39502879_min.webp',
  kids: 'https://d8j0ntlcm91z4.cloudfront.net/user_3G1sgX3CkLyrb0SH3O2EFMloWoI/hf_20260729_155513_1f7af077-885d-469a-a05e-9d76bc3b5616_min.webp',
  central: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/ff/Chennai_Central_%28Front_Entrance_at_Night_time%29.jpg/1920px-Chennai_Central_%28Front_Entrance_at_Night_time%29.jpg',
  // Replace the former CM portrait slide. Wikimedia Commons (CC BY-SA 4.0),
  // same sourcing as the plates above. To use the office's own photography
  // instead, drop files in public/proposal/hero/ and point these at
  // '/proposal/hero/<file>.jpg' (see the README there).
  smartclass: wm('Students_at_a_school_in_Bangalore,_India_learning_to_code_on_Progate.jpg'), // students at computers — a "smart class"
  shore:      wm('Front_View_of_Shore_Temple.jpg'),  // Shore Temple, Mamallapuram
  // one plate per portfolio
  classroom: wm('Tamil_Nadu_school_kids.jpg'),          // School Education
  valluvar:  wm('Thiruvalluvar_Statue_at_Kanyakumari_02.jpg'), // Tamil, Culture & Archaeology
  rotary:    wm('Cylindrical_stereotype_for_Rotary_printing_press.jpg'), // Information & Publicity
  theatre:   wm('Udayam_theatre,_Ashok_Nagar,_Chennai.jpg'),   // Film
  filmset:   wm('"Madras_Movie_Studio,_Set-Making_Room"_(BOND_0403).jpg'),
  // alternates, kept for easy swapping
  keeladi:   wm('Keeladi_Excavation_Camp.jpg'),
  radio:     wm('Chennai_All_India_Radio_auditorium_on_16th_december_2011..jpg'),
}

export const SLIDES = [
  { img: 'fort', pos: 'center', cap: { en: 'Fort St. George, Chennai · Seat of the Government of Tamil Nadu', ta: 'புனித ஜார்ஜ் கோட்டை, சென்னை · தமிழ்நாடு அரசின் தலைமையகம்' } },
  { img: 'kids', pos: 'center', cap: { en: 'Tomorrow begins in a classroom · 4,00,000 graduates a year start here', ta: 'நாளை ஒரு வகுப்பறையில் தொடங்குகிறது · ஆண்டுக்கு 4 லட்சம் பட்டதாரிகள்' } },
  { img: 'smartclass', pos: 'center', cap: { en: 'Smart classrooms across Tamil Nadu · Every child, a window to the world', ta: 'தமிழ்நாட்டின் நவீன வகுப்பறைகள் · ஒவ்வொரு குழந்தைக்கும் உலகை நோக்கிய ஒரு சாளரம்' } },
  { img: 'shore', pos: 'center', cap: { en: 'Shore Temple, Mamallapuram · A heritage that outlasts the centuries', ta: 'கடற்கரைக் கோயில், மாமல்லபுரம் · நூற்றாண்டுகளைத் தாண்டி நிற்கும் பாரம்பரியம்' } },
  { img: 'metro', pos: 'center', cap: { en: 'Chennai Metro, Guindy · World-class mobility for every citizen', ta: 'சென்னை மெட்ரோ, கிண்டி · ஒவ்வொரு குடிமகனுக்கும் உலகத்தரம்' } },
  { img: 'central', pos: 'center', cap: { en: 'Chennai Central at night · A state always in motion', ta: 'சென்னை சென்ட்ரல் · எப்போதும் இயங்கும் மாநிலம்' } },
]

/* ================= THE SEVEN PORTFOLIOS =================
   The desks a proposal can land on, matching the Minister's portfolios.
   `short` is the collapsed spine label; `title` is the full name shown when
   the card opens. `dept` drives the routing line in the submission sequence. */
export const CATEGORIES = [
  {
    key: 'school', img: 'classroom', pos: 'center 35%', plate: 'school', credit: 'Photo: Wikimedia Commons (CC)',
    dept: { en: 'Department of School Education', ta: 'பள்ளிக் கல்வித் துறை' },
    short: { en: 'School Education', ta: 'பள்ளிக் கல்வி' },
    title: { en: 'School Education', ta: 'பள்ளிக் கல்வி' },
    tag: { en: 'Primary to higher secondary', ta: 'தொடக்கம் முதல் மேல்நிலை வரை' },
    blurb: {
      en: 'Management and administration of primary, middle, high and higher secondary schools across the state. Proposals that strengthen how Tamil Nadu teaches are received here.',
      ta: 'மாநிலம் முழுவதும் தொடக்க, நடுநிலை, உயர்நிலை, மேல்நிலைப் பள்ளிகளின் நிர்வாகம். தமிழ்நாடு கற்பிக்கும் விதத்தை வலுப்படுத்தும் முன்மொழிவுகள் இங்கே.',
    },
    types: [
      { en: 'School infrastructure & digital classrooms', ta: 'பள்ளி உள்கட்டமைப்பு & டிஜிட்டல் வகுப்பறைகள்' },
      { en: 'Teacher training & curriculum design', ta: 'ஆசிரியர் பயிற்சி & பாடத்திட்டம்' },
      { en: 'Scholarships & student welfare', ta: 'உதவித்தொகை & மாணவர் நலன்' },
      { en: 'Industry–school partnerships', ta: 'தொழில்–பள்ளி கூட்டாண்மை' },
    ],
  },
  {
    key: 'tamil', img: 'valluvar', pos: 'center 6%', plate: 'tamil', credit: 'Photo: Wikimedia Commons (CC)',
    dept: { en: 'Dept. of Tamil Development, Culture & Archaeology', ta: 'தமிழ் வளர்ச்சி, பண்பாடு & தொல்லியல் துறை' },
    short: { en: 'Tamil & Heritage', ta: 'தமிழ் & பாரம்பரியம்' },
    title: { en: 'Tamil Language, Culture and Archaeology', ta: 'தமிழ் மொழி, பண்பாடு மற்றும் தொல்லியல்' },
    tag: { en: 'Language, culture, excavation', ta: 'மொழி, பண்பாடு, அகழாய்வு' },
    blurb: {
      en: 'Promotion, development and administrative implementation of Tamil as the official language, alongside the cultural programmes that carry it forward — and the state excavation sites, artefact preservation and historical research that recover its past.',
      ta: 'ஆட்சிமொழியாகத் தமிழை வளர்த்து, மேம்படுத்தி, நிர்வாகத்தில் நடைமுறைப்படுத்துதல்; அதனுடன் பண்பாட்டுத் திட்டங்கள். மாநில அகழாய்வுத் தளங்கள், தொல்பொருள் பாதுகாப்பு, வரலாற்று ஆய்வும் இதில் அடங்கும்.',
    },
    types: [
      { en: 'Tamil in administration, e-governance & language technology', ta: 'நிர்வாகத்தில் தமிழ், மின்னாட்சி & மொழித் தொழில்நுட்பம்' },
      { en: 'Literature, publishing & classical Tamil', ta: 'இலக்கியம், பதிப்பு & செம்மொழித் தமிழ்' },
      { en: 'Cultural festivals & performing arts', ta: 'பண்பாட்டு விழாக்கள் & கலை நிகழ்வுகள்' },
      { en: 'Excavation, artefact conservation & museums', ta: 'அகழாய்வு, தொல்பொருள் பேணல் & அருங்காட்சியகங்கள்' },
    ],
  },
  {
    key: 'information', img: 'rotary', pos: 'center', plate: 'information', credit: 'Photo: Wikimedia Commons (CC)',
    dept: { en: 'Dept. of Information & Publicity · Press and Stationery', ta: 'தகவல் & மக்கள் தொடர்புத் துறை · அச்சகம் மற்றும் எழுதுபொருள்' },
    short: { en: 'Information', ta: 'தகவல்' },
    title: { en: 'Information and Publicity', ta: 'தகவல் மற்றும் மக்கள் தொடர்பு' },
    tag: { en: 'Media, newsprint, government press', ta: 'ஊடகம், செய்தித்தாள், அரசு அச்சகம்' },
    blurb: {
      en: 'State public relations, media coordination and official announcements. This desk also holds newsprint control — the allocation and regulation of newsprint supply — and the government presses handling official printing and stationery distribution.',
      ta: 'மாநில மக்கள் தொடர்பு, ஊடக ஒருங்கிணைப்பு, அரசு அறிவிப்புகள். செய்தித்தாள் ஒதுக்கீடு மற்றும் ஒழுங்குமுறை, அரசு அச்சகங்கள், எழுதுபொருள் விநியோகமும் இந்த மேசையின் கீழ் வரும்.',
    },
    types: [
      { en: 'Public information campaigns & digital outreach', ta: 'பொதுத் தகவல் பிரச்சாரங்கள் & இணைய தொடர்பு' },
      { en: 'Press coordination, documentation & field publicity', ta: 'பத்திரிகை ஒருங்கிணைப்பு, ஆவணப்படுத்தல் & கள விளம்பரம்' },
      { en: 'Newsprint allocation policy & transparency', ta: 'செய்தித்தாள் ஒதுக்கீட்டுக் கொள்கை & வெளிப்படைத்தன்மை' },
      { en: 'Government press modernisation & stationery supply', ta: 'அரசு அச்சக நவீனமயம் & எழுதுபொருள் விநியோகம்' },
    ],
  },
  {
    key: 'film', img: 'theatre', pos: 'center 45%', plate: 'film', credit: 'Photo: Wikimedia Commons (CC)',
    dept: { en: 'Film Technology & Cinematograph Act cell', ta: 'திரைப்படத் தொழில்நுட்பம் & சினிமாட்டோகிராஃப் சட்டப் பிரிவு' },
    short: { en: 'Film', ta: 'திரைப்படம்' },
    title: { en: 'Film Technology and Cinematograph Act', ta: 'திரைப்படத் தொழில்நுட்பம் & சினிமாட்டோகிராஃப் சட்டம்' },
    tag: { en: 'Licensing, welfare, industry', ta: 'உரிமம், நலன், தொழில்' },
    blurb: {
      en: 'Regulation of cinema licensing, film industry welfare and the related acts. Proposals touching theatres, studios, workers and film preservation come to this desk.',
      ta: 'திரையரங்கு உரிமம், திரைத்துறை நலன், தொடர்புடைய சட்டங்கள். திரையரங்குகள், படப்பிடிப்பகங்கள், தொழிலாளர், படப் பாதுகாப்பு தொடர்பான முன்மொழிவுகள் இங்கே.',
    },
    types: [
      { en: 'Theatre licensing & safety compliance', ta: 'திரையரங்கு உரிமம் & பாதுகாப்பு' },
      { en: 'Film worker welfare & training', ta: 'திரைத்துறை தொழிலாளர் நலன் & பயிற்சி' },
      { en: 'Studios, post-production & film technology', ta: 'படப்பிடிப்பகம், தொழில்நுட்பம்' },
      { en: 'Archival restoration & film heritage', ta: 'படக் காப்பகம் & மறுசீரமைப்பு' },
    ],
  },
]

/* ================= THE COUPLETS =================
   The rail beneath the questions carries a Tirukkural chosen for the category
   being proposed to — Education draws from கல்வி, and so on. Two lines each. */
export const KURALS = {
  // School Education → கல்வி
  school: {
    no: 391, chapter: { en: 'Chapter 40 · Learning', ta: 'அதிகாரம் 40 · கல்வி' },
    lines: ['கற்க கசடறக் கற்பவை கற்றபின்', 'நிற்க அதற்குத் தக'],
    gloss: { en: 'Learn, and learn faultlessly, what is worth learning. Having learnt it, stand by what you have learnt.', ta: 'கற்க வேண்டியவற்றைக் குற்றமறக் கற்க; கற்ற பின் அதற்கேற்ப நிற்க.' },
  },
  // Tamil, Culture & Archaeology → புகழ், on what alone outlasts us
  tamil: {
    no: 233, chapter: { en: 'Chapter 24 · Renown', ta: 'அதிகாரம் 24 · புகழ்' },
    lines: ['ஒன்றா உலகத்து உயர்ந்த புகழல்லால்', 'பொன்றாது நிற்பதொன்று இல்'],
    gloss: { en: 'Save for the high renown of a life well lived, there is nothing in this world that stands undying.', ta: 'உயர்ந்த புகழைத் தவிர, இவ்வுலகில் அழியாமல் நிற்பது வேறு எதுவும் இல்லை.' },
  },
  // Information & Publicity → வாய்மை, on truthful speech
  information: {
    no: 291, chapter: { en: 'Chapter 30 · Truthfulness', ta: 'அதிகாரம் 30 · வாய்மை' },
    lines: ['வாய்மை எனப்படுவது யாதெனின் யாதொன்றும்', 'தீமை இலாத சொலல்'],
    gloss: { en: 'What is truthfulness? It is speech that is free of every trace of harm.', ta: 'வாய்மை என்பது யாது எனில், எவருக்கும் தீமை தராத சொற்களைச் சொல்வதே.' },
  },
  // Film → சொல்வன்மை, on speech that holds an audience
  film: {
    no: 643, chapter: { en: 'Chapter 65 · Power of speech', ta: 'அதிகாரம் 65 · சொல்வன்மை' },
    lines: ['கேட்டார்ப் பிணிக்கும் தகையவாய்க் கேளாரும்', 'வேட்ப மொழிவதாம் சொல்'],
    gloss: { en: 'True speech binds those who hear it, and makes even those who would not listen long to hear more.', ta: 'கேட்பவரைக் கட்டி வைப்பதும், கேளாதவரும் விரும்பிக் கேட்கச் செய்வதுமே சொல்.' },
  },
}

/* Used when a category has no couplet of its own. */
export const DEFAULT_KURAL = KURALS.school

/* Shown on the verification screen, whichever category was chosen. */
export const OTP_KURAL = {
  no: 509, chapter: { en: 'Chapter 52 · Selection and confidence', ta: 'அதிகாரம் 52 · தெரிந்து தெளிதல்' },
  lines: ['தேறற்க யாரையும் தேராது தேர்ந்தபின்', 'தேறுக தேறும் பொருள்'],
  gloss: { en: 'Trust no one untested. Having tested, trust them with what is fit to be trusted.', ta: 'ஆராயாமல் யாரையும் நம்பாதே; ஆராய்ந்த பின் நம்பத்தக்கதை நம்பு.' },
}

/* ================= THE INTAKE ================= */
/* Four screens: who you are, who signs, where to reach you, and the document.
   `duo` renders two fields on one line. `ack` is the line the state says back. */
export const MAX_DOCS = 5
export const MAX_DOC_MB = 25

export const STEPS = [
  { key: 'org', type: 'text',
    q: { en: 'Which organisation do you represent?', ta: 'நீங்கள் எந்த நிறுவனத்தைச் சார்ந்தவர்?' },
    help: { en: 'The registered name of your company, institution, association, union or trust, as it should appear on the official file.', ta: 'உங்கள் நிறுவனம், கல்வி நிலையம், சங்கம், தொழிற்சங்கம் அல்லது அறக்கட்டளையின் பதிவுப் பெயர்.' },
    ph: { en: 'Registered organisation name', ta: 'பதிவு செய்யப்பட்ட பெயர்' },
    ack: { en: (v) => `${v}. The file is open.`, ta: (v) => `${v}. கோப்பு திறக்கப்பட்டது.` } },

  { key: 'person', type: 'duo',
    q: (a) => ({
      en: `And who is representing ${a.org || 'this organisation'}?`,
      ta: `${a.org || 'இந்த நிறுவனம்'} சார்பாக பிரதிநிதித்துவப்படுத்துபவர் யார்?`,
    }),
    help: { en: 'The person the Minister\'s office will correspond with. Designation matters — it sets the level at which your file is read.', ta: 'அமைச்சர் அலுவலகம் தொடர்பு கொள்ளும் நபர். பதவி முக்கியம் — உங்கள் கோப்பு எந்த நிலையில் படிக்கப்படும் என்பதை அது தீர்மானிக்கிறது.' },
    fields: [
      { key: 'personName', ph: { en: 'Full name', ta: 'முழுப்பெயர்' } },
      { key: 'designation', ph: { en: 'Designation', ta: 'பதவி' } },
    ],
    ack: { en: (v) => `An honour to receive you, ${v}.`, ta: (v) => `${v} அவர்களே, உங்களை வரவேற்பதில் பெருமை.` } },

  { key: 'contact', type: 'duo',
    q: (a) => ({
      en: `Hi ${a.personName || 'there'}, where can we reach you?`,
      ta: `வணக்கம் ${a.personName || ''}, உங்களை எங்குத் தொடர்பு கொள்ளலாம்?`,
    }),
    help: { en: 'Official email and a direct number. Used for acknowledgement, clarifications and the review outcome. Held under government privacy standards, never published.', ta: 'அதிகாரப்பூர்வ மின்னஞ்சல் மற்றும் நேரடி எண். ஒப்புகை, விளக்கம், ஆய்வு முடிவுக்காக. அரசு தனியுரிமைத் தரங்களின் கீழ் பாதுகாக்கப்படும்.' },
    fields: [
      { key: 'email', ph: { en: 'Official email address', ta: 'அதிகாரப்பூர்வ மின்னஞ்சல்' }, inputType: 'email' },
      { key: 'phone', ph: { en: 'Direct number', ta: 'நேரடி எண்' }, inputType: 'tel' },
    ],
    ack: { en: () => 'Secured. You will never wonder where your file is.', ta: () => 'பாதுகாக்கப்பட்டது. உங்கள் கோப்பு எங்கே என்று இனி யோசிக்க வேண்டாம்.' } },

  { key: 'docs', type: 'files',
    q: { en: 'Now place your proposal on the table.', ta: 'இப்போது உங்கள் முன்மொழிவை மேசையில் வையுங்கள்.' },
    help: { en: `Attach the proposal document, and any annexures that support it. PDF only, up to ${MAX_DOCS} files, ${MAX_DOC_MB} MB each. This is the same folder you would have carried to the office.`, ta: `முன்மொழிவு ஆவணத்தையும் அதற்குரிய இணைப்புகளையும் சேர்க்கவும். PDF மட்டும், அதிகபட்சம் ${MAX_DOCS} கோப்புகள், ஒன்று ${MAX_DOC_MB} MB வரை. அலுவலகத்திற்கு நீங்கள் எடுத்துச் சென்றிருக்கும் அதே கோப்புறை.` },
    ack: { en: (n) => `${n} document${n === 1 ? '' : 's'} received. Sealing the file.`, ta: (n) => `${n} ஆவணம் பெறப்பட்டது. கோப்பு முத்திரையிடப்படுகிறது.` } },
]

/* ================= SUBMISSION SEQUENCE ================= */
/* ms = how long this line stays "active" before it ticks over. */
export const PROCESSING = [
  { ms: 900,  en: 'Establishing secure channel to the Ministry', ta: 'அமைச்சகத்துடன் பாதுகாப்பான இணைப்பு' },
  { ms: 1250, en: 'Routing to the concerned department',        ta: 'சம்பந்தப்பட்ட துறைக்கு அனுப்புகிறோம்' },
  { ms: 1400, en: 'Analysing the proposal document',            ta: 'முன்மொழிவு ஆவணம் பகுப்பாய்வு செய்யப்படுகிறது' },
  { ms: 1200, en: 'Segregating key details for review',         ta: 'ஆய்வுக்கான முக்கிய விவரங்கள் பிரிக்கப்படுகின்றன' },
  { ms: 1050, en: 'Setting review priority',                    ta: 'ஆய்வு முன்னுரிமை நிர்ணயிக்கப்படுகிறது' },
  { ms: 1100, en: 'Generating official tracking reference',     ta: 'அதிகாரப்பூர்வ கண்காணிப்பு எண் உருவாக்கம்' },
]

export const NEXT_STEPS = [
  { en: 'An acknowledgement reaches your email within the hour.', ta: 'ஒரு மணி நேரத்திற்குள் உங்கள் மின்னஞ்சலுக்கு ஒப்புகை வரும்.' },
  { en: 'Preliminary review is targeted within 7 working days.', ta: 'முதற்கட்ட ஆய்வு 7 வேலை நாட்களுக்குள்.' },
  { en: 'A named officer responds with reasons, either way.', ta: 'ஒரு பெயரிடப்பட்ட அதிகாரி காரணத்துடன் பதிலளிப்பார்.' },
]
