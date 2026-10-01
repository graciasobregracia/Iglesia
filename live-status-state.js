(function attachLiveStatusState(root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) {
        module.exports = api;
    } else {
        root.LiveStatusState = api;
    }
})(globalThis, function createLiveStatusState() {
    const ACTIVE_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
    const DEFAULT_MAX_AGE_MS = 15 * 60 * 1000;
    const MAX_FUTURE_CLOCK_SKEW_MS = 60 * 1000;
    const OFFICIAL_CHANNEL_ID = "UCX0kEGTVJtlkrIxXk9tSF6A";

    function isValidVideoId(value) {
        return typeof value === "string" && ACTIVE_ID_PATTERN.test(value);
    }

    function getConfirmedActiveLive(payload) {
        const status = payload?.status;
        const activeLive = payload?.activeLive;
        if (
            status?.isLiveNow !== true ||
            !isValidVideoId(status.activeLiveId) ||
            !activeLive ||
            activeLive.id !== status.activeLiveId ||
            activeLive.isUpcoming === true ||
            activeLive.status === "archived"
        ) {
            return null;
        }
        return { ...activeLive, id: status.activeLiveId, isLiveNow: true, isUpcoming: false, status: "live" };
    }

    function getAuthoritativeActiveLive(primaryPayload, ...fallbackPayloads) {
        if (primaryPayload?.status?.state === "ERROR" || ["error", "unknown"].includes(primaryPayload?.status?.verificationStatus)) {
            return null;
        }
        if (typeof primaryPayload?.status?.isLiveNow === "boolean") {
            return getConfirmedActiveLive(primaryPayload);
        }
        for (const payload of fallbackPayloads) {
            const activeLive = getConfirmedActiveLive(payload);
            if (activeLive) return activeLive;
        }
        return null;
    }

    function isVerifiedLiveCandidate(activeLive) {
        return Boolean(
            activeLive &&
            isValidVideoId(activeLive.id) &&
            activeLive.channelId === OFFICIAL_CHANNEL_ID &&
            activeLive.isUpcoming !== true &&
            activeLive.status !== "archived"
        );
    }

    function buildLiveStatusSnapshot(previousPayload, observation, attemptedAt) {
        const previous = previousPayload && typeof previousPayload === "object" ? previousPayload : {};
        const previousStatus = previous.status && typeof previous.status === "object" ? previous.status : {};
        const previousLive = getConfirmedActiveLive(previous);
        const foundLive = isVerifiedLiveCandidate(observation?.activeLive) ? {
            ...observation.activeLive,
            isLiveNow: true,
            isUpcoming: false,
            status: "live"
        } : null;
        const explicitlyEndedId = observation?.endedLiveId && observation.endedLiveId === previousLive?.id
            ? observation.endedLiveId
            : null;
        const invalidLiveCandidate = Boolean(observation?.activeLive && !foundLive);
        const scanFailed = Boolean(observation?.error || observation?.verificationStatus === "error" || invalidLiveCandidate);
        const scanUnknown = observation?.verificationStatus === "unknown";

        let activeLive = null;
        let verificationStatus = "ok";
        let lastEndedLiveId = previousStatus.lastEndedLiveId || null;
        let lastEndedAt = previousStatus.lastEndedAt || null;
        let successfulCheckAt = attemptedAt;
        let upcomingLive = observation?.upcomingLive || null;

        if (foundLive) {
            activeLive = foundLive;
            upcomingLive = null;
            lastEndedLiveId = null;
            lastEndedAt = null;
        } else if (explicitlyEndedId) {
            lastEndedLiveId = explicitlyEndedId;
            verificationStatus = scanFailed ? "error" : scanUnknown ? "unknown" : "ok";
            lastEndedAt = attemptedAt;
            if (scanFailed || scanUnknown) {
                successfulCheckAt = previousStatus.lastSuccessfulCheck || previousStatus.checkedAt || null;
            }
            upcomingLive = observation?.upcomingLive || null;
        } else if (scanFailed || scanUnknown) {
            verificationStatus = scanFailed ? "error" : "unknown";
            successfulCheckAt = previousStatus.lastSuccessfulCheck || previousStatus.checkedAt || null;
            upcomingLive = observation?.upcomingLive || previous.upcomingLive || null;
        }

        const hasUnconfirmedState = !foundLive && (scanFailed || scanUnknown);
        const state = hasUnconfirmedState ? "ERROR" : activeLive ? "LIVE" : "NO_LIVE";

        const status = {
            ...previousStatus,
            state,
            isLiveNow: hasUnconfirmedState ? null : Boolean(activeLive),
            activeLiveId: activeLive?.id ?? null,
            upcomingLiveId: upcomingLive?.id ?? null,
            checkedAt: successfulCheckAt,
            lastSuccessfulCheck: successfulCheckAt,
            lastAttemptAt: attemptedAt,
            verificationStatus,
            lastEndedLiveId,
            lastEndedAt,
            lastError: verificationStatus === "error"
                ? String(observation?.error?.message || observation?.error || previousStatus.lastError || "Error de verificación").slice(0, 300)
                : null
        };

        const channel = previous.channel || { channelId: OFFICIAL_CHANNEL_ID };
        const payload = {
            ...previous,
            channel,
            updatedAt: attemptedAt,
            status,
            activeLive,
            upcomingLive
        };

        return payload;
    }

    function isCoherentPublishedPayload(payload) {
        const status = payload?.status;
        if (status?.state === "ERROR" || ["error", "unknown"].includes(status?.verificationStatus)) {
            return true;
        }
        if (status?.isLiveNow === true) return Boolean(getConfirmedActiveLive(payload));
        return Boolean(
            status?.isLiveNow === false &&
            status.activeLiveId == null &&
            payload.activeLive == null
        );
    }

    function getLatestCoherentPayload(...payloads) {
        const coherent = payloads.filter(isCoherentPublishedPayload);
        if (!coherent.length) return payloads.find(Boolean) || {};
        return coherent.reduce((latest, payload) => {
            const latestAt = Date.parse(latest?.status?.lastAttemptAt || latest?.updatedAt || latest?.status?.checkedAt || "");
            const payloadAt = Date.parse(payload?.status?.lastAttemptAt || payload?.updatedAt || payload?.status?.checkedAt || "");
            if (!Number.isFinite(latestAt)) return Number.isFinite(payloadAt) ? payload : latest;
            return Number.isFinite(payloadAt) && payloadAt > latestAt ? payload : latest;
        });
    }

    function classifyYouTubeBroadcast(signals, now = Date.now()) {
        const {
            requestedVideoId = null,
            videoId = null,
            expectedChannelId = null,
            channelId = null,
            isLiveContent = false,
            wasLive = false,
            isLiveBroadcast = null,
            liveBroadcastContent = null,
            liveBroadcastDetails = null,
            actualEndTime = null,
            endTimestamp = null,
            actualStartTime = null,
            startTimestamp = null,
            scheduledStartTime = null,
            isUpcoming = false
        } = signals ?? {};
        const content = String(liveBroadcastContent ?? "").trim().toUpperCase();
        const saysLive = ["LIVE", "EN DIRECTO", "EN VIVO"].includes(content);
        const endedAt = actualEndTime || endTimestamp || liveBroadcastDetails?.actualEndTime || liveBroadcastDetails?.endTimestamp || null;
        const saysEnded = ["COMPLETED", "ARCHIVED", "ENDED", "FINISHED"].includes(content);
        const hasEnded = Boolean(endedAt || wasLive || saysEnded);
        const startedAt = actualStartTime || startTimestamp || liveBroadcastDetails?.actualStartTime || liveBroadcastDetails?.startTimestamp || null;
        const scheduledAt = scheduledStartTime || liveBroadcastDetails?.scheduledStartTime || null;
        const idMatches = !requestedVideoId || videoId === requestedVideoId;
        const channelMatches = !expectedChannelId || channelId === expectedChannelId;
        const upcoming = Boolean(
            !hasEnded &&
            (isUpcoming || liveBroadcastDetails?.isUpcoming === true || ["UPCOMING", "PRÓXIMO", "PROGRAMADO"].includes(content) ||
                (scheduledAt && Date.parse(scheduledAt) > now && !startedAt))
        );
        const hasExplicitLiveSignal = liveBroadcastDetails?.isLiveNow === true || saysLive;
        const hasBroadcastIdentity = isLiveContent === true || isLiveBroadcast === true || Boolean(liveBroadcastDetails);
        const liveNow = Boolean(idMatches && channelMatches && hasExplicitLiveSignal && hasBroadcastIdentity && !hasEnded && !upcoming);
        const liveLike = Boolean(isLiveContent || isLiveBroadcast === true || wasLive || liveBroadcastDetails || hasExplicitLiveSignal);

        return {
            idMatches,
            channelMatches,
            isLiveContent: isLiveContent === true,
            wasLive: wasLive === true,
            isLiveBroadcast,
            liveBroadcastContent: content || null,
            liveBroadcastDetails,
            actualStartTime: startedAt,
            actualEndTime: endedAt,
            hasEnded,
            isLiveNow: liveNow,
            isUpcoming: upcoming,
            isLiveLike: liveLike,
            isArchived: Boolean((hasEnded || (liveLike && wasLive)) && !liveNow && !upcoming)
        };
    }

    function classifyPublishedStatus(payload, now = Date.now(), maxAgeMs = DEFAULT_MAX_AGE_MS) {
        const status = payload?.status;
        if (!status || typeof status !== "object") return { kind: "error", reason: "missing-status" };

        const verificationStatus = status.verificationStatus || "unknown";
        const successfulTimestamp = status.lastSuccessfulCheck || status.checkedAt ||
            (["ok", "verified"].includes(verificationStatus) ? payload.updatedAt : null);
        const checkedAt = Date.parse(successfulTimestamp || "");
        const ageMs = now - checkedAt;
        const fresh = Number.isFinite(checkedAt) && ageMs >= -MAX_FUTURE_CLOCK_SKEW_MS && ageMs <= maxAgeMs;

        if (status.state === "ERROR" || ["error", "unknown"].includes(verificationStatus)) {
            return { kind: "error", reason: verificationStatus, ageMs, freshness: fresh ? "recent" : "stale", lastError: status.lastError || null };
        }

        if (status.isLiveNow === true) {
            const activeLive = payload.activeLive;
            const valid =
                activeLive &&
                isValidVideoId(activeLive.id) &&
                status.activeLiveId === activeLive.id &&
                activeLive.isUpcoming !== true &&
                activeLive.status !== "archived";
            if (!valid) return { kind: "error", reason: "contradictory-live-state", ageMs, lastError: status.lastError || null };
            const active = { ...activeLive, isLiveNow: true, isUpcoming: false, status: "live" };
            if (!fresh) {
                return {
                    kind: "error",
                    reason: verificationStatus === "error" ? "verification-error" : "expired-live-confirmation",
                    ageMs,
                    freshness: "stale",
                    verificationStatus,
                    lastError: status.lastError || null
                };
            }
            return {
                kind: "live",
                activeLive: active,
                ageMs,
                freshness: ["ok", "verified"].includes(verificationStatus) ? "fresh" : "degraded",
                verificationStatus,
                lastError: status.lastError || null
            };
        }

        if (!fresh) {
            if (
                status.isLiveNow === false &&
                status.activeLiveId == null &&
                payload.activeLive == null &&
                ["ok", "verified"].includes(verificationStatus)
            ) {
                return { kind: "none", ageMs, freshness: "stale" };
            }

            return { kind: "error", reason: "expired", ageMs, freshness: "stale", lastError: status.lastError || null };
        }
        if (!(["ok", "verified"].includes(verificationStatus))) {
            return { kind: "error", reason: "verification-error", ageMs, lastError: status.lastError || null };
        }

        if (status.isLiveNow !== false || status.activeLiveId != null || payload.activeLive != null) {
            return { kind: "error", reason: "contradictory-inactive-state", ageMs };
        }

        const upcomingLive = payload.upcomingLive;
        if (
            status.upcomingLiveId &&
            upcomingLive?.id === status.upcomingLiveId &&
            isValidVideoId(upcomingLive.id)
        ) {
            return { kind: "upcoming", upcomingLive, ageMs };
        }
        return { kind: "none", ageMs };
    }

    function selectFeaturedSermon(items, preferredId = null) {
        const archives = (Array.isArray(items) ? items : []).filter((item) =>
            item &&
            item.status !== "live" &&
            item.isLiveNow !== true &&
            item.isUpcoming !== true &&
            (item.status === "archived" || item.type === "live" || item.isLiveBroadcast === true)
        );
        const preferred = preferredId ? archives.find((item) => item.id === preferredId) : null;
        if (preferred) return preferred;
        return archives.sort((left, right) => {
            const timeOf = (item) => Date.parse(
                item.actualStartTime || item.startedAt || item.publishedAt || item.actualEndTime || item.endedAt || ""
            );
            const leftTime = timeOf(left);
            const rightTime = timeOf(right);
            return (Number.isFinite(rightTime) ? rightTime : Number.NEGATIVE_INFINITY) -
                (Number.isFinite(leftTime) ? leftTime : Number.NEGATIVE_INFINITY);
        })[0] || null;
    }

    function buildVerificationFailureSnapshots(livePayload, sermonsPayload, attemptedAt, error) {
        const previous = getLatestCoherentPayload(livePayload, sermonsPayload);
        const liveStatus = buildLiveStatusSnapshot(previous, { error, verificationStatus: "error" }, attemptedAt);
        const activeLive = liveStatus.activeLive;
        const upcomingLive = liveStatus.upcomingLive;
        return {
            liveStatus,
            sermons: {
                ...(sermonsPayload || {}),
                updatedAt: attemptedAt,
                status: { ...liveStatus.status },
                activeLive,
                upcomingLive
            }
        };
    }

    return {
        DEFAULT_MAX_AGE_MS,
        OFFICIAL_CHANNEL_ID,
        isValidVideoId,
        getConfirmedActiveLive,
        getAuthoritativeActiveLive,
        buildLiveStatusSnapshot,
        isCoherentPublishedPayload,
        getLatestCoherentPayload,
        classifyYouTubeBroadcast,
        classifyPublishedStatus,
        selectFeaturedSermon,
        buildVerificationFailureSnapshots
    };
});
