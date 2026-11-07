// Login do Instagram, sincronização e link público. Tokens ficam só aqui, no servidor.
import { getStore } from "@netlify/blobs";
import { ig, collect } from "../lib/ig.mjs";

const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const rnd = () => crypto.randomUUID().replace(/-/g, "");
const cookie = (req, n) => { const m = (req.headers.get("cookie") || "").match(new RegExp("(?:^|; )" + n + "=([^;]*)")); return m && m[1]; };
const ck = (n, v, age) => `${n}=${v}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;

export default async (req) => {
  const st = getStore("mediakit"), u = new URL(req.url), p = u.pathname, redirect = u.origin + "/auth/callback";
  const ID = process.env.IG_APP_ID, SECRET = process.env.IG_APP_SECRET;
  try {
    if (p === "/auth/login") {
      if (!ID || !SECRET) return new Response("Faltam IG_APP_ID e IG_APP_SECRET nas variáveis do Netlify.", { status: 500 });
      const s = rnd();
      return new Response(null, { status: 302, headers: {
        location: "https://www.instagram.com/oauth/authorize?" + new URLSearchParams({ client_id: ID, redirect_uri: redirect, response_type: "code", scope: "instagram_business_basic,instagram_business_manage_insights", state: s }),
        "set-cookie": ck("st", s, 600) } });
    }
    if (p === "/auth/callback") {
      const code = (u.searchParams.get("code") || "").replace(/#_$/, "");
      if (!code || u.searchParams.get("state") !== cookie(req, "st")) return new Response("Login inválido. Volte e tente de novo.", { status: 400 });
      const t = await (await fetch("https://api.instagram.com/oauth/access_token", { method: "POST", body: new URLSearchParams({ client_id: ID, client_secret: SECRET, grant_type: "authorization_code", redirect_uri: redirect, code }) })).json();
      if (!t.access_token) return new Response("A Meta recusou o login: " + JSON.stringify(t), { status: 400 });
      const l = await (await fetch(`https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${SECRET}&access_token=${t.access_token}`)).json();
      if (!l.access_token) return new Response("Falha ao gerar token longo: " + JSON.stringify(l), { status: 400 });
      const me = await ig("/me", l.access_token, { fields: "username" });
      const own = await st.get("owner", { type: "json" });
      if (own && own.u !== me.username) return new Response("Este app já pertence a outra conta.", { status: 403 });
      await st.setJSON("owner", { u: me.username, token: l.access_token, exp: Date.now() + l.expires_in * 1e3 });
      const sid = rnd(); await st.setJSON("s-" + sid, { exp: Date.now() + 30 * 864e5 });
      return new Response(null, { status: 302, headers: { location: "/", "set-cookie": ck("sid", sid, 2592000) } });
    }
    if (p.startsWith("/api/kit/")) {
      const k = await st.get("kit-" + p.slice(9));
      return k ? new Response(k, { headers: { "content-type": "application/json" } }) : J({ e: "nf" }, 404);
    }
    const sid = cookie(req, "sid"), s = sid ? await st.get("s-" + sid, { type: "json" }) : null;
    if (!s || s.exp < Date.now()) return J({ e: "auth" }, 401);
    if (p === "/api/sync") return J(await collect(st));
    if (p === "/api/publish" && req.method === "POST") {
      const b = await req.text(); if (b.length > 4e6) return J({ e: "grande demais" }, 413);
      let slug = await st.get("slug"); if (!slug) { slug = rnd().slice(0, 14); await st.set("slug", slug); }
      await st.set("kit-" + slug, b); return J({ url: u.origin + "/kit/" + slug });
    }
    return J({ e: "nf" }, 404);
  } catch (e) { return J({ e: String(e.message || e) }, 500); }
};
export const config = { path: ["/api/*", "/auth/*"] };
