"use client";
import { loadShard, questionAssetUrls } from "@/lib/bank";

/** Per-topic offline download via the service worker (public/sw.js). */
export async function swReady(): Promise<ServiceWorker | null> {
  if (!("serviceWorker" in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg?.active ?? null;
}

export async function cachedTopics(): Promise<Set<string>> {
  if (typeof caches === "undefined") return new Set();
  return new Set((await caches.keys()).filter((k) => k.startsWith("otg-topic-")).map((k) => k.slice("otg-topic-".length)));
}

export async function downloadTopic(shard: string, onProgress: (done: number, total: number) => void): Promise<{ failed: number }> {
  const sw = await swReady();
  if (!sw) throw new Error("Offline downloads need the installed app (service worker not active; it runs in production builds only).");
  const data = await loadShard(shard);
  const urls = [`/bank/h2-physics/${shard}.json`, ...data.questions.flatMap(questionAssetUrls)];
  return new Promise((resolve) => {
    const onMsg = (e: MessageEvent) => {
      const m = e.data;
      if (m?.shard !== shard) return;
      if (m.type === "topic-progress") onProgress(m.done, m.total);
      if (m.type === "topic-done") {
        navigator.serviceWorker.removeEventListener("message", onMsg);
        resolve({ failed: m.failed });
      }
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    sw.postMessage({ type: "cache-topic", shard, urls });
  });
}

export async function dropTopic(shard: string) {
  if (typeof caches !== "undefined") await caches.delete(`otg-topic-${shard}`);
}

/** Keep the current quiz playable offline (replaces the previous quiz cache). */
export async function cacheQuizAssets(urls: string[]) {
  const sw = await swReady();
  sw?.postMessage({ type: "cache-quiz", urls });
}
