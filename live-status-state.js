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

    function classifyYouTubeBroadcast(signals, now = Date.now()) {
        const {
            requestedVideoId = null,
            videoId = null,
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
        const hasEnded = Boolean(endedAt);
        const startedAt = actualStartTime || startTimestamp || liveBroadcastDetails?.actualStartTime || liveBroadcastDetails?.startTimestamp || null;
        const scheduledAt = scheduledStartTime || liveBroadcastDetails?.scheduledStartTime || null;
        const idMatches = !requestedVideoId || videoId === requestedVideoId;
        const upcoming = Boolean(
            !hasEnded &&
                (isUpcoming || liveBroadcastDetails?.isUpcoming === true || ["UPCOMING", "PRÓXIMO", "PROGRAMADO"].includes(content) ||
                    (scheduledAt && Date.parse(scheduledAt) > now && !startedAt))
        );
        const hasExplicitLiveSignal = liveBroadcastDetails?.isLiveNow === true || saysLive;
        const hasBroadcastIdentity = isLiveContent === true || isLiveBroadcast === true || Boolean(liveBroadcastDetails);
        const liveNow = Boolean(idMatches && hasExplicitLiveSignal && hasBroadcastIdentity && !hasEnded && !upcoming);
        const liveLike = Boolean(isLiveContent || isLiveBroadcast === true || wasLive || liveBroadcastDetails || hasExplicitLiveSignal);

        return {
            idMatches,
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
        if (!status || typeof status !== "object") return { kind: "stale", reason: "missing-status" };

        const checkedAt = Date.parse(status.checkedAt || payload.updatedAt || "");
        const ageMs = now - checkedAt;
        if (!Number.isFinite(checkedAt) || ageMs < -MAX_FUTURE_CLOCK_SKEW_MS || ageMs > maxAgeMs) {
            return { kind: "stale", reason: "expired", ageMs };
        }
        if (status.verificationStatus && status.verificationStatus !== "verified") {
            return { kind: "stale", reason: "verification-error", ageMs, lastError: status.lastError || null };
        }

        if (status.isLiveNow === true) {
            const activeLive = payload.activeLive;
            const valid =
                activeLive &&
                ACTIVE_ID_PATTERN.test(activeLive.id || "") &&
                status.activeLiveId === activeLive.id &&
                activeLive.isUpcoming !== true &&
                activeLive.status !== "archived";
            return valid
                ? { kind: "live", activeLive, ageMs }
                : { kind: "stale", reason: "contradictory-live-state", ageMs };
        }

        if (status.isLiveNow !== false || status.activeLiveId != null || payload.activeLive != null) {
            return { kind: "stale", reason: "contradictory-inactive-state", ageMs };
        }

        const upcomingLive = payload.upcomingLive;
        if (
            status.upcomingLiveId &&
            upcomingLive?.id === status.upcomingLiveId &&
            ACTIVE_ID_PATTERN.test(upcomingLive.id)
        ) {
            return { kind: "upcoming", upcomingLive, ageMs };
        }
        return { kind: "none", ageMs };
    }

    function buildVerificationFailureSnapshots(livePayload, sermonsPayload, attemptedAt, error) {
        const liveCheckedAt = Date.parse(livePayload?.status?.checkedAt || "");
        const sermonsCheckedAt = Date.parse(sermonsPayload?.status?.checkedAt || "");
        const previous = sermonsCheckedAt > liveCheckedAt ? sermonsPayload : livePayload || sermonsPayload || {};
        const previousStatus = previous.status || {};
        const candidateLive = previous.activeLive || sermonsPayload?.activeLive || null;
        const activeLive =
            previousStatus.isLiveNow === true &&
            candidateLive &&
            ACTIVE_ID_PATTERN.test(candidateLive.id || "") &&
            previousStatus.activeLiveId === candidateLive.id
                ? candidateLive
                : null;
        const status = {
            ...previousStatus,
            isLiveNow: Boolean(activeLive),
            activeLiveId: activeLive?.id ?? null,
            verificationStatus: "error",
            lastAttemptAt: attemptedAt,
            lastError: String(error?.message || error || "Error de verificación").slice(0, 300)
        };
        const synchronizedStatus = { ...status };
        return {
            liveStatus: { ...previous, updatedAt: attemptedAt, status, activeLive, upcomingLive: previous.upcomingLive || null },
            sermons: {
                ...(sermonsPayload || {}),
                updatedAt: attemptedAt,
                status: synchronizedStatus,
                activeLive,
                upcomingLive: previous.upcomingLive || null
            }
        };
    }

    return {
        DEFAULT_MAX_AGE_MS,
        classifyYouTubeBroadcast,
        classifyPublishedStatus,
        buildVerificationFailureSnapshots
    };
});
