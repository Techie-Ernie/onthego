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
  const urls = [...new Set([`/bank/h2-physics/${shard}.json`, ...data.questions.flatMap(questionAssetUrls)])];
  return new Promise((resolve, reject) => {
    const workers = navigator.serviceWorker;
    const cleanup = () => {
      clearTimeout(timeout);
      workers.removeEventListener("message", onMsg);
    };
    const stalled = () => {
      cleanup();
      reject(new Error("Download stopped responding. Try again."));
    };
    let timeout = setTimeout(stalled, 60_000);
    const onMsg = (e: MessageEvent) => {
      const m = e.data;
      if (m?.shard !== shard) return;
      if (m.type === "topic-progress") {
        clearTimeout(timeout);
        timeout = setTimeout(stalled, 60_000);
        onProgress(m.done, m.total);
      }
      if (m.type === "topic-done") {
        cleanup();
        resolve({ failed: m.failed });
      }
    };
    workers.addEventListener("message", onMsg);
    try {
      sw.postMessage({ type: "cache-topic", shard, urls });
    } catch (error) {
      cleanup();
      reject(error);
    }
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
