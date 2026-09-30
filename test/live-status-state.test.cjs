const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const {
    DEFAULT_MAX_AGE_MS,
    classifyYouTubeBroadcast,
    classifyPublishedStatus,
    buildVerificationFailureSnapshots,
    buildLiveStatusSnapshot,
    preservePreviousLiveOnUnconfirmedUpdate,
    getAuthoritativeActiveLive
} = require("../live-status-state.js");

const VIDEO_ID = "AREicxKfd5U";
const NOW = Date.parse("2026-09-27T02:00:00.000Z");
const freshStatus = (overrides = {}) => ({
    channel: { channelId: "UCX0kEGTVJtlkrIxXk9tSF6A" },
    updatedAt: new Date(NOW).toISOString(),
    status: { isLiveNow: false, activeLiveId: null, checkedAt: new Date(NOW).toISOString(), verificationStatus: "verified", ...overrides },
    activeLive: null,
    upcomingLive: null
});

test("máquina YouTube: UPCOMING → LIVE → ENDED → ARCHIVED", () => {
    const upcoming = classifyYouTubeBroadcast({
        requestedVideoId: VIDEO_ID,
        videoId: VIDEO_ID,
        isLiveContent: true,
        isLiveBroadcast: true,
        liveBroadcastContent: "UPCOMING",
        liveBroadcastDetails: { scheduledStartTime: "2026-09-27T02:30:00.000Z" },
        scheduledStartTime: "2026-09-27T02:30:00.000Z"
    }, NOW);
    assert.equal(upcoming.isUpcoming, true);
    assert.equal(upcoming.isLiveNow, false);

    const live = classifyYouTubeBroadcast({
        requestedVideoId: VIDEO_ID,
        videoId: VIDEO_ID,
        isLiveContent: true,
        isLiveBroadcast: true,
        liveBroadcastContent: "LIVE",
        liveBroadcastDetails: { isLiveNow: true, actualStartTime: "2026-09-27T01:30:00.000Z" }
    }, NOW);
    assert.equal(live.isLiveNow, true);
    assert.equal(live.isUpcoming, false);

    const localizedLiveSignal = classifyYouTubeBroadcast({
        requestedVideoId: VIDEO_ID,
        videoId: VIDEO_ID,
        isLiveContent: true,
        liveBroadcastContent: "EN DIRECTO",
        liveBroadcastDetails: { isLiveNow: true }
    }, NOW);
    assert.equal(localizedLiveSignal.isLiveNow, true);

    const ended = classifyYouTubeBroadcast({
        requestedVideoId: VIDEO_ID,
        videoId: VIDEO_ID,
        isLiveContent: true,
        isLiveBroadcast: true,
        wasLive: true,
        liveBroadcastContent: "LIVE",
        liveBroadcastDetails: { isLiveNow: true, actualStartTime: "2026-09-27T01:30:00.000Z", actualEndTime: "2026-09-27T02:00:00.000Z" }
    }, NOW);
    assert.equal(ended.isLiveNow, false, "actualEndTime prevalece sobre señales LIVE contradictorias");
    assert.equal(ended.hasEnded, true);
    assert.equal(ended.isArchived, true);
    assert.equal(ended.actualEndTime, "2026-09-27T02:00:00.000Z");

    const completed = classifyYouTubeBroadcast({
        requestedVideoId: VIDEO_ID,
        videoId: VIDEO_ID,
        isLiveContent: true,
        isLiveBroadcast: true,
        liveBroadcastContent: "COMPLETED"
    }, NOW);
    assert.equal(completed.isLiveNow, false);
    assert.equal(completed.isArchived, true);
});

test("video normal y señales históricas no producen LIVE activo", () => {
    const normal = classifyYouTubeBroadcast({ requestedVideoId: VIDEO_ID, videoId: VIDEO_ID });
    assert.equal(normal.isLiveNow, false);
    assert.equal(normal.isArchived, false);

    const durationNull = classifyYouTubeBroadcast({
        requestedVideoId: VIDEO_ID,
        videoId: VIDEO_ID,
        isLiveBroadcast: true,
        publishedText: "Comenzó a transmitir hace 69 minutos"
    });
    assert.equal(durationNull.isLiveNow, false);

    const mismatch = classifyYouTubeBroadcast({
        requestedVideoId: VIDEO_ID,
        videoId: "xxxxxxxxxxx",
        isLiveContent: true,
        isLiveBroadcast: true,
        liveBroadcastContent: "LIVE",
        liveBroadcastDetails: { isLiveNow: true }
    });
    assert.equal(mismatch.isLiveNow, false);

    const otherChannel = classifyYouTubeBroadcast({
        requestedVideoId: VIDEO_ID,
        videoId: VIDEO_ID,
        expectedChannelId: "UCX0kEGTVJtlkrIxXk9tSF6A",
        channelId: "UC_OTHER_CHANNEL_ID",
        isLiveContent: true,
        isLiveBroadcast: true,
        liveBroadcastContent: "LIVE",
        liveBroadcastDetails: { isLiveNow: true }
    });
    assert.equal(otherChannel.channelMatches, false);
    assert.equal(otherChannel.isLiveNow, false);
});

test("estado publicado: frescura separada de LIVE, error temporal, finalizado y upcoming", () => {
    const activeLive = { id: VIDEO_ID, isUpcoming: false, status: "live" };
    const live = {
        ...freshStatus({ isLiveNow: true, activeLiveId: VIDEO_ID }),
        activeLive
    };
    assert.equal(classifyPublishedStatus(live, NOW).kind, "live");
    const staleLive = classifyPublishedStatus(live, NOW + DEFAULT_MAX_AGE_MS + 1);
    assert.equal(staleLive.kind, "stale");
    assert.equal(staleLive.activeLive.id, VIDEO_ID, "se conserva la referencia conocida para mostrar estado sin verificar");

    const failed = { ...live, status: { ...live.status, verificationStatus: "error", lastError: "YouTube 429" } };
    const failedLive = classifyPublishedStatus(failed, NOW);
    assert.equal(failedLive.kind, "live");
    assert.equal(failedLive.lastError, "YouTube 429");
    const failedAndOld = {
        ...failed,
        status: { ...failed.status, checkedAt: new Date(NOW - 170 * 60 * 1000).toISOString() }
    };
    const failedAndOldView = classifyPublishedStatus(failedAndOld, NOW);
    assert.equal(failedAndOldView.kind, "stale");
    assert.equal(failedAndOldView.activeLive.id, VIDEO_ID);

    const contradictory = { ...live, activeLive: null };
    assert.equal(classifyPublishedStatus(contradictory, NOW).kind, "stale");
    assert.equal(classifyPublishedStatus({
        ...freshStatus({ isLiveNow: false, activeLiveId: null }),
        activeLive
    }, NOW).kind, "stale");
    const innerFlagMismatch = {
        ...live,
        activeLive: { ...activeLive, isLiveNow: false }
    };
    const normalizedLive = classifyPublishedStatus(innerFlagMismatch, NOW);
    assert.equal(normalizedLive.kind, "live");
    assert.equal(normalizedLive.activeLive.isLiveNow, true);

    const upcoming = {
        ...freshStatus({ upcomingLiveId: VIDEO_ID }),
        upcomingLive: { id: VIDEO_ID, scheduledStartTime: "2026-09-27T02:30:00.000Z" }
    };
    assert.equal(classifyPublishedStatus(upcoming, NOW).kind, "upcoming");
    assert.equal(classifyPublishedStatus(freshStatus(), NOW).kind, "none");
});

test("la decisión real del frontend conserva LIVE durante error temporal y pasa a neutral al vencer la confirmación", () => {
    const source = fs.readFileSync(require.resolve("../script.js"), "utf8");
    const start = source.indexOf("function getLiveStatusView(");
    const end = source.indexOf("\nfunction getLiveSignature(", start);
    const context = {
        Date,
        URL,
        LIVE_STATUS_MAX_AGE_MS: DEFAULT_MAX_AGE_MS,
        window: { LiveStatusState: require("../live-status-state.js") }
    };
    vm.createContext(context);
    vm.runInContext(source.slice(start, end), context);

    const active = {
        ...freshStatus({ isLiveNow: true, activeLiveId: VIDEO_ID }),
        activeLive: { id: VIDEO_ID, title: "Servicio", isUpcoming: false, status: "live" }
    };
    assert.equal(context.getLiveStatusView(active, NOW).kind, "live");
    const stale = context.getLiveStatusView(active, NOW + DEFAULT_MAX_AGE_MS + 1);
    assert.equal(stale.kind, "stale");
    assert.equal(stale.activeLive.id, VIDEO_ID);
    active.status.verificationStatus = "error";
    assert.equal(context.getLiveStatusView(active, NOW).kind, "live");
    assert.equal(classifyPublishedStatus(freshStatus(), NOW).kind, "none");
});

test("aviso del frontend: false → true → mismo live → false → nuevo live", () => {
    const source = fs.readFileSync(require.resolve("../script.js"), "utf8");
    const start = source.indexOf("function getLiveSignature(");
    const end = source.indexOf("\nasync function refreshLiveStatus()", start);
    const slot = {
        hidden: true,
        innerHTML: "",
        classList: {
            add() {},
            remove() {}
        },
        querySelector() { return null; }
    };
    let animationFrames = 0;
    const timers = [];
    const context = {
        URL,
        window: {
            setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
            clearTimeout() {},
            requestAnimationFrame(callback) { animationFrames += 1; callback(); }
        },
        ensureLiveNoticeSlot: () => slot,
        escapeHtml: (value) => String(value),
        formatDateTime: String,
        liveNoticeSlot: slot,
        liveNoticeTransitionTimer: null,
        liveNoticeAutoHideTimer: null,
        activeLiveSignature: "",
        dismissedLiveSignature: "",
        LIVE_NOTICE_EXIT_DURATION: 420,
        LIVE_NOTICE_MAX_VISIBLE: 10000
    };
    vm.createContext(context);
    vm.runInContext(source.slice(start, end), context);

    context.renderLiveStatus({ kind: "none" });
    assert.equal(slot.hidden, true);

    const live = { id: VIDEO_ID, title: "Servicio", url: `https://www.youtube.com/watch?v=${VIDEO_ID}` };
    context.renderLiveStatus({ kind: "live", activeLive: live });
    assert.equal(slot.hidden, false);
    assert.match(slot.innerHTML, /ESTAMOS EN VIVO AHORA MISMO/);
    assert.equal(timers.at(-1).delay + 420, 10000, "el aviso sale como máximo a los 10 segundos incluida la transición");
    const firstAnnouncementFrameCount = animationFrames;

    context.renderLiveStatus({ kind: "live", activeLive: live });
    assert.equal(animationFrames, firstAnnouncementFrameCount, "el mismo ID no genera un segundo aviso simultáneo");

    // P: se oculta el aviso de X por tiempo y Y aún puede volver a anunciarse.
    timers.find((timer) => timer.delay === 10000 - 420).callback();
    timers.filter((timer) => timer.delay === 420).at(-1).callback();
    assert.equal(slot.hidden, true);
    context.renderLiveStatus({ kind: "none" });
    assert.equal(slot.hidden, true);
    assert.equal(slot.innerHTML, "");

    context.renderLiveStatus({
        kind: "live",
        activeLive: { ...live, id: "rpedjLDqPqU", url: "https://www.youtube.com/watch?v=rpedjLDqPqU" }
    });
    assert.equal(slot.hidden, false);
    assert.match(slot.innerHTML, /watch\?v=rpedjLDqPqU/);
});

test("error de consulta conserva el último live, marca verificación error y sincroniza ambos JSON", () => {
    const live = {
        ...freshStatus({ isLiveNow: true, activeLiveId: VIDEO_ID }),
        activeLive: { id: VIDEO_ID, status: "live" }
    };
    const sermons = { ...live, items: [{ id: "archived123" }] };
    const failed = buildVerificationFailureSnapshots(live, sermons, new Date(NOW + 1000).toISOString(), new Error("YouTube 429"));
    assert.equal(failed.liveStatus.status.isLiveNow, true);
    assert.equal(failed.liveStatus.status.activeLiveId, VIDEO_ID);
    assert.equal(failed.liveStatus.activeLive.id, VIDEO_ID);
    assert.equal(failed.liveStatus.status.checkedAt, live.status.checkedAt, "checkedAt permanece como última comprobación correcta");
    assert.equal(failed.liveStatus.status.lastSuccessfulCheck, live.status.checkedAt);
    assert.equal(failed.liveStatus.status.verificationStatus, "error");
    assert.deepEqual(failed.sermons.status, failed.liveStatus.status);
    assert.deepEqual(failed.sermons.items, sermons.items);

    const malformedLiveStatus = { ...live, status: { ...live.status, lastAttemptAt: atOrNow() }, activeLive: null };
    const recoveredFromSermons = buildVerificationFailureSnapshots(malformedLiveStatus, sermons, new Date(NOW + 2000).toISOString(), new Error("respuesta JSON incompleta"));
    assert.equal(recoveredFromSermons.liveStatus.activeLive.id, VIDEO_ID);
    assert.equal(recoveredFromSermons.liveStatus.status.isLiveNow, true);

    const endedNewer = {
        ...freshStatus({ lastEndedLiveId: VIDEO_ID, lastAttemptAt: atOrNow() }),
        updatedAt: atOrNow()
    };
    const noResurrection = buildVerificationFailureSnapshots(endedNewer, live, new Date(NOW + 3000).toISOString(), new Error("timeout"));
    assert.equal(noResurrection.liveStatus.status.isLiveNow, false);
    assert.equal(noResurrection.liveStatus.activeLive, null);
});

test("un error temporal con estado inactivo previo no afirma una comprobación exitosa", () => {
    const inactive = freshStatus();
    const failed = buildVerificationFailureSnapshots(inactive, { ...inactive, items: [] }, new Date(NOW + 1000).toISOString(), new Error("timeout"));
    assert.equal(failed.liveStatus.status.isLiveNow, false);
    assert.equal(failed.liveStatus.status.verificationStatus, "error");
    assert.equal(failed.liveStatus.status.checkedAt, inactive.status.checkedAt);
    assert.equal(failed.liveStatus.status.lastAttemptAt, new Date(NOW + 1000).toISOString());
});

test("máquina completa: X sobrevive errores repetidos, termina, y Y la reemplaza sin mezclar datos", () => {
    const at = (minutes) => new Date(NOW + minutes * 60_000).toISOString();
    const liveX = { id: VIDEO_ID, title: "LIVE X", isLiveNow: true, status: "live", channelId: "UCX0kEGTVJtlkrIxXk9tSF6A" };
    const liveY = { id: "rpedjLDqPqU", title: "LIVE Y", isLiveNow: true, status: "live", channelId: "UCX0kEGTVJtlkrIxXk9tSF6A" };
    let state = freshStatus({ verificationStatus: "ok" });

    // A → B: SIN LIVE → LIVE X
    assert.equal(state.status.isLiveNow, false);
    state = buildLiveStatusSnapshot(state, { activeLive: liveX }, at(1));
    assert.equal(state.status.isLiveNow, true);
    assert.equal(state.status.activeLiveId, VIDEO_ID);
    assert.equal(state.activeLive.id, VIDEO_ID);
    assert.equal(state.activeLive.isLiveNow, true);

    // C → D → E: X continúa durante uno o muchos fallos de YouTube.
    state = buildLiveStatusSnapshot(state, { activeLive: liveX }, at(2));
    state = buildLiveStatusSnapshot(state, { error: new Error("HTTP 429") }, at(3));
    assert.equal(state.status.isLiveNow, true);
    assert.equal(state.status.activeLiveId, VIDEO_ID);
    assert.equal(state.activeLive.id, VIDEO_ID);
    assert.equal(state.status.verificationStatus, "error");
    const lastSuccessBeforeRepeatedFailure = state.status.lastSuccessfulCheck;
    state = buildLiveStatusSnapshot(state, { error: new Error("timeout") }, at(4));
    assert.equal(state.status.isLiveNow, true);
    assert.equal(state.activeLive.id, VIDEO_ID);
    assert.equal(state.status.lastSuccessfulCheck, lastSuccessBeforeRepeatedFailure);
    assert.equal(state.status.lastAttemptAt, at(4));

    // F: la verificación se recupera y vuelve a confirmar X.
    state = buildLiveStatusSnapshot(state, { activeLive: liveX }, at(5));
    assert.equal(state.status.isLiveNow, true);
    assert.equal(state.status.activeLiveId, VIDEO_ID);
    assert.equal(state.status.verificationStatus, "ok");

    // G → H: YouTube confirma el cierre de X; el mismo sondeo sigue buscando Y.
    state = buildLiveStatusSnapshot(state, { endedLiveId: VIDEO_ID }, at(6));
    assert.equal(state.status.isLiveNow, false);
    assert.equal(state.status.activeLiveId, null);
    assert.equal(state.activeLive, null);
    assert.equal(state.status.lastEndedLiveId, VIDEO_ID);

    // H → I → J: ningún LIVE y luego Y activo en dos verificaciones consecutivas.
    state = buildLiveStatusSnapshot(state, { verificationStatus: "ok" }, at(7));
    assert.equal(state.status.isLiveNow, false);
    assert.equal(state.activeLive, null);
    assert.equal(state.status.lastEndedLiveId, VIDEO_ID, "el cierre de X sigue identificable después de una comprobación vacía");
    state = buildLiveStatusSnapshot(state, { activeLive: liveY }, at(8));
    assert.equal(state.status.isLiveNow, true);
    assert.equal(state.status.activeLiveId, liveY.id);
    assert.equal(state.activeLive.id, liveY.id);
    assert.equal(state.activeLive.title, "LIVE Y");
    assert.equal(state.activeLive.isLiveNow, true);
    state = buildLiveStatusSnapshot(state, { activeLive: liveY }, at(9));
    assert.equal(state.activeLive.id, liveY.id);
    assert.equal(state.activeLive.title, "LIVE Y");
    assert.notEqual(state.activeLive.id, VIDEO_ID);
    assert.equal(state.status.verificationStatus, "ok");
});

test("cierre confirmado conserva la causa de fin aunque falle la búsqueda del siguiente LIVE", () => {
    const liveX = {
        ...freshStatus({ isLiveNow: true, activeLiveId: VIDEO_ID }),
        activeLive: { id: VIDEO_ID, isLiveNow: true, status: "live" }
    };
    const ended = buildLiveStatusSnapshot(liveX, {
        endedLiveId: VIDEO_ID,
        error: new Error("/live y /streams temporalmente indisponibles")
    }, new Date(NOW + 1000).toISOString());
    assert.equal(ended.status.isLiveNow, false);
    assert.equal(ended.status.activeLiveId, null);
    assert.equal(ended.activeLive, null);
    assert.equal(ended.status.lastEndedLiveId, VIDEO_ID);
    assert.equal(ended.status.verificationStatus, "error");
    assert.equal(classifyPublishedStatus(ended, NOW + 1000).kind, "stale", "estado de Y queda sin verificar; X no reaparece");
});

test("un false/error publicado no termina un LIVE en memoria sin lastEndedLiveId del mismo ID", () => {
    const liveX = {
        ...freshStatus({ isLiveNow: true, activeLiveId: VIDEO_ID }),
        activeLive: { id: VIDEO_ID, isLiveNow: true, status: "live" }
    };
    const failedInactive = {
        ...freshStatus({ isLiveNow: false, activeLiveId: null, verificationStatus: "error" }),
        updatedAt: new Date(NOW + 1000).toISOString(),
        status: { ...freshStatus().status, isLiveNow: false, activeLiveId: null, verificationStatus: "error" },
        activeLive: null
    };
    const retained = preservePreviousLiveOnUnconfirmedUpdate(liveX, failedInactive);
    assert.equal(retained.status.isLiveNow, true);
    assert.equal(retained.status.activeLiveId, VIDEO_ID);
    assert.equal(retained.activeLive.id, VIDEO_ID);

    failedInactive.status.verificationStatus = "unknown";
    const unknownRetained = preservePreviousLiveOnUnconfirmedUpdate(liveX, failedInactive);
    assert.equal(unknownRetained.status.isLiveNow, true);
    assert.equal(unknownRetained.activeLive.id, VIDEO_ID);

    failedInactive.status.verificationStatus = "error";
    failedInactive.status.lastEndedLiveId = VIDEO_ID;
    const ended = preservePreviousLiveOnUnconfirmedUpdate(liveX, failedInactive);
    assert.equal(ended.status.isLiveNow, false);
    assert.equal(ended.activeLive, null);
});

test("un candidato malformado no reemplaza un LIVE conocido y la salida nunca contradice sus IDs", () => {
    const liveX = {
        ...freshStatus({ isLiveNow: true, activeLiveId: VIDEO_ID }),
        activeLive: { id: VIDEO_ID, isLiveNow: true, status: "live" }
    };
    const invalidY = { id: "wrong", title: "otro video", isLiveNow: true, status: "live" };
    const next = buildLiveStatusSnapshot(liveX, { activeLive: invalidY }, new Date(NOW + 1000).toISOString());
    assert.equal(next.status.isLiveNow, true);
    assert.equal(next.status.activeLiveId, VIDEO_ID);
    assert.equal(next.activeLive.id, VIDEO_ID);
    assert.equal(next.activeLive.isLiveNow, true);

    const wrongChannel = {
        id: "rpedjLDqPqU",
        title: "LIVE de otro canal",
        channelId: "UC_NOT_THE_OFFICIAL_CHANNEL",
        isLiveNow: true,
        status: "live"
    };
    const wrongChannelResult = buildLiveStatusSnapshot(liveX, { activeLive: wrongChannel }, new Date(NOW + 1500).toISOString());
    assert.equal(wrongChannelResult.status.isLiveNow, true);
    assert.equal(wrongChannelResult.activeLive.id, VIDEO_ID);
    assert.equal(wrongChannelResult.status.verificationStatus, "error");

    const inconsistent = { ...liveX, activeLive: { ...liveX.activeLive, id: "rpedjLDqPqU" } };
    const failed = buildLiveStatusSnapshot(inconsistent, { error: new Error("metadata incompleta") }, atOrNow());
    assert.equal(failed.status.isLiveNow, false);
    assert.equal(failed.status.activeLiveId, null);
    assert.equal(failed.activeLive, null);
    assert.equal(failed.status.verificationStatus, "error");
});

test("el JSON de live-status prevalece sobre predicaciones.json y no resucita un LIVE ya terminado", () => {
    const oldLive = {
        ...freshStatus({ isLiveNow: true, activeLiveId: VIDEO_ID }),
        activeLive: { id: VIDEO_ID, isLiveNow: true, status: "live" }
    };
    const currentEnded = freshStatus({ verificationStatus: "ok" });
    assert.equal(getAuthoritativeActiveLive(currentEnded, oldLive), null);

    const legacyWithoutBoolean = { status: {}, activeLive: null };
    assert.equal(getAuthoritativeActiveLive(legacyWithoutBoolean, oldLive).id, VIDEO_ID);
});

function atOrNow() {
    return new Date(NOW + 1000).toISOString();
}

test("fallo de fetch del frontend conserva el LIVE válido en memoria", async () => {
    const source = fs.readFileSync(require.resolve("../script.js"), "utf8");
    const start = source.indexOf("async function refreshLiveStatus()");
    const end = source.indexOf("\nfunction renderSermonsFallback()", start);
    const slot = { hidden: false, innerHTML: "X", classList: { add() {}, remove() {} }, querySelector() { return null; } };
    const oldFetch = global.fetch;
    const renderedViews = [];
    global.fetch = async () => { throw new Error("offline"); };
    const context = {
        Date,
        AbortSignal,
        fetch: global.fetch,
        LIVE_STATUS_DATA_PATH: "data/live-status.json",
        latestLiveStatusData: {
            ...freshStatus({ isLiveNow: true, activeLiveId: VIDEO_ID }),
            activeLive: { id: VIDEO_ID, title: "LIVE X", isLiveNow: true, status: "live" }
        },
        liveStatusRefreshInFlight: false,
        liveStatusPollTimer: null,
        liveNoticeSlot: slot,
        lastConfirmedLiveId: VIDEO_ID,
        archivedFeaturedSermon: null,
        window: { LiveStatusState: require("../live-status-state.js") },
        getLiveStatusView(data) { return context.window.LiveStatusState.classifyPublishedStatus(data, NOW); },
        renderLiveStatus(view) { renderedViews.push(view); },
        updateFeaturedSermon(item) { this.featured = item; },
        loadSermons() {}
    };
    vm.createContext(context);
    vm.runInContext(source.slice(start, end), context);
    try {
        await context.refreshLiveStatus();
        assert.equal(renderedViews.at(-1).kind, "live");
        assert.equal(renderedViews.at(-1).activeLive.id, VIDEO_ID);
    } finally {
        global.fetch = oldFetch;
    }
});

test("el detector, tras confirmar el final de X, consulta otro candidato y publica el LIVE Y del canal", async () => {
    const { getActiveLive, mergeArchivedStreams } = await import("../scripts/update-sermons.mjs");
    const secondLiveId = "Z84jHmOu84c";
    const requestedVideos = [];
    const originalFetch = global.fetch;
    let failSecondLiveRequest = false;
    const playerResponse = (id, live) => ({
        videoDetails: {
            videoId: id,
            channelId: "UCX0kEGTVJtlkrIxXk9tSF6A",
            title: `LIVE ${id}`,
            isLiveContent: true,
            wasLive: !live,
            thumbnail: { thumbnails: [{ url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, width: 480 }] }
        },
        microformat: {
            playerMicroformatRenderer: {
                isLiveBroadcast: true,
                liveBroadcastContent: live ? "LIVE" : "COMPLETED",
                liveBroadcastDetails: live
                    ? { isLiveNow: true, actualStartTime: "2026-09-27T01:00:00Z" }
                    : { actualStartTime: "2026-09-27T00:00:00Z", actualEndTime: "2026-09-27T00:45:00Z" }
            }
        }
    });
    const page = (response) => `var ytInitialData = {"contents":[]}; var ytInitialPlayerResponse = ${JSON.stringify(response)};`;
    global.fetch = async (input) => {
        const url = new URL(String(input));
        const videoId = url.searchParams.get("v");
        if (videoId) {
            requestedVideos.push(videoId);
            if (videoId === secondLiveId && failSecondLiveRequest) {
                return new Response("rate limited", { status: 429 });
            }
            const html = page(playerResponse(videoId, videoId === secondLiveId));
            return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
        }
        return new Response(page(playerResponse(secondLiveId, true)), { status: 200, headers: { "content-type": "text/html" } });
    };
    try {
        const detected = await getActiveLive([], VIDEO_ID, "UCX0kEGTVJtlkrIxXk9tSF6A");
        assert.deepEqual(requestedVideos.slice(0, 2), [VIDEO_ID, secondLiveId], "terminar X no interrumpe la búsqueda de candidatos posteriores");
        assert.equal(detected.activeLive.id, secondLiveId);
        assert.equal(detected.activeLive.isLiveNow, true);
        assert.equal(detected.activeLive.channelId, "UCX0kEGTVJtlkrIxXk9tSF6A");
        assert.equal(detected.activeLive.title, `LIVE ${secondLiveId}`);

        const oldArchive = [
            { id: "oldRecord01", title: "Archivo antiguo", publishedAt: "2020-01-01T00:00:00Z" },
            { id: VIDEO_ID, title: "X archivada previamente", publishedAt: "2026-09-27T00:00:00Z" }
        ];
        const merged = mergeArchivedStreams(oldArchive, [{ id: VIDEO_ID, title: "X archivada verificada", publishedAt: "2026-09-27T00:01:00Z" }], secondLiveId);
        assert.equal(merged.length, 2, "el refresco no elimina registros históricos");
        assert.equal(merged.find((item) => item.id === "oldRecord01").title, "Archivo antiguo");
        assert.equal(merged.find((item) => item.id === VIDEO_ID).title, "X archivada verificada");
        assert.equal(merged.some((item) => item.id === secondLiveId), false, "el LIVE activo nunca queda archivado");

        // Si se confirma el fin de X pero Y devuelve 429, X no queda activo otra vez.
        requestedVideos.length = 0;
        failSecondLiveRequest = true;
        const incompleteSearch = await getActiveLive([], VIDEO_ID, "UCX0kEGTVJtlkrIxXk9tSF6A");
        assert.deepEqual(requestedVideos.slice(0, 2), [VIDEO_ID, secondLiveId]);
        assert.equal(incompleteSearch.activeLive, null);
        assert.equal(incompleteSearch.endedLiveId, VIDEO_ID);
        assert.equal(incompleteSearch.verificationStatus, "error");
        const afterEndAnd429 = buildLiveStatusSnapshot({
            ...freshStatus({ isLiveNow: true, activeLiveId: VIDEO_ID }),
            activeLive: { id: VIDEO_ID, isLiveNow: true, status: "live" }
        }, {
            endedLiveId: incompleteSearch.endedLiveId,
            error: incompleteSearch.verificationError,
            verificationStatus: incompleteSearch.verificationStatus
        }, new Date(NOW + 2000).toISOString());
        assert.equal(afterEndAnd429.status.isLiveNow, false);
        assert.equal(afterEndAnd429.activeLive, null);
        assert.equal(afterEndAnd429.status.lastEndedLiveId, VIDEO_ID);
    } finally {
        global.fetch = originalFetch;
    }
});
