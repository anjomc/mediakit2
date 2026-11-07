// Funções compartilhadas: chamadas à Instagram Graph API.
const GR = "https://graph.instagram.com/v21.0";
const ts = d => Math.floor(d / 1e3);
const M = ["reach", "views", "total_interactions"];
const G = { F: "Mulheres", M: "Homens", U: "Não informado" };

export async function ig(path, t, q = {}) {
  const j = await (await fetch(GR + path + "?" + new URLSearchParams({ ...q, access_token: t }))).json();
  if (j.error) throw new Error(j.error.message);
  return j;
}
export async function tok(st) {
  const o = await st.get("owner", { type: "json" });
  if (!o) throw new Error("Instagram não conectado");
  if (o.exp - Date.now() < 15 * 864e5) {
    const r = await (await fetch("https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=" + o.token)).json();
    if (r.access_token) { o.token = r.access_token; o.exp = Date.now() + r.expires_in * 1e3; await st.setJSON("owner", o); }
  }
  return o.token;
}
const one = async (t, m, a, b) => (await ig("/me/insights", t, { metric: m, period: "day", metric_type: "total_value", since: ts(a), until: ts(b) })).data?.[0]?.total_value?.value ?? 0;
// Soma por janelas de 30 dias, em paralelo. Alcance (contas únicas) não é somável: fica null acima de 30 dias.
export async function tot(t, days, metrics = M) {
  const chunks = []; let e = Date.now();
  for (let left = days; left > 0; left -= 30) { const n = Math.min(30, left); chunks.push([e - n * 864e5, e]); e -= n * 864e5; }
  const o = {};
  await Promise.all(metrics.map(async m => {
    if (days > 30 && m === "reach") { o[m] = null; return; }
    try { o[m] = (await Promise.all(chunks.map(([a, b]) => one(t, m, a, b)))).reduce((x, y) => x + y, 0); } catch (x) { o[m] = null; }
  }));
  return o;
}
async function demoOne(t, b) {
  try {
    const j = await ig("/me/insights", t, { metric: "follower_demographics", period: "lifetime", metric_type: "total_value", breakdown: b });
    const rs = j.data?.[0]?.total_value?.breakdowns?.[0]?.results || [], sum = rs.reduce((a, r) => a + r.value, 0);
    if (!sum) return undefined;
    return rs.sort((a, c) => c.value - a.value).slice(0, b === "city" ? 6 : 10)
      .map(r => `${b === "gender" ? (G[r.dimension_values[0]] || r.dimension_values[0]) : r.dimension_values.join(" ")}: ${(r.value / sum * 100).toFixed(1)}`).join("\n");
  } catch (x) { return undefined; }
}
export async function collect(st) {
  const t = await tok(st);
  const [me, x7, x30, x90, age, gender, cities, md, hist] = await Promise.all([
    ig("/me", t, { fields: "username,name,biography,followers_count" }),
    tot(t, 7), tot(t, 30), tot(t, 90),
    demoOne(t, "age"), demoOne(t, "gender"), demoOne(t, "city"),
    ig("/me/media", t, { fields: "caption,like_count,comments_count,media_type", limit: 50 }).catch(() => null),
    st.get("hist", { type: "json" })
  ]);
  const mk = x => ({ followers: me.followers_count, reach: x.reach, views: x.views, interactions: x.total_interactions });
  const top = (md?.data || []).map(m => ({ s: (m.like_count || 0) + (m.comments_count || 0), c: (m.caption || m.media_type || "").replace(/\s+/g, " ").slice(0, 60) + " (" + m.media_type + ")" }))
    .sort((a, b) => b.s - a.s).slice(0, 5).map(m => `${m.c}: ${m.s} curtidas+comentários`).join("\n");
  const demographics = {}; if (age) demographics.age = age; if (gender) demographics.gender = gender; if (cities) demographics.cities = cities;
  return { profile: { name: me.name, handle: me.username, bio: me.biography }, metrics: { 7: mk(x7), 30: mk(x30), 90: mk(x90) }, history: hist || [], demographics, top };
}
export async function snap(st) {
  const t = await tok(st);
  const [me, x] = await Promise.all([ig("/me", t, { fields: "followers_count" }), tot(t, 1)]);
  const d = new Date().toISOString().slice(0, 10), h = ((await st.get("hist", { type: "json" })) || []).filter(r => r.d !== d);
  h.push({ d, f: me.followers_count, r: x.reach, v: x.views, e: x.total_interactions });
  await st.setJSON("hist", h.slice(-400));
}
