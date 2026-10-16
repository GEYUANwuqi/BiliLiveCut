// Credentials live only in memory and are scoped to the requesting browser tab.
const credentials = new Map();
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("message", (event) => {
  if (
    !event.source?.id ||
    new URL(event.source.url).origin !== self.location.origin ||
    event.data?.type !== "blc:media-auth"
  )
    return;
  if (
    typeof event.data.authorization === "string" &&
    event.data.authorization.startsWith("Basic ")
  )
    credentials.set(event.source.id, event.data.authorization);
  else credentials.delete(event.source.id);
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const authorization = credentials.get(event.clientId);
  if (
    !authorization ||
    url.origin !== self.location.origin ||
    event.request.method !== "GET"
  )
    return;
  if (
    !/^\/(?:api\/clips\/\d+\/(?:video|cover)|api\/transcripts\/\d+\/source-mp4|review\/api\/\d+\/(?:preview|waveform))$/.test(
      url.pathname,
    )
  )
    return;
  const headers = new Headers(event.request.headers);
  headers.set("Authorization", authorization);
  event.respondWith(
    fetch(
      new Request(event.request, {
        headers,
        mode: "same-origin",
        credentials: "same-origin",
        cache: "no-store",
      }),
    ),
  );
});
