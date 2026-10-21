// Cloudflare Pages Function: POST /api/leads
// Free setup, no paid email API needed:
//  - Bind a KV namespace as LEADS (Pages > Settings > Functions > KV bindings) to store every lead.
//  - Optional: set WEBHOOK_URL (e.g. a Slack/Discord/Google Apps Script webhook) to get notified.
//  - Every lead is emailed to akarshansanan@sananrealestate.ae via FormSubmit (free, no key).
//    Set DISABLE_EMAIL=1 for local testing.
//  - Optional: set ADMIN_KEY, then GET /api/leads?key=ADMIN_KEY lists stored leads as JSON.
const LEAD_EMAIL = 'akarshansanan@sananrealestate.ae';
const SITE = 'https://www.sananrealestate.ae';
const clean = (v, n = 500) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

export async function onRequestPost({ request, env }) {
  let body;
  try {
    const ct = request.headers.get('content-type') || '';
    body = ct.includes('application/json') ? await request.json() : Object.fromEntries(await request.formData());
  } catch { return json({ ok: false, error: 'bad request' }, 400); }

  if (body.website) return json({ ok: true }); // honeypot
  const lead = {
    id: crypto.randomUUID(), at: new Date().toISOString(),
    name: clean(body.name, 120), phone: clean(body.phone, 40), email: clean(body.email, 160),
    interest: clean(body.interest, 200), budget: clean(body.budget, 40), timeline: clean(body.timeline, 40),
    message: clean(body.message, 2000), source: clean(body.source, 500),
    country: request.headers.get('cf-ipcountry') || '',
  };
  if (!lead.phone && !lead.email) return json({ ok: false, error: 'phone or email required' }, 422);

  const tasks = [];
  if (env.LEADS) tasks.push(env.LEADS.put(`lead:${lead.at}:${lead.id}`, JSON.stringify(lead)));
  if (env.WEBHOOK_URL) {
    const text = `New SANAN lead\n${Object.entries(lead).filter(([k, v]) => v && k !== 'id').map(([k, v]) => `${k}: ${v}`).join('\n')}`;
    tasks.push(fetch(env.WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, content: text, lead }) }));
  }
  let emailed = false;
  const emailTask = env.DISABLE_EMAIL ? Promise.resolve() : fetch(`https://formsubmit.co/ajax/${LEAD_EMAIL}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', referer: SITE + '/', origin: SITE },
    body: JSON.stringify({ _subject: 'New enquiry from sananrealestate.ae', _template: 'table', _captcha: 'false',
      Name: lead.name, Phone: lead.phone, Email: lead.email, 'Looking for': lead.interest, Budget: lead.budget,
      Timeline: lead.timeline, Message: lead.message, Source: lead.source, Country: lead.country, Received: lead.at }),
  }).then(async r => { const j = await r.json().catch(() => ({})); emailed = r.ok && String(j.success) === 'true'; if (!emailed) console.log('formsubmit', r.status, JSON.stringify(j)); })
    .catch(e => console.log('formsubmit error', String(e)));
  const results = await Promise.allSettled([...tasks, emailTask]);
  const stored = tasks.length > 0 && results.slice(0, tasks.length).some(r => r.status === 'fulfilled');
  console.log('lead', JSON.stringify(lead)); // always visible in Pages > Functions > Real-time logs
  if (request.headers.get('accept')?.includes('text/html')) return Response.redirect(new URL('/?sent=1#contact', request.url), 303);
  return json({ ok: true, stored, emailed });
}

export async function onRequestGet({ request, env }) {
  const key = new URL(request.url).searchParams.get('key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY || !env.LEADS) return json({ ok: false }, 404);
  const list = await env.LEADS.list({ prefix: 'lead:' });
  const leads = await Promise.all(list.keys.map(k => env.LEADS.get(k.name, 'json')));
  return json({ ok: true, count: leads.length, leads: leads.reverse() });
}

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
