const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {
    buildLiveStatusSnapshot,
    buildVerificationFailureSnapshots,
    classifyPublishedStatus,
    selectFeaturedSermon
} = require("../live-status-state.js");

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "live-2026-09-29-reported.json"), "utf8"));
const CHANNEL_ID = fixture.channelId;
const LIVE = {
    id: fixture.videoId,
    title: fixture.reportedTitle,
    channelId: CHANNEL_ID,
    url: `https://www.youtube.com/watch?v=${fixture.videoId}`,
    thumbnail: `https://i.ytimg.com/vi/${fixture.videoId}/hqdefault.jpg`,
    type: "live",
    typePriority: 1,
    isLiveBroadcast: true,
    liveBroadcastContent: "LIVE",
    actualStartTime: fixture.actualStartTime,
    publishedAt: fixture.publishedAt,
    isLiveNow: true,
    isUpcoming: false,
    status: "live"
};

function previousNone(at) {
    return {
        channel: { channelId: CHANNEL_ID },
        updatedAt: at,
        status: {
            isLiveNow: false,
            activeLiveId: null,
            checkedAt: at,
            lastSuccessfulCheck: at,
            lastAttemptAt: at,
            verificationStatus: "ok"
        },
        activeLive: null,
        upcomingLive: null
    };
}

test("E2E regresión 29/09: YouTube LIVE -> detector -> estado -> JSON -> vista LIVE", () => {
    const observedAt = "2026-09-30T00:20:00Z";
    const snapshot = buildLiveStatusSnapshot(previousNone(observedAt), { activeLive: LIVE }, observedAt);
    const jsonRoundTrip = JSON.parse(JSON.stringify(snapshot));
    const view = classifyPublishedStatus(jsonRoundTrip, Date.parse(observedAt));
    assert.equal(jsonRoundTrip.status.activeLiveId, fixture.videoId);
    assert.equal(view.kind, "live");
    assert.equal(view.activeLive.title, fixture.reportedTitle);
    assert.equal(view.activeLive.id, fixture.videoId);
});

test("E2E frontend loadSermons: archived del 29/09 desplaza featured del 28/09", async () => {
    const source = fs.readFileSync(require.resolve("../script.js"), "utf8");
    const start = source.indexOf("async function loadSermons()");
    const end = source.indexOf("\nfunction setupSermonCards(", start);
    const oldPrayer = {
        id: "qiP_WB_kRcw",
        title: "Tiempo De Oración",
        url: "https://www.youtube.com/watch?v=qiP_WB_kRcw",
        thumbnail: "https://i.ytimg.com/vi/qiP_WB_kRcw/hqdefault.jpg",
        status: "archived",
        type: "live",
        isLiveBroadcast: true,
        actualStartTime: "2026-09-28T23:57:00Z",
        publishedAt: "2026-09-28T23:57:00Z"
    };
    const sermon = {
        ...LIVE,
        status: "archived",
        isLiveNow: false,
        isUpcoming: false,
        actualEndTime: fixture.actualEndTime
    };
    const normalVideo = {
        id: "NormalVid01",
        title: "Video normal publicado después",
        url: "https://www.youtube.com/watch?v=NormalVid01",
        thumbnail: "https://i.ytimg.com/vi/NormalVid01/hqdefault.jpg",
        status: "uploaded",
        type: "video",
        publishedAt: "2026-09-30T02:00:00Z"
    };
    const visibleItems = [oldPrayer, sermon, normalVideo];
    const liveStateApi = require("../live-status-state.js");
    let selectedFeatured = null;
    const context = {
        Date,
        AbortSignal,
        SERMONS_DATA_PATH: "data/predicaciones.json",
        LIVE_STATUS_DATA_PATH: "data/live-status.json",
        fetch: async (url) => ({
            ok: true,
            json: async () => String(url).includes("predicaciones")
                ? { items: visibleItems, featuredLiveToday: sermon }
                : previousNone("2026-09-30T02:00:00Z")
        }),
        window: { LiveStatusState: liveStateApi },
        sermonsFeatured: { innerHTML: "" },
        sermonsTrack: { innerHTML: "" },
        sermonsPrevButton: null,
        sermonsNextButton: null,
        latestLiveStatusData: null,
        liveStatusRequestSequence: 0,
        archivedFeaturedSermon: null,
        lastConfirmedLiveId: null,
        getStreamTime(item) { return Date.parse(item.actualStartTime || item.publishedAt); },
        getLiveStatusView(data) { return liveStateApi.classifyPublishedStatus(data, Date.parse("2026-09-30T02:00:00Z")); },
        renderLiveStatus() {},
        updateFeaturedSermon(item) { selectedFeatured = item; },
        renderSermonCard(item) { return `<article>${item.id}</article>`; },
        setupSermonCards() {},
        updateRailButtons() {},
        renderSermonsFallback() { throw new Error("No debe usar fallback con feed válido"); },
        console
    };
    vm.createContext(context);
    vm.runInContext(source.slice(start, end), context);
    await context.loadSermons();
    assert.equal(selectedFeatured.id, fixture.videoId);
    assert.match(context.sermonsTrack.innerHTML, new RegExp(fixture.videoId));
    assert.doesNotMatch(context.sermonsTrack.innerHTML, new RegExp(normalVideo.id));
    assert.ok(context.sermonsTrack.innerHTML.indexOf(fixture.videoId) < context.sermonsTrack.innerHTML.indexOf(oldPrayer.id));
});

test("E2E frontend: un fetch fallido no restaura un LIVE viejo desde latestLiveStatusData", async () => {
    const source = fs.readFileSync(require.resolve("../script.js"), "utf8");
    const start = source.indexOf("async function loadSermons()");
    const end = source.indexOf("\nfunction setupSermonCards(", start);
    const oldLive = buildLiveStatusSnapshot(previousNone("2026-09-30T02:00:00Z"), { activeLive: LIVE }, "2026-09-30T02:00:00Z");
    const archived = { ...LIVE, status: "archived", isLiveNow: false, actualEndTime: fixture.actualEndTime };
    const renderedViews = [];
    let renderedFeatured = null;
    const stateApi = require("../live-status-state.js");
    const context = {
        Date,
        AbortSignal,
        SERMONS_DATA_PATH: "https://data.example/predicaciones.json",
        LIVE_STATUS_DATA_PATH: "https://data.example/live-status.json",
        fetch: async (url) => {
            if (String(url).includes("predicaciones")) return { ok: true, json: async () => ({ items: [archived] }) };
            throw new Error("offline");
        },
        window: { LiveStatusState: stateApi },
        sermonsFeatured: { innerHTML: "" },
        sermonsTrack: { innerHTML: "" },
        sermonsPrevButton: null,
        sermonsNextButton: null,
        latestLiveStatusData: oldLive,
        liveStatusRequestSequence: 0,
        archivedFeaturedSermon: null,
        lastConfirmedLiveId: fixture.videoId,
        getStreamTime(item) { return Date.parse(item.actualStartTime || item.publishedAt); },
        getLiveStatusView(data) { return stateApi.classifyPublishedStatus(data, Date.parse("2026-09-30T02:00:00Z")); },
        renderLiveStatus(view) { renderedViews.push(view); },
        updateFeaturedSermon(item) { renderedFeatured = item; },
        renderSermonCard(item) { return `<article>${item.id}</article>`; },
        setupSermonCards() {},
        updateRailButtons() {},
        renderSermonsFallback() { throw new Error("No debe usar fallback con feed válido"); },
        console
    };
    vm.createContext(context);
    vm.runInContext(source.slice(start, end), context);
    await context.loadSermons();
    assert.equal(renderedViews.at(-1).kind, "error");
    assert.equal(renderedFeatured.id, fixture.videoId);
    assert.equal(renderedFeatured.status, "archived");
});

test("E2E frontend: respuesta LIVE tardía de loadSermons no reemplaza el ERROR de refreshLiveStatus", async () => {
    const source = fs.readFileSync(require.resolve("../script.js"), "utf8");
    const refreshStart = source.indexOf("async function refreshLiveStatus()");
    const loadStart = source.indexOf("async function loadSermons()");
    const loadEnd = source.indexOf("\nfunction setupSermonCards(", loadStart);
    const oldLive = buildLiveStatusSnapshot(previousNone("2026-09-30T02:00:00Z"), { activeLive: LIVE }, "2026-09-30T02:00:00Z");
    const archived = { ...LIVE, status: "archived", isLiveNow: false, actualEndTime: fixture.actualEndTime };
    let resolveSermons;
    let liveRequests = 0;
    const renderedViews = [];
    const stateApi = require("../live-status-state.js");
    const now = Date.parse("2026-09-30T02:00:00Z");
    const context = {
        Date,
        AbortSignal,
        LIVE_STATUS_DATA_PATH: "https://data.example/live-status.json",
        SERMONS_DATA_PATH: "https://data.example/predicaciones.json",
        LIVE_STATUS_MAX_AGE_MS: stateApi.DEFAULT_MAX_AGE_MS,
        liveStatusRefreshInFlight: false,
        liveStatusRequestSequence: 0,
        latestLiveStatusData: oldLive,
        lastConfirmedLiveId: LIVE.id,
        archivedFeaturedSermon: null,
        sermonsFeatured: { innerHTML: "" },
        sermonsTrack: { innerHTML: "" },
        sermonsPrevButton: null,
        sermonsNextButton: null,
        window: { LiveStatusState: stateApi },
        fetch: async (url) => {
            if (String(url).includes("predicaciones")) {
                return new Promise((resolve) => { resolveSermons = resolve; });
            }
            liveRequests += 1;
            if (liveRequests === 1) throw new Error("offline");
            return { ok: true, json: async () => oldLive };
        },
        getStreamTime(item) { return Date.parse(item.actualStartTime || item.publishedAt); },
        getLiveStatusView(data) { return stateApi.classifyPublishedStatus(data, now); },
        renderLiveStatus(view) { renderedViews.push(view); },
        updateFeaturedSermon() {},
        renderSermonCard(item) { return `<article>${item.id}</article>`; },
        setupSermonCards() {},
        updateRailButtons() {},
        renderSermonsFallback() { throw new Error("No debe usar fallback con feed válido"); },
        console
    };
    vm.createContext(context);
    vm.runInContext(source.slice(refreshStart, loadStart) + source.slice(loadStart, loadEnd), context);

    const loadPromise = context.loadSermons();
    const refreshPromise = context.refreshLiveStatus();
    await refreshPromise;
    assert.equal(renderedViews.at(-1).kind, "error", "el fallo más reciente deja la UI en estado ERROR");

    resolveSermons({ ok: true, json: async () => ({ items: [archived] }) });
    await loadPromise;
    assert.deepEqual(renderedViews.map((view) => view.kind), ["error"], "la respuesta LIVE iniciada antes del error no lo revierte");
    assert.equal(context.latestLiveStatusData, oldLive, "la respuesta obsoleta no sustituye el snapshot compartido");
});

test("E2E detector: respuesta live de videos.list produce activeLive para el frontend", async () => {
    const { getActiveLive } = await import("../scripts/update-sermons.mjs");
    const previousFetch = global.fetch;
    global.fetch = async () => { throw new Error("YouTube HTML temporalmente inaccesible"); };
    try {
        const detected = await getActiveLive([{
            ...LIVE,
            source: "youtube-data-api-uploads",
            liveBroadcastContent: "live",
            actualEndTime: null
        }], null, CHANNEL_ID);
        assert.equal(detected.activeLive.id, fixture.videoId);
        assert.equal(detected.activeLive.status, "live");
        const observedAt = "2026-09-30T00:20:00Z";
        const snapshot = buildLiveStatusSnapshot(previousNone(observedAt), detected, observedAt);
        assert.equal(classifyPublishedStatus(JSON.parse(JSON.stringify(snapshot)), Date.parse(observedAt)).kind, "live");
    } finally {
        global.fetch = previousFetch;
    }
});

test("E2E: un fallo temporal publica ERROR y evita mostrar el LIVE anterior", () => {
    const observedAt = "2026-09-30T00:20:00Z";
    const snapshot = buildLiveStatusSnapshot(previousNone(observedAt), { activeLive: LIVE }, observedAt);
    const failed = buildVerificationFailureSnapshots(snapshot, { items: [] }, "2026-09-30T00:25:00Z", new Error("HTTP 503"));
    const view = classifyPublishedStatus(failed.liveStatus, Date.parse("2026-09-30T00:25:00Z"));
    assert.equal(failed.liveStatus.status.lastError, "HTTP 503");
    assert.equal(failed.liveStatus.status.state, "ERROR");
    assert.equal(failed.liveStatus.activeLive, null);
    assert.equal(view.kind, "error");
    assert.equal(view.activeLive, undefined);
});

test("E2E: fin confirmado -> ARCHIVED_RECENT -> recientes y featured", () => {
    const observedAt = "2026-09-30T00:20:00Z";
    const liveSnapshot = buildLiveStatusSnapshot(previousNone(observedAt), { activeLive: LIVE }, observedAt);
    const archived = {
        ...LIVE,
        status: "archived",
        isLiveNow: false,
        liveBroadcastContent: "COMPLETED",
        actualEndTime: fixture.actualEndTime,
        endedAt: fixture.actualEndTime
    };
    const ended = buildLiveStatusSnapshot(liveSnapshot, {
        activeLive: null,
        endedLiveId: fixture.videoId,
        verificationStatus: "ok"
    }, "2026-09-30T01:30:00Z");
    const sermonsJson = JSON.parse(JSON.stringify({
        updatedAt: "2026-09-30T01:30:00Z",
        status: ended.status,
        activeLive: ended.activeLive,
        items: [archived]
    }));
    assert.equal(ended.status.isLiveNow, false);
    assert.equal(ended.status.lastEndedLiveId, fixture.videoId);
    assert.equal(sermonsJson.items[0].status, "archived");
    assert.equal(selectFeaturedSermon(sermonsJson.items).id, fixture.videoId);
});

test("E2E archivo: videos.list completed convierte candidate en registro reciente sin watch page", async () => {
    const { enrichArchivedStreams } = await import("../scripts/update-sermons.mjs");
    const [archive] = await enrichArchivedStreams([{
        ...LIVE,
        source: "youtube-data-api-uploads",
        liveBroadcastContent: "none",
        liveStreamingDetails: {
            actualStartTime: fixture.actualStartTime,
            actualEndTime: fixture.actualEndTime
        }
    }]);
    assert.equal(archive.status, "archived");
    assert.equal(archive.id, fixture.videoId);
    assert.equal(selectFeaturedSermon([archive]).id, fixture.videoId);
});

test("un fallo al consultar metadata de uploads no se convierte en archivo exitoso vacío", async () => {
    const { enrichArchivedStreams } = await import("../scripts/update-sermons.mjs");
    const previousFetch = global.fetch;
    global.fetch = async () => { throw new Error("HTTP 503"); };
    try {
        await assert.rejects(enrichArchivedStreams([{
            ...LIVE,
            source: "youtube-streams-page"
        }]), /No se verificaron 1 candidato/);
    } finally {
        global.fetch = previousFetch;
    }
});

test("E2E: actualEndTime de videos.list confirma ENDED sin conservar el LIVE como activo", async () => {
    const { getActiveLive } = await import("../scripts/update-sermons.mjs");
    const previousFetch = global.fetch;
    global.fetch = async () => new Response('var ytInitialData = {"contents":[]};', { status: 200 });
    try {
        const ended = await getActiveLive([{
            ...LIVE,
            source: "youtube-data-api-uploads",
            liveBroadcastContent: "none",
            actualEndTime: fixture.actualEndTime
        }], fixture.videoId, CHANNEL_ID);
        assert.equal(ended.activeLive, null);
        assert.equal(ended.endedLiveId, fixture.videoId);
        assert.equal(ended.endedLive.status, "archived");
        const snapshot = buildLiveStatusSnapshot({
            ...previousNone("2026-09-30T00:20:00Z"),
            status: { ...previousNone("2026-09-30T00:20:00Z").status, isLiveNow: true, activeLiveId: fixture.videoId },
            activeLive: LIVE
        }, ended, "2026-09-30T01:30:00Z");
        assert.equal(snapshot.status.isLiveNow, false);
        assert.equal(snapshot.status.lastEndedLiveId, fixture.videoId);
    } finally {
        global.fetch = previousFetch;
    }
});

test("E2E: upcoming y NONE no generan banner LIVE", () => {
    const upcoming = {
        ...previousNone("2026-09-30T00:00:00Z"),
        status: {
            isLiveNow: false,
            activeLiveId: null,
            upcomingLiveId: fixture.videoId,
            checkedAt: "2026-09-30T00:00:00Z",
            lastSuccessfulCheck: "2026-09-30T00:00:00Z",
            verificationStatus: "ok"
        },
        upcomingLive: { ...LIVE, isLiveNow: false, isUpcoming: true, status: "upcoming" }
    };
    assert.equal(classifyPublishedStatus(upcoming, Date.parse("2026-09-30T00:01:00Z")).kind, "upcoming");
    assert.equal(classifyPublishedStatus(previousNone("2026-09-30T00:00:00Z"), Date.parse("2026-09-30T00:01:00Z")).kind, "none");
    assert.equal(selectFeaturedSermon([upcoming.upcomingLive]), null);
});

test("E2E: errores y LIVE vencidos nunca aparecen como transmisiones activas", () => {
    const neverLive = {
        ...previousNone("2026-09-30T00:00:00Z"),
        status: { ...previousNone("2026-09-30T00:00:00Z").status, verificationStatus: "error" }
    };
    assert.equal(classifyPublishedStatus(neverLive, Date.parse("2026-09-30T00:01:00Z")).kind, "error");
    const confirmed = buildLiveStatusSnapshot(previousNone("2026-09-30T00:00:00Z"), { activeLive: LIVE }, "2026-09-30T00:00:00Z");
    const staleView = classifyPublishedStatus(confirmed, Date.parse("2026-09-30T01:00:00Z"));
    assert.equal(staleView.kind, "error");
    assert.equal(staleView.activeLive, undefined);
});

test("featured elige el livestream archivado por inicio real, no un video normal subido después", () => {
    const normalVideo = {
        id: "NormalVid01",
        title: "Video normal posterior",
        status: "uploaded",
        publishedAt: "2026-09-30T02:00:00Z"
    };
    const featured = selectFeaturedSermon([normalVideo, {
        ...LIVE,
        status: "archived",
        isLiveNow: false,
        actualEndTime: fixture.actualEndTime
    }]);
    assert.equal(featured.id, fixture.videoId);
});

test("zona horaria: timestamps UTC del fixture corresponden al 29/09 en Colombia", () => {
    const localDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Bogota",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(new Date(fixture.actualStartTime));
    assert.equal(localDate, fixture.localDate);
});

test("YouTube Data API recorre maxResults=50 con pageToken sin truncar historial en una página", async () => {
    const { fetchUploadsFromYouTubeDataApi } = await import("../scripts/update-sermons.mjs");
    const calls = [];
    const videoA = "PgTokA00001";
    const videoB = "PgTokB00002";
    const fetchImpl = async (url) => {
        const parsed = new URL(String(url));
        calls.push(parsed);
        if (parsed.pathname.endsWith("/playlistItems")) {
            const isSecond = parsed.searchParams.get("pageToken") === "page-2";
            return new Response(JSON.stringify(isSecond
                ? { items: [{ contentDetails: { videoId: videoB } }] }
                : { items: [{ contentDetails: { videoId: videoA } }], nextPageToken: "page-2" }), { status: 200 });
        }
        const ids = parsed.searchParams.get("id").split(",");
        return new Response(JSON.stringify({ items: ids.map((id) => ({
            id,
            snippet: { channelId: CHANNEL_ID, title: id, publishedAt: fixture.publishedAt, liveBroadcastContent: "none", thumbnails: {} },
            liveStreamingDetails: { actualStartTime: fixture.actualStartTime, actualEndTime: fixture.actualEndTime },
            contentDetails: { duration: "PT1H12M" }
        })) }), { status: 200 });
    };
    const items = await fetchUploadsFromYouTubeDataApi("test-key", fetchImpl);
    assert.equal(items.length, 2);
    assert.equal(items[0].duration, "1:12:00");
    assert.equal(calls.filter((url) => url.pathname.endsWith("/playlistItems")).length, 2);
    assert.equal(calls[0].searchParams.get("maxResults"), "50");
    assert.equal(calls[1].searchParams.get("pageToken"), "page-2");
});

test("una respuesta videos.list incompleta falla explícitamente en lugar de publicar una lista vacía", async () => {
    const { fetchUploadsFromYouTubeDataApi } = await import("../scripts/update-sermons.mjs");
    const fetchImpl = async (url) => {
        const parsed = new URL(String(url));
        if (parsed.pathname.endsWith("/playlistItems")) {
            return new Response(JSON.stringify({ items: [{ contentDetails: { videoId: "PgTokA00001" }, snippet: { publishedAt: fixture.publishedAt } }] }), { status: 200 });
        }
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
    };
    await assert.rejects(fetchUploadsFromYouTubeDataApi("test-key", fetchImpl), /videos.list omitió 1 video/);
});

test("diagnóstico videos.list separa video público sin liveStreamingDetails de un error y registra campos sin exponer la clave", async () => {
    const { diagnoseVideo } = await import("../scripts/update-sermons.mjs");
    const secret = "never-log-this-test-key";
    let requestedUrl;
    const messages = [];
    const originalInfo = console.info;
    console.info = (message) => messages.push(String(message));
    try {
        const result = await diagnoseVideo(fixture.videoId, secret, async (url) => {
            requestedUrl = new URL(String(url));
            return new Response(JSON.stringify({ items: [{
                id: fixture.videoId,
                snippet: { channelId: CHANNEL_ID, title: fixture.reportedTitle, publishedAt: fixture.publishedAt, liveBroadcastContent: "none" },
                contentDetails: { duration: "PT1H12M" },
                status: { privacyStatus: "public", uploadStatus: "processed" }
            }] }), { status: 200 });
        });
        assert.equal(requestedUrl.pathname, "/youtube/v3/videos");
        assert.equal(requestedUrl.searchParams.get("id"), fixture.videoId);
        assert.equal(requestedUrl.searchParams.get("part"), "snippet,contentDetails,status,liveStreamingDetails");
        assert.equal(requestedUrl.pathname.includes("channels"), false);
        assert.equal(result.returned, true);
        assert.equal(result.classification, "present-without-live-details");
        assert.ok(result.fieldsPresent.includes("snippet.channelId"));
        assert.ok(result.fieldsAbsent.includes("liveStreamingDetails.actualEndTime"));
        assert.ok(messages.every((message) => !message.includes(secret)));
    } finally {
        console.info = originalInfo;
    }
});

test("diagnóstico videos.list conserva razón y details de error API sin imprimir la clave", async () => {
    const { diagnoseVideo } = await import("../scripts/update-sermons.mjs");
    const secret = "never-log-this-test-key";
    const messages = [];
    const originalInfo = console.info;
    console.info = (message) => messages.push(String(message));
    try {
        await assert.rejects(diagnoseVideo(fixture.videoId, secret, async () => new Response(JSON.stringify({
            error: { code: 403, status: "quotaExceeded", message: `Quota exceeded ${secret}`, errors: [{ reason: "quotaExceeded" }], details: [{ reason: "dailyLimitExceeded", metadata: { note: secret, key: secret } }] }
        }), { status: 403 })), /quotaExceeded.*Quota exceeded.*quotaExceeded/);
        assert.ok(messages.some((message) => message.includes("dailyLimitExceeded")));
        assert.ok(messages.some((message) => message.includes("[REDACTED]")));
        assert.ok(messages.every((message) => !message.includes(secret)));
    } finally {
        console.info = originalInfo;
    }
});

test("diagnóstico videos.list distingue item no devuelto de item público sin liveStreamingDetails", async () => {
    const { diagnoseVideo } = await import("../scripts/update-sermons.mjs");
    const result = await diagnoseVideo(fixture.videoId, "safe-test-key", async () => new Response(JSON.stringify({ items: [] }), { status: 200 }));
    assert.equal(result.returned, false);
    assert.equal(result.classification, "not-returned");
    assert.match(result.absenceMeaning, /eliminado, privado o inaccesible/);
});

test("uploads no degrada channelId o liveBroadcastContent ausentes a filtro silencioso o NONE", async () => {
    const { fetchUploadsFromYouTubeDataApi } = await import("../scripts/update-sermons.mjs");
    const fetchImpl = async (url) => {
        const parsed = new URL(String(url));
        if (parsed.pathname.endsWith("/playlistItems")) {
            return new Response(JSON.stringify({ items: [{ contentDetails: { videoId: fixture.videoId }, snippet: { publishedAt: fixture.publishedAt } }] }), { status: 200 });
        }
        return new Response(JSON.stringify({ items: [{ id: fixture.videoId, snippet: { title: fixture.reportedTitle } }] }), { status: 200 });
    };
    await assert.rejects(fetchUploadsFromYouTubeDataApi("test-key", fetchImpl), /falta metadata necesaria.*snippet.channelId,snippet.liveBroadcastContent/);
});

test("diagnóstico videos.list separa un cuerpo JSON malformado de un error HTTP/API", async () => {
    const { diagnoseVideo } = await import("../scripts/update-sermons.mjs");
    await assert.rejects(diagnoseVideo(fixture.videoId, "safe-test-key", async () => new Response("not-json", { status: 200 })), /JSON.parse falló/);
});

test("un video público de /streams sin liveStreamingDetails se conserva como archivo si videos.list confirma none", async () => {
    const { enrichArchivedStreams } = await import("../scripts/update-sermons.mjs");
    const [archive] = await enrichArchivedStreams([{
        id: fixture.videoId,
        title: fixture.reportedTitle,
        source: "youtube-data-api-uploads",
        listedOnStreamsPage: true,
        channelId: CHANNEL_ID,
        liveBroadcastContent: "none",
        liveStreamingDetails: {},
        publishedAt: fixture.publishedAt,
        url: `https://www.youtube.com/watch?v=${fixture.videoId}`
    }]);
    assert.equal(archive.id, fixture.videoId);
    assert.equal(archive.status, "archived");
    assert.equal(archive.isLiveNow, false);
    assert.equal(archive.verificationSource, "youtube-streams-page-and-videos-list");
    assert.equal(archive.actualEndTime, undefined);
});

test("el detector usa videos.list aunque falte videoDetails.channelId en HTML y no eleva falso error", async () => {
    const { getActiveLive } = await import("../scripts/update-sermons.mjs");
    const originalFetch = global.fetch;
    const requested = [];
    global.fetch = async (url) => {
        requested.push(String(url));
        return new Response("var ytInitialData = {};", { status: 200 });
    };
    try {
        const detected = await getActiveLive([
            { id: fixture.videoId, title: fixture.reportedTitle, source: "youtube-streams-page" },
            {
                id: fixture.videoId,
                title: fixture.reportedTitle,
                source: "youtube-data-api-uploads",
                channelId: CHANNEL_ID,
                liveBroadcastContent: "none",
                liveStreamingDetails: {}
            }
        ]);
        assert.equal(detected.activeLive, null);
        assert.equal(detected.verificationStatus, "ok");
        assert.equal(requested.some((url) => url.includes("/watch?v=")), false);
    } finally {
        global.fetch = originalFetch;
    }
});

test("videos.list del candidato conocido confirma ENDED con metadata obtenida por lookup directo", async () => {
    const { getActiveLive } = await import("../scripts/update-sermons.mjs");
    const originalFetch = global.fetch;
    const originalKey = process.env.YOUTUBE_API_KEY;
    process.env.YOUTUBE_API_KEY = "safe-test-key";
    global.fetch = async (url) => {
        const parsed = new URL(String(url));
        if (parsed.hostname === "www.googleapis.com") {
            return new Response(JSON.stringify({ items: [{
                id: fixture.videoId,
                snippet: { channelId: CHANNEL_ID, title: fixture.reportedTitle, publishedAt: fixture.publishedAt, liveBroadcastContent: "none" },
                liveStreamingDetails: { actualStartTime: fixture.actualStartTime, actualEndTime: fixture.actualEndTime }
            }] }), { status: 200 });
        }
        return new Response("var ytInitialData = {};", { status: 200 });
    };
    try {
        const detected = await getActiveLive([{ id: fixture.videoId, source: "youtube-streams-page" }], fixture.videoId);
        assert.equal(detected.knownLiveEnded, true);
        assert.equal(detected.endedLive.id, fixture.videoId);
        assert.equal(detected.endedLive.status, "archived");
    } finally {
        global.fetch = originalFetch;
        if (originalKey === undefined) delete process.env.YOUTUBE_API_KEY;
        else process.env.YOUTUBE_API_KEY = originalKey;
    }
});
