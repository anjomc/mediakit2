// Roda todo dia sozinha e guarda o histórico de seguidores/métricas.
import { getStore } from "@netlify/blobs";
import { snap } from "../lib/ig.mjs";
export default async () => { await snap(getStore("mediakit")); };
export const config = { schedule: "@daily" };
