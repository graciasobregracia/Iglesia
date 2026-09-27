const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const {
    DEFAULT_MAX_AGE_MS,
    classifyYouTubeBroadcast,
    classifyPublishedStatus,
    buildVerificationFailureSnapshots
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
});

test("estado publicado: live fresco, live obsoleto, error, finalizado y upcoming", () => {
    const activeLive = { id: VIDEO_ID, isUpcoming: false, status: "live" };
    const live = {
        ...freshStatus({ isLiveNow: true, activeLiveId: VIDEO_ID }),
        activeLive
    };
    assert.equal(classifyPublishedStatus(live, NOW).kind, "live");
    assert.equal(classifyPublishedStatus(live, NOW + DEFAULT_MAX_AGE_MS + 1).kind, "stale");

    const failed = { ...live, status: { ...live.status, verificationStatus: "error", lastError: "YouTube 429" } };
    assert.equal(classifyPublishedStatus(failed, NOW).kind, "stale");

    const upcoming = {
        ...freshStatus({ upcomingLiveId: VIDEO_ID }),
        upcomingLive: { id: VIDEO_ID, scheduledStartTime: "2026-09-27T02:30:00.000Z" }
    };
    assert.equal(classifyPublishedStatus(upcoming, NOW).kind, "upcoming");
    assert.equal(classifyPublishedStatus(freshStatus(), NOW).kind, "none");
});

test("la decisión real del frontend no anuncia un estado viejo o fallido", () => {
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
    assert.equal(context.getLiveStatusView(active, NOW + DEFAULT_MAX_AGE_MS + 1).kind, "stale");
    active.status.verificationStatus = "error";
    assert.equal(context.getLiveStatusView(active, NOW).kind, "stale");
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
    const timerDelays = [];
    const context = {
        URL,
        window: {
            setTimeout(_callback, delay) { timerDelays.push(delay); return timerDelays.length; },
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
    assert.equal(timerDelays.at(-1) + 420, 10000, "el aviso sale como máximo a los 10 segundos incluida la transición");
    const firstAnnouncementFrameCount = animationFrames;

    context.renderLiveStatus({ kind: "live", activeLive: live });
    assert.equal(animationFrames, firstAnnouncementFrameCount, "el mismo ID no genera un segundo aviso simultáneo");

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
    assert.equal(failed.liveStatus.status.verificationStatus, "error");
    assert.deepEqual(failed.sermons.status, failed.liveStatus.status);
    assert.deepEqual(failed.sermons.items, sermons.items);
});
