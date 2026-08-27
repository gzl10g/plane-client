import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PlaneClient } from "../src/client.js";
import { createRateLimitState } from "../src/rate-limit.js";

/**
 * Plane throttles per API key and reports the quota on every response. Before
 * pacing, the client only retried blind on 429 — so a long sweep discovered the
 * limit by hitting it, and the backoff was a guess unrelated to the real window.
 */
function mockFetch(responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  let i = 0;
  globalThis.fetch = async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    const r = responses[Math.min(i++, responses.length - 1)];
    return new Response(r.status === 204 ? null : JSON.stringify(r.body ?? { results: [] }), {
      status: r.status,
      statusText: "OK",
      headers: r.headers,
    });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function epochSecondsIn(ms: number): string {
  return String(Math.ceil((Date.now() + ms) / 1000));
}

function makeClient(config: Partial<ConstructorParameters<typeof PlaneClient>[0]> = {}) {
  return new PlaneClient({
    baseUrl: "https://plane.test",
    apiKey: "pk",
    workspace: "ws",
    retry: { maxRetries: 0 },
    ...config,
  });
}

describe("rate limit pacing", () => {
  it("does not wait while the quota is healthy", async () => {
    const throttles: unknown[] = [];
    const client = makeClient({ onThrottle: (i) => throttles.push(i) });
    const mock = mockFetch([
      { status: 200, headers: { "x-ratelimit-remaining": "59", "x-ratelimit-reset": epochSecondsIn(60_000) } },
      { status: 200, headers: { "x-ratelimit-remaining": "58", "x-ratelimit-reset": epochSecondsIn(60_000) } },
    ]);
    try {
      await client.states.list("p1");
      await client.states.list("p1");
      assert.deepEqual(throttles, []);
    } finally { mock.restore(); }
  });

  it("waits for the window when the quota is spent", async () => {
    const throttles: { waitMs: number; reason: string; remaining?: number }[] = [];
    const client = makeClient({
      onThrottle: (i) => throttles.push(i),
      rateLimit: { maxWaitMs: 60 },
    });
    const mock = mockFetch([
      { status: 200, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": epochSecondsIn(30_000) } },
      { status: 200, headers: { "x-ratelimit-remaining": "59", "x-ratelimit-reset": epochSecondsIn(60_000) } },
    ]);
    try {
      await client.states.list("p1");
      const startedAt = Date.now();
      await client.states.list("p1");

      assert.equal(throttles.length, 1);
      assert.equal(throttles[0].reason, "quota");
      assert.equal(throttles[0].remaining, 0);
      // maxWaitMs caps the sleep, so the test costs 60ms rather than 30s.
      assert.ok(Date.now() - startedAt >= 50, "it should actually have waited");
    } finally { mock.restore(); }
  });

  it("does not wait when the reset is already in the past", async () => {
    const throttles: unknown[] = [];
    const client = makeClient({ onThrottle: (i) => throttles.push(i) });
    const mock = mockFetch([
      { status: 200, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) - 120) } },
      { status: 200, headers: { "x-ratelimit-remaining": "59", "x-ratelimit-reset": epochSecondsIn(60_000) } },
    ]);
    try {
      await client.states.list("p1");
      await client.states.list("p1");
      assert.deepEqual(throttles, [], "a stale window is not a reason to sleep");
    } finally { mock.restore(); }
  });

  // An instance that sends no headers must behave exactly as it did before.
  it("stays out of the way when the instance reports no quota", async () => {
    const throttles: unknown[] = [];
    const client = makeClient({ onThrottle: (i) => throttles.push(i) });
    const mock = mockFetch([{ status: 200 }, { status: 200 }]);
    try {
      await client.states.list("p1");
      await client.states.list("p1");
      assert.deepEqual(throttles, []);
    } finally { mock.restore(); }
  });

  it("ignores unparseable header values instead of guessing", async () => {
    const throttles: unknown[] = [];
    const client = makeClient({ onThrottle: (i) => throttles.push(i) });
    const mock = mockFetch([
      { status: 200, headers: { "x-ratelimit-remaining": "unknown", "x-ratelimit-reset": "soon" } },
      { status: 200 },
    ]);
    try {
      await client.states.list("p1");
      await client.states.list("p1");
      assert.deepEqual(throttles, []);
    } finally { mock.restore(); }
  });

  it("can be turned off", async () => {
    const throttles: unknown[] = [];
    const client = makeClient({ onThrottle: (i) => throttles.push(i), rateLimit: { enabled: false } });
    const mock = mockFetch([
      { status: 200, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": epochSecondsIn(60_000) } },
      { status: 200 },
    ]);
    try {
      await client.states.list("p1");
      await client.states.list("p1");
      assert.deepEqual(throttles, []);
    } finally { mock.restore(); }
  });

  it("honours minRemaining as the threshold", async () => {
    const throttles: { remaining?: number }[] = [];
    const client = makeClient({
      onThrottle: (i) => throttles.push(i),
      rateLimit: { minRemaining: 10, maxWaitMs: 10 },
    });
    const mock = mockFetch([
      { status: 200, headers: { "x-ratelimit-remaining": "8", "x-ratelimit-reset": epochSecondsIn(60_000) } },
      { status: 200 },
    ]);
    try {
      await client.states.list("p1");
      await client.states.list("p1");
      assert.equal(throttles.length, 1);
      assert.equal(throttles[0].remaining, 8);
    } finally { mock.restore(); }
  });
});

describe("Retry-After on 429", () => {
  it("waits what the 429 asked for, not the fixed backoff", async () => {
    const throttles: { waitMs: number; reason: string }[] = [];
    const client = makeClient({
      retry: { maxRetries: 1 },
      onThrottle: (i) => throttles.push(i),
      rateLimit: { maxWaitMs: 50 },
    });
    const mock = mockFetch([
      { status: 429, headers: { "retry-after": "30" } },
      { status: 200 },
    ]);
    try {
      await client.states.list("p1");
      const retryAfter = throttles.filter((t) => t.reason === "retry-after");
      assert.equal(retryAfter.length, 1);
      assert.equal(retryAfter[0].waitMs, 50, "capped by maxWaitMs");
      assert.equal(mock.calls.length, 2, "and it did retry");
    } finally { mock.restore(); }
  });

  it("accepts Retry-After as an HTTP date", async () => {
    const throttles: { waitMs: number; reason: string }[] = [];
    const client = makeClient({
      retry: { maxRetries: 1 },
      onThrottle: (i) => throttles.push(i),
      rateLimit: { maxWaitMs: 20 },
    });
    const mock = mockFetch([
      { status: 429, headers: { "retry-after": new Date(Date.now() + 30_000).toUTCString() } },
      { status: 200 },
    ]);
    try {
      await client.states.list("p1");
      assert.equal(throttles.filter((t) => t.reason === "retry-after").length, 1);
    } finally { mock.restore(); }
  });

  it("falls back to the backoff when the 429 says nothing", async () => {
    const throttles: unknown[] = [];
    const client = makeClient({ retry: { maxRetries: 1 }, onThrottle: (i) => throttles.push(i) });
    const mock = mockFetch([{ status: 429 }, { status: 200 }]);
    try {
      await client.states.list("p1");
      assert.equal(mock.calls.length, 2);
      assert.deepEqual(throttles, [], "no Retry-After means no throttle hook");
    } finally { mock.restore(); }
  });
});

describe("header edge cases", () => {
  // `Number(null)` es 0, y 0 es finito: leer la cabecera sin comprobar ausencia
  // convertía «la instancia no manda cabeceras» en «cuota agotada». Un proxy que
  // reenvía `reset` pero no `remaining` bastaba para parar cada request.
  it("a missing remaining header is not a spent quota", async () => {
    const throttles: unknown[] = [];
    const client = makeClient({ onThrottle: (i) => throttles.push(i), rateLimit: { maxWaitMs: 50 } });
    const mock = mockFetch([
      { status: 200, headers: { "x-ratelimit-reset": epochSecondsIn(60_000) } },
      { status: 200 },
    ]);
    try {
      await client.states.list("p1");
      await client.states.list("p1");
      assert.deepEqual(throttles, [], "no remaining header means no quota knowledge, not zero quota");
    } finally { mock.restore(); }
  });

  it("a missing reset header leaves pacing inert", async () => {
    const throttles: unknown[] = [];
    const client = makeClient({ onThrottle: (i) => throttles.push(i) });
    const mock = mockFetch([
      { status: 200, headers: { "x-ratelimit-remaining": "0" } },
      { status: 200 },
    ]);
    try {
      await client.states.list("p1");
      await client.states.list("p1");
      assert.deepEqual(throttles, []);
    } finally { mock.restore(); }
  });

  // Si la espera se recortó por maxWaitMs seguimos throttleados: olvidar la
  // ventana ahí manda la siguiente request directa al 429 que acabamos de evitar.
  //
  // La respuesta intermedia va SIN cabeceras a propósito: si la ventana se
  // repusiera en cada respuesta, olvidarla o no daría el mismo resultado y el
  // test no distinguiría nada (comprobado — la primera versión de este caso no
  // cazaba la regresión). Sin cabeceras, lo único que queda es lo que el pacing
  // recordó.
  it("a wait clipped by maxWaitMs does not forget the window", async () => {
    const throttles: { waitMs: number }[] = [];
    const client = makeClient({ onThrottle: (i) => throttles.push(i), rateLimit: { maxWaitMs: 20 } });
    const mock = mockFetch([
      // Ventana de una hora, muy por encima de maxWaitMs: la espera se recorta.
      { status: 200, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": epochSecondsIn(3_600_000) } },
      { status: 200 },
      { status: 200 },
    ]);
    try {
      await client.states.list("p1");
      await client.states.list("p1");
      await client.states.list("p1");

      assert.equal(
        throttles.length,
        2,
        "the clipped wait served only 20ms of an hour-long window, so it is still throttled",
      );
    } finally { mock.restore(); }
  });

  it("a wait served in full does clear the window", async () => {
    const throttles: unknown[] = [];
    const client = makeClient({ onThrottle: (i) => throttles.push(i), rateLimit: { maxWaitMs: 5_000 } });
    const mock = mockFetch([
      // Reset a 30ms: la espera cabe entera en maxWaitMs, la ventana rota de verdad.
      { status: 200, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": epochSecondsIn(30) } },
      { status: 200 },
      { status: 200 },
    ]);
    try {
      await client.states.list("p1");
      await client.states.list("p1");
      await client.states.list("p1");

      assert.equal(throttles.length, 1, "waited once, then the window was genuinely over");
    } finally { mock.restore(); }
  });
});

describe("shared quota state", () => {
  // Plane throttlea por API KEY, no por cliente. Un barrido cross-workspace
  // construye un cliente por workspace: sin estado compartido, el segundo
  // arranca ciego y se come el 429 que el primero ya veía venir.
  it("a second client on the same key inherits the quota the first one saw", async () => {
    const throttles: { remaining?: number }[] = [];
    const quota = createRateLimitState();
    const first = makeClient({ rateLimit: { quota, maxWaitMs: 20 }, onThrottle: (i) => throttles.push(i) });
    const second = makeClient({ rateLimit: { quota, maxWaitMs: 20 }, onThrottle: (i) => throttles.push(i) });
    const mock = mockFetch([
      { status: 200, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": epochSecondsIn(60_000) } },
      { status: 200, headers: { "x-ratelimit-remaining": "59", "x-ratelimit-reset": epochSecondsIn(120_000) } },
    ]);
    try {
      await first.states.list("p1");
      await second.states.list("p1");

      assert.equal(throttles.length, 1, "the second client paced on what the first one learned");
      assert.equal(throttles[0].remaining, 0);
    } finally { mock.restore(); }
  });

  it("without a shared state each client starts blind", async () => {
    const throttles: unknown[] = [];
    const first = makeClient({ rateLimit: { maxWaitMs: 20 }, onThrottle: (i) => throttles.push(i) });
    const second = makeClient({ rateLimit: { maxWaitMs: 20 }, onThrottle: (i) => throttles.push(i) });
    const mock = mockFetch([
      { status: 200, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": epochSecondsIn(60_000) } },
      { status: 200, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": epochSecondsIn(60_000) } },
    ]);
    try {
      await first.states.list("p1");
      await second.states.list("p1");
      assert.deepEqual(throttles, [], "documents why the report shares one state");
    } finally { mock.restore(); }
  });
});

describe("implausible reset values", () => {
  // La cabecera es un epoch en segundos. Dos convenciones vecinas pasarían por
  // una multiplicación a secas y rompen el pacing en direcciones opuestas.
  it("ignores a reset that looks like delta-seconds instead of an epoch", async () => {
    const throttles: unknown[] = [];
    const client = makeClient({ onThrottle: (i) => throttles.push(i), rateLimit: { maxWaitMs: 20 } });
    const mock = mockFetch([
      // 42 segundos desde 1970: el pacing lo leería como "ventana ya pasada".
      { status: 200, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "42" } },
      { status: 200 },
    ]);
    try {
      await client.states.list("p1");
      await client.states.list("p1");
      assert.deepEqual(throttles, [], "a value that cannot be an epoch is discarded, not obeyed");
    } finally { mock.restore(); }
  });

  // El caso peligroso: milisegundos harían dormir el máximo en CADA request.
  it("ignores a reset already expressed in milliseconds", async () => {
    const throttles: unknown[] = [];
    const client = makeClient({ onThrottle: (i) => throttles.push(i), rateLimit: { maxWaitMs: 20 } });
    const mock = mockFetch([
      { status: 200, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Date.now()) } },
      { status: 200 },
    ]);
    try {
      await client.states.list("p1");
      await client.states.list("p1");
      assert.deepEqual(throttles, [], "milliseconds land thousands of years out and are refused");
    } finally { mock.restore(); }
  });
});

describe("headers are tracked independently", () => {
  // El guard antiguo solo cubría que faltaran LAS DOS: si llegaba una sola, la
  // otra se pisaba con undefined y el pacing se apagaba.
  it("a response with only remaining does not erase the known reset", async () => {
    const throttles: unknown[] = [];
    const client = makeClient({ onThrottle: (i) => throttles.push(i), rateLimit: { maxWaitMs: 20 } });
    const mock = mockFetch([
      { status: 200, headers: { "x-ratelimit-remaining": "40", "x-ratelimit-reset": epochSecondsIn(60_000) } },
      { status: 200, headers: { "x-ratelimit-remaining": "0" } },
      { status: 200 },
    ]);
    try {
      await client.states.list("p1");
      await client.states.list("p1");
      await client.states.list("p1");
      assert.equal(throttles.length, 1, "the reset from the first response still applies");
    } finally { mock.restore(); }
  });
});

describe("configuration is clamped, not trusted", () => {
  it("a negative minRemaining does not silently disable pacing", async () => {
    const throttles: unknown[] = [];
    const client = makeClient({
      onThrottle: (i) => throttles.push(i),
      rateLimit: { minRemaining: -5, maxWaitMs: 20 },
    });
    const mock = mockFetch([
      { status: 200, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": epochSecondsIn(60_000) } },
      { status: 200, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": epochSecondsIn(60_000) } },
    ]);
    try {
      await client.states.list("p1");
      await client.states.list("p1");
      assert.equal(throttles.length, 1, "clamped to 0, so a spent quota still waits");
    } finally { mock.restore(); }
  });
});

describe("Retry-After edge cases", () => {
  it("an empty Retry-After is not a hot retry", async () => {
    const throttles: { reason: string }[] = [];
    const client = makeClient({ retry: { maxRetries: 1 }, onThrottle: (i) => throttles.push(i) });
    const mock = mockFetch([{ status: 429, headers: { "retry-after": "  " } }, { status: 200 }]);
    try {
      await client.states.list("p1");
      assert.equal(
        throttles.filter((t) => t.reason === "retry-after").length,
        0,
        "a junk header falls through to the backoff instead of retrying immediately",
      );
      assert.equal(mock.calls.length, 2);
    } finally { mock.restore(); }
  });
});
