// Credentials live only in the requesting page's memory, never in worker storage.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
async function authorizationFor(clientId) {
  if (!clientId) return "";
  const client = await self.clients.get(clientId);
  if (!client || new URL(client.url).origin !== self.location.origin) return "";
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const finish = (authorization) => {
      clearTimeout(timer);
      channel.port1.close();
      channel.port2.close();
      resolve(authorization);
    };
    const timer = setTimeout(() => finish(""), 1500);
    channel.port1.onmessage = (event) => {
      const value = event.data?.authorization;
      finish(
        typeof value === "string" &&
          value.length <= 8192 &&
          /^Basic [A-Za-z0-9+/]+={0,2}$/.test(value)
          ? value
          : "",
      );
    };
    channel.port1.onmessageerror = () => finish("");
    try {
      client.postMessage({ type: "blc:media-auth-request" }, [channel.port2]);
    } catch {
      // The originating page may close between clients.get and postMessage.
      finish("");
    }
  });
}
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== "GET")
    return;
  if (
    !/^\/(?:api\/clips\/\d+\/(?:video|cover)|api\/transcripts\/\d+\/source-mp4|review\/api\/\d+\/(?:preview|waveform))$/.test(
      url.pathname,
    )
  )
    return;
  event.respondWith(
    authorizationFor(event.clientId).then((authorization) => {
      // Unauthenticated tabs and Docker cookie sessions use their own request.
      if (!authorization) return fetch(event.request);
      const headers = new Headers(event.request.headers);
      headers.set("Authorization", authorization);
      return fetch(
        new Request(event.request, {
          headers,
          mode: "same-origin",
          credentials: "same-origin",
          cache: "no-store",
        }),
      );
    }),
  );
});
