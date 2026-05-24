const BLOCKED_WORDS = [
  'muie', 'pula', 'pizda', 'curva', 'futu', 'fututi', 'sugi', 'cacat',
  'retardat', 'handicapat', 'jeg', 'javra', 'idiotilor', 'dobitoc',
  'fuck', 'shit', 'bitch', 'asshole'
];

const AGGRESSIVE_PATTERNS = [
  /va\s*omor/i,
  /te\s*omor/i,
  /sa\s*moara/i,
  /dau\s+foc/i,
  /va\s*distrug/i,
  /proces.*nenorocit/i,
  /nesimtit/i
];

const ADMIN_SESSION_SECONDS = 8 * 60 * 60;
const ADMIN_MAX_LOGIN_ATTEMPTS = 6;
const ADMIN_LOCK_SECONDS = 15 * 60;
const MAX_ATTACHMENT_COUNT = 5;
const MAX_ATTACHMENT_TOTAL_BYTES = 8 * 1024 * 1024;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' }
  });
}

function cleanText(value, limit = 2000) {
  return String(value || '').trim().slice(0, limit);
}

function base64UrlEncode(value) {
  const raw = typeof value === 'string'
    ? btoa(value)
    : btoa(String.fromCharCode(...new Uint8Array(value)));
  return raw.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const base64 = String(value || '').replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(String(value || '').length / 4) * 4, '=');
  return atob(base64);
}

function timingSafeEqual(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left.length !== right.length) return false;
  let result = 0;
  for (let i = 0; i < left.length; i += 1) result |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return result === 0;
}

function isEmail(value) {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function parseEmailList(value) {
  return String(value || '')
    .split(/[;,\s]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function isPhone(value) {
  return !value || /^[0-9+\s().-]{7,24}$/.test(value);
}

function moderate(comment) {
  const normalized = comment.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const hasBlockedWord = BLOCKED_WORDS.some(word => normalized.includes(word));
  const isAggressive = AGGRESSIVE_PATTERNS.some(pattern => pattern.test(normalized));
  return {
    flagged: Boolean(comment && (hasBlockedWord || isAggressive)),
    reasons: [
      hasBlockedWord ? 'limbaj nepotrivit' : '',
      isAggressive ? 'ton agresiv' : ''
    ].filter(Boolean)
  };
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

async function getReviews(env) {
  if (!env.REVIEWS_KV) return [];
  return await env.REVIEWS_KV.get('reviews', { type: 'json' }) || [];
}

async function saveReviews(env, reviews) {
  if (!env.REVIEWS_KV) throw new Error('REVIEWS_KV nu este configurat în Cloudflare Pages.');
  await env.REVIEWS_KV.put('reviews', JSON.stringify(reviews));
}

function publicReview(review) {
  return {
    id: review.id,
    specialty: review.specialty,
    generalRating: review.generalRating,
    comment: review.comment,
    createdAt: review.createdAt
  };
}

function adminReview(review) {
  return {
    id: review.id,
    specialty: review.specialty,
    generalRating: review.generalRating,
    staffRating: review.staffRating || 0,
    waitRating: review.waitRating || 0,
    cleanRating: review.cleanRating || 0,
    comment: review.comment,
    recommend: review.recommend,
    patientEmail: review.patientEmail,
    patientPhone: review.patientPhone,
    createdAt: review.createdAt,
    status: review.status,
    moderationReasons: review.moderationReasons || []
  };
}

function getAdminPassword(env) {
  return env.ADMIN_PASSWORD || '';
}

function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

async function signAdminPayload(env, payload) {
  const secret = getAdminPassword(env);
  if (!secret) throw new Error('ADMIN_PASSWORD nu este configurat.');
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encodedPayload));
  return `${encodedPayload}.${base64UrlEncode(signature)}`;
}

async function verifyAdminToken(env, token) {
  try {
    const secret = getAdminPassword(env);
    if (!secret || !token || !token.includes('.')) return false;
    const [encodedPayload, signature] = token.split('.');
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const expected = base64UrlEncode(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encodedPayload)));
    if (!timingSafeEqual(signature, expected)) return false;
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    return payload.scope === 'admin' && Number(payload.exp) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

async function isAdmin(request, env) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return await verifyAdminToken(env, token);
}

async function getLoginState(env, request) {
  if (!env.REVIEWS_KV) return { key: '', attempts: 0, lockedUntil: 0 };
  const key = `admin-login:${clientIp(request)}`;
  const state = await env.REVIEWS_KV.get(key, { type: 'json' }) || { attempts: 0, lockedUntil: 0 };
  return { key, attempts: Number(state.attempts || 0), lockedUntil: Number(state.lockedUntil || 0) };
}

async function registerFailedLogin(env, state) {
  if (!env.REVIEWS_KV || !state.key) return;
  const attempts = state.attempts + 1;
  const lockedUntil = attempts >= ADMIN_MAX_LOGIN_ATTEMPTS ? Date.now() + ADMIN_LOCK_SECONDS * 1000 : 0;
  await env.REVIEWS_KV.put(state.key, JSON.stringify({ attempts, lockedUntil }), { expirationTtl: ADMIN_LOCK_SECONDS });
}

async function resetFailedLogin(env, state) {
  if (!env.REVIEWS_KV || !state.key) return;
  await env.REVIEWS_KV.delete(state.key);
}

function emailHtml(review, title, approvalLinks) {
  const ratings = [
    ['Satisfacție generală', review.generalRating],
    ['Personal medical', review.staffRating || '-'],
    ['Timp de așteptare', review.waitRating || '-'],
    ['Curățenie și confort', review.cleanRating || '-']
  ];
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.55;color:#1a1f2e">
      <h2>${escapeHtml(title)}</h2>
      <p><strong>Specialitate:</strong> ${escapeHtml(review.specialty)}</p>
      <p><strong>Recomandare:</strong> ${escapeHtml(review.recommend)}</p>
      <ul>${ratings.map(([label, value]) => `<li><strong>${label}:</strong> ${escapeHtml(value)}/5</li>`).join('')}</ul>
      ${review.comment ? `<p><strong>Comentariu:</strong><br>${escapeHtml(review.comment)}</p>` : '<p><em>Fără comentariu scris.</em></p>'}
      ${(review.patientEmail || review.patientPhone) ? `<p><strong>Date contact pacient:</strong><br>Email: ${escapeHtml(review.patientEmail || '-')}<br>Telefon: ${escapeHtml(review.patientPhone || '-')}</p>` : ''}
      ${review.moderationReasons.length ? `<p><strong>Filtru:</strong> ${escapeHtml(review.moderationReasons.join(', '))}</p>` : ''}
      ${approvalLinks ? `<p><a href="${approvalLinks.approve}" style="display:inline-block;background:#2d9d6a;color:#fff;padding:10px 14px;border-radius:6px;text-decoration:none">Aprobă postarea</a> <a href="${approvalLinks.reject}" style="display:inline-block;background:#b81c1c;color:#fff;padding:10px 14px;border-radius:6px;text-decoration:none">Șterge / respinge</a></p>` : ''}
    </div>
  `;
}

async function sendEmail(env, subject, body) {
  if (!env.RESEND_API_KEY) return;
  const to = env.REVIEW_TO || 'contact@modernmedclinic.ro';
  const from = env.MAIL_FROM || 'Modern Med Clinic <contact@modernmedclinic.ro>';
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ from, to: [to], subject, html: body })
  });
  if (!response.ok) throw new Error(`Email provider error: ${response.status}`);
}

async function sendAdminEmail(env, payload) {
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY nu este configurat.');

  const allowedSenders = ['contact@modernmedclinic.ro', 'programari@modernmedclinic.ro'];
  const fromAddress = cleanText(payload.from, 120);
  const to = parseEmailList(payload.to);
  const cc = parseEmailList(payload.cc);
  const bcc = parseEmailList(payload.bcc);
  const subject = cleanText(payload.subject, 180);
  const htmlBody = cleanText(payload.html, 12000);
  const textBody = cleanText(payload.text, 12000);
  const rawAttachments = Array.isArray(payload.attachments) ? payload.attachments : [];
  const attachments = rawAttachments.slice(0, MAX_ATTACHMENT_COUNT);
  const totalAttachmentBytes = attachments.reduce((sum, file) => sum + Math.ceil(String(file.content || '').length * 3 / 4), 0);

  if (!allowedSenders.includes(fromAddress)) throw new Error('Alegeți o adresă de expeditor validă.');
  if (!to.length) throw new Error('Completați cel puțin un destinatar.');
  if ([...to, ...cc, ...bcc].some(email => !isEmail(email))) throw new Error('Una dintre adresele de email nu pare validă.');
  if (!subject) throw new Error('Completați subiectul emailului.');
  if (!htmlBody && !textBody) throw new Error('Completați mesajul emailului.');
  if (rawAttachments.length > MAX_ATTACHMENT_COUNT) throw new Error('Puteți atașa maximum 5 fișiere.');
  if (totalAttachmentBytes > MAX_ATTACHMENT_TOTAL_BYTES) throw new Error('Atașamentele depășesc limita totală de 8 MB.');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      from: `Modern Med Clinic <${fromAddress}>`,
      to,
      cc: cc.length ? cc : undefined,
      bcc: bcc.length ? bcc : undefined,
      reply_to: fromAddress,
      subject,
      html: htmlBody || `<p>${escapeHtml(textBody).replace(/\n/g, '<br>')}</p>`,
      text: textBody || undefined,
      attachments: attachments.length
        ? attachments.map(file => ({
            filename: cleanText(file.filename, 160) || 'atasament',
            content: String(file.content || '')
          }))
        : undefined
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `Email provider error: ${response.status}`);
  return data;
}

async function trySendEmail(env, subject, body) {
  try {
    await sendEmail(env, subject, body);
    return true;
  } catch (error) {
    console.error('Review email failed:', error.message || error);
    return false;
  }
}

async function handleList(env) {
  const reviews = await getReviews(env);
  const approved = reviews.filter(review => review.status === 'approved');
  const average = approved.length
    ? approved.reduce((sum, review) => sum + review.generalRating, 0) / approved.length
    : 0;
  return json({
    average,
    count: approved.length,
    reviews: approved.filter(review => review.comment).slice(-12).reverse().map(publicReview)
  });
}

async function handleCreate(request, env) {
  const body = await request.json();
  const review = {
    id: crypto.randomUUID(),
    token: crypto.randomUUID() + crypto.randomUUID(),
    specialty: cleanText(body.specialty, 120),
    generalRating: Number(body.generalRating),
    staffRating: Number(body.staffRating || 0),
    waitRating: Number(body.waitRating || 0),
    cleanRating: Number(body.cleanRating || 0),
    comment: cleanText(body.comment, 1200),
    recommend: cleanText(body.recommend, 80),
    patientEmail: cleanText(body.patientEmail, 180),
    patientPhone: cleanText(body.patientPhone, 40),
    createdAt: new Date().toISOString(),
    status: 'approved',
    moderationReasons: []
  };

  if (!review.specialty || !review.recommend || !Number.isInteger(review.generalRating) || review.generalRating < 1 || review.generalRating > 5) {
    return json({ error: 'Câmpurile obligatorii nu sunt completate corect.' }, 400);
  }
  if (!isEmail(review.patientEmail)) return json({ error: 'Adresa de email nu pare validă.' }, 400);
  if (!isPhone(review.patientPhone)) return json({ error: 'Numărul de telefon nu pare valid.' }, 400);

  const moderation = moderate(review.comment);
  review.status = moderation.flagged ? 'pending' : 'approved';
  review.moderationReasons = moderation.reasons;

  const reviews = await getReviews(env);
  reviews.push(review);
  await saveReviews(env, reviews);

  const origin = new URL(request.url).origin;
  const approvalLinks = review.status === 'pending'
    ? {
        approve: `${origin}/api/reviews/${review.id}/approve?token=${review.token}`,
        reject: `${origin}/api/reviews/${review.id}/reject?token=${review.token}`
      }
    : null;

  if (review.status === 'pending') {
    await trySendEmail(env, 'APROBARE recenzie Modern Med Clinic', emailHtml(review, 'Recenzie care necesită aprobare', approvalLinks));
  } else if (review.patientEmail || review.patientPhone || review.comment) {
    await trySendEmail(env, 'Recenzie Modern Med Clinic', emailHtml(review, 'Recenzie nouă', null));
  }

  return json({ ok: true, status: review.status }, 201);
}

async function handleModeration(request, env, pathParts) {
  const [id, action] = pathParts;
  if (!id || !['approve', 'reject'].includes(action)) return json({ error: 'Not found' }, 404);
  const token = new URL(request.url).searchParams.get('token');
  const reviews = await getReviews(env);
  const review = reviews.find(item => item.id === id && item.token === token);
  if (!review) return html('<h1>Link invalid sau expirat</h1>', 404);
  review.status = action === 'approve' ? 'approved' : 'rejected';
  review.moderatedAt = new Date().toISOString();
  await saveReviews(env, reviews);
  return html(`<h1>${action === 'approve' ? 'Recenzia a fost aprobată' : 'Recenzia a fost ștearsă/respinsă'}</h1><p>Puteți închide această pagină.</p>`);
}

async function handleAdminList(request, env) {
  if (!await isAdmin(request, env)) return json({ error: 'Acces neautorizat.' }, 401);
  const reviews = await getReviews(env);
  const sorted = reviews
    .map(adminReview)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return json({ count: sorted.length, reviews: sorted });
}

async function handleAdminAction(request, env, pathParts) {
  if (!await isAdmin(request, env)) return json({ error: 'Acces neautorizat.' }, 401);
  const [, id, action] = pathParts;
  if (!id || !['approve', 'reject', 'delete'].includes(action)) return json({ error: 'Not found' }, 404);
  const reviews = await getReviews(env);
  const index = reviews.findIndex(item => item.id === id);
  if (index === -1) return json({ error: 'Recenzia nu există.' }, 404);
  const review = reviews[index];
  if (action === 'delete') {
    reviews.splice(index, 1);
  } else {
    review.status = action === 'approve' ? 'approved' : 'rejected';
    review.moderatedAt = new Date().toISOString();
  }
  await saveReviews(env, reviews);
  return json({ ok: true, action, review: adminReview(review) });
}

async function handleAdminSendEmail(request, env) {
  if (!await isAdmin(request, env)) return json({ error: 'Acces neautorizat.' }, 401);
  const body = await request.json();
  const result = await sendAdminEmail(env, body);
  return json({ ok: true, id: result.id || null });
}

async function handleAdminLogin(request, env) {
  const password = getAdminPassword(env);
  if (!password) return json({ error: 'ADMIN_PASSWORD nu este configurat.' }, 503);

  const state = await getLoginState(env, request);
  if (state.lockedUntil && state.lockedUntil > Date.now()) {
    const minutes = Math.ceil((state.lockedUntil - Date.now()) / 60000);
    return json({ error: `Prea multe încercări greșite. Încercați din nou peste ${minutes} minute.` }, 429);
  }

  const body = await request.json().catch(() => ({}));
  if (!timingSafeEqual(cleanText(body.password, 200), password)) {
    await registerFailedLogin(env, state);
    return json({ error: 'Parolă incorectă.' }, 401);
  }

  await resetFailedLogin(env, state);
  const now = Math.floor(Date.now() / 1000);
  const token = await signAdminPayload(env, { scope: 'admin', iat: now, exp: now + ADMIN_SESSION_SECONDS });
  return json({ ok: true, token, expiresIn: ADMIN_SESSION_SECONDS });
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const path = params.path || [];

  try {
    if (request.method === 'POST' && path.length === 2 && path[0] === 'admin' && path[1] === 'login') return await handleAdminLogin(request, env);
    if (request.method === 'GET' && path.length === 1 && path[0] === 'admin') return await handleAdminList(request, env);
    if (request.method === 'POST' && path.length === 3 && path[0] === 'admin' && path[1] === 'email' && path[2] === 'send') return await handleAdminSendEmail(request, env);
    if (request.method === 'POST' && path.length === 3 && path[0] === 'admin') return await handleAdminAction(request, env, path);
    if (request.method === 'GET' && path.length === 0) return await handleList(env);
    if (request.method === 'POST' && path.length === 0) return await handleCreate(request, env);
    if (request.method === 'GET' && path.length === 2) return await handleModeration(request, env, path);
    return json({ error: 'Method not allowed' }, 405);
  } catch (error) {
    return json({ error: error.message || 'A apărut o eroare. Încercați din nou.' }, 500);
  }
}
