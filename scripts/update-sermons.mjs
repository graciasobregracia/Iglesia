import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
    classifyYouTubeBroadcast,
    buildVerificationFailureSnapshots,
    getAuthoritativeActiveLive,
    buildLiveStatusSnapshot
} = require("../live-status-state.js");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const outputDirectory = path.join(projectRoot, "data");
const outputPath = path.join(outputDirectory, "predicaciones.json");
const liveStatusPath = path.join(outputDirectory, "live-status.json");
const channelHomeUrl = "https://www.youtube.com/@icgraciasobregracia";
const channelStreamsUrl = `${channelHomeUrl}/streams`;
const channelLiveUrl = `${channelHomeUrl}/live`;
const officialChannelId = "UCX0kEGTVJtlkrIxXk9tSF6A";
const channelUploadsFeedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${officialChannelId}`;
const maxArchivedStreams = 15;
const maxLiveCandidatesPerSource = 8;
const siteTimeZone = "America/Bogota";
const diagnosticMode = process.argv.includes("--diagnose") || process.env.SERMONS_DIAGNOSTICS === "1";

function logCandidateDecision(record) {
    if (diagnosticMode) console.info(`[candidate] ${JSON.stringify(record)}`);
}

async function fetchPage(url) {
    const response = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: {
            "Accept-Language": "es-CO,es;q=0.9,en;q=0.7",
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
        }
    });

    if (!response.ok) {
        const error = new Error(`No se pudo cargar ${url} (${response.status})`);
        error.status = response.status;
        throw error;
    }

    return {
        html: await response.text(),
        finalUrl: response.url
    };
}

async function fetchText(url) {
    const page = await fetchPage(url);
    return page.html;
}

async function readJsonFile(filePath) {
    try {
        return JSON.parse(await readFile(filePath, "utf8"));
    } catch {
        return null;
    }
}

function matchFirst(source, pattern) {
    const match = source.match(pattern);
    return match?.[1] ?? null;
}

function extractJsonAfterMarker(html, marker) {
    const markerIndex = html.indexOf(marker);
    if (markerIndex === -1) return null;

    const jsonStart = html.indexOf("{", markerIndex + marker.length);
    if (jsonStart === -1) return null;

    let depth = 0;
    let inString = false;
    let escaping = false;

    for (let index = jsonStart; index < html.length; index += 1) {
        const char = html[index];

        if (inString) {
            if (escaping) {
                escaping = false;
            } else if (char === "\\") {
                escaping = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
        } else if (char === "{") {
            depth += 1;
        } else if (char === "}") {
            depth -= 1;
            if (depth === 0) {
                return html.slice(jsonStart, index + 1);
            }
        }
    }

    return null;
}

function parseInitialData(html) {
    const jsonText =
        extractJsonAfterMarker(html, "var ytInitialData =") ||
        extractJsonAfterMarker(html, "window[\"ytInitialData\"] =");

    if (!jsonText) {
        throw new Error("No se encontro ytInitialData en la pestana de transmisiones.");
    }

    return JSON.parse(jsonText);
}

function parseInitialPlayerResponse(html) {
    const markers = ["var ytInitialPlayerResponse =", "ytInitialPlayerResponse =", '"ytInitialPlayerResponse":'];

    for (const marker of markers) {
        let offset = 0;
        while ((offset = html.indexOf(marker, offset)) !== -1) {
            const jsonText = extractJsonAfterMarker(html.slice(offset), marker);
            if (jsonText) {
                try {
                    const parsed = JSON.parse(jsonText);
                    if (parsed?.videoDetails || parsed?.microformat) return parsed;
                } catch {
                    // YouTube puede incluir respuestas parciales o escapadas antes de la respuesta del reproductor.
                }
            }
            offset += marker.length;
        }
    }

    return null;
}

function walk(value, visitor) {
    if (!value || typeof value !== "object") return;

    visitor(value);

    if (Array.isArray(value)) {
        value.forEach((item) => walk(item, visitor));
        return;
    }

    Object.values(value).forEach((item) => walk(item, visitor));
}

function collectTextValues(value) {
    const textValues = [];

    walk(value, (node) => {
        if (typeof node.content === "string") {
            textValues.push(node.content);
        }

        if (typeof node.text === "string") {
            textValues.push(node.text);
        }

        if (Array.isArray(node.runs)) {
            node.runs.forEach((run) => {
                if (typeof run.text === "string") {
                    textValues.push(run.text);
                }
            });
        }
    });

    return textValues;
}

function cleanThumbnailUrl(url, videoId) {
    if (!url) {
        return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    }

    return String(url).replace(/\\u0026/g, "&");
}

function getBestThumbnail(lockup, videoId) {
    const sources = lockup.contentImage?.thumbnailViewModel?.image?.sources ?? [];
    const bestSource = [...sources].sort((left, right) => (right.width ?? 0) - (left.width ?? 0))[0];

    return cleanThumbnailUrl(bestSource?.url, videoId);
}

function getDuration(lockup) {
    const textValues = collectTextValues(lockup.contentImage?.thumbnailViewModel?.overlays ?? []);
    return textValues.find((value) => /^\d{1,2}:\d{2}(?::\d{2})?$/.test(value)) ?? null;
}

function getRelativePublishedText(lockup) {
    const rows = lockup.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows ?? [];
    const rowTexts = rows.flatMap((row) => collectTextValues(row));

    return rowTexts.find((value) => /^hace\s/i.test(value)) ?? null;
}

function getStreamItems(initialData) {
    const items = [];
    const seenIds = new Set();

    walk(initialData, (node) => {
        const lockup = node.lockupViewModel;
        const renderer = node.videoRenderer || node.gridVideoRenderer || node.richItemRenderer?.content?.videoRenderer;
        const id = lockup?.contentType === "LOCKUP_CONTENT_TYPE_VIDEO" ? lockup.contentId : renderer?.videoId;
        const title =
            lockup?.metadata?.lockupMetadataViewModel?.title?.content ||
            renderer?.title?.runs?.map((run) => run.text).join("") ||
            renderer?.title?.simpleText;

        if (!id || !title || seenIds.has(id)) return;

        seenIds.add(id);
        const thumbnailUrl =
            getBestThumbnail(lockup || {}, id) ||
            renderer?.thumbnail?.thumbnails?.slice().sort((left, right) => (right.width ?? 0) - (left.width ?? 0))[0]?.url;
        items.push({
            id,
            title,
            url: `https://www.youtube.com/watch?v=${id}`,
            thumbnail: cleanThumbnailUrl(thumbnailUrl, id),
            duration: getDuration(lockup || {}),
            publishedText: getRelativePublishedText(lockup || {}) || renderer?.publishedTimeText?.simpleText || null,
            source: "youtube-streams-page",
            isUpcoming: Boolean(renderer?.upcomingEventData),
            scheduledStartTime: renderer?.upcomingEventData?.startTime
                ? new Date(Number(renderer.upcomingEventData.startTime) * 1000).toISOString()
                : null,
            originalIndex: items.length
        });
    });

    return items;
}

function decodeXml(value = "") {
    return value
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'");
}

export function parseUploadsFeed(xml) {
    const items = [];
    for (const entry of String(xml || "").matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)) {
        const body = entry[1];
        const id = matchFirst(body, /<yt:videoId\b[^>]*>([\s\S]*?)<\/yt:videoId>/i)?.trim();
        const title = matchFirst(body, /<title\b[^>]*>([\s\S]*?)<\/title>/i);
        const publishedAt = matchFirst(body, /<published\b[^>]*>([^<]+)<\/published>/i);
        const thumbnail = matchFirst(body, /<media:thumbnail\b[^>]*\burl="([^"]+)"/i);
        if (!id || !title || !/^[a-zA-Z0-9_-]{11}$/.test(id)) continue;
        items.push({
            id,
            title: decodeXml(title.trim()),
            url: `https://www.youtube.com/watch?v=${id}`,
            thumbnail: cleanThumbnailUrl(decodeXml(thumbnail || ""), id),
            publishedAt: publishedAt || null,
            publishedText: null,
            source: "youtube-uploads-rss",
            originalIndex: items.length
        });
    }
    return items;
}

function getApiVideoDuration(value) {
    const match = String(value || "").match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
    if (!match) return null;
    const seconds = Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
    return [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60]
        .map((part, index) => index === 0 && seconds < 3600 ? null : String(part).padStart(index ? 2 : 1, "0"))
        .filter((part) => part !== null)
        .join(":");
}

export async function fetchUploadsFromYouTubeDataApi(apiKey, fetchImpl = fetch) {
    if (!apiKey) return [];
    const uploadsPlaylistId = `UU${officialChannelId.slice(2)}`;
    const playlistItems = [];
    let pageToken = "";
    const maxPages = 10;
    const historyCutoff = Date.now() - 60 * 24 * 60 * 60 * 1000;
    for (let page = 0; page < maxPages; page += 1) {
        const params = new URLSearchParams({
            part: "snippet,contentDetails",
            playlistId: uploadsPlaylistId,
            maxResults: "50",
            key: apiKey
        });
        if (pageToken) params.set("pageToken", pageToken);
        const response = await fetchImpl(`https://www.googleapis.com/youtube/v3/playlistItems?${params}`, {
            signal: AbortSignal.timeout(15000)
        });
        if (!response.ok) throw new Error(`YouTube playlistItems.list respondió HTTP ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data.items)) throw new Error("playlistItems.list devolvió una respuesta sin items[]");
        const pageItems = data.items;
        if (!pageItems.length && data.nextPageToken) throw new Error("playlistItems.list devolvió una página vacía con nextPageToken");
        playlistItems.push(...pageItems);
        pageToken = data.nextPageToken || "";
        const pageDates = pageItems.map((item) => Date.parse(item.snippet?.publishedAt || "")).filter(Number.isFinite);
        if (pageDates.length && Math.min(...pageDates) < historyCutoff) break;
        if (!pageToken) break;
        if (page === maxPages - 1) {
            throw new Error(`La playlist uploads supera el límite de paginación seguro (${maxPages * 50} videos); historial incompleto, no se publica como resultado final.`);
        }
    }

    const ids = [...new Set(playlistItems.map((item) => item.contentDetails?.videoId).filter((id) => /^[a-zA-Z0-9_-]{11}$/.test(id || "")))];
    const videos = [];
    for (let offset = 0; offset < ids.length; offset += 50) {
        const params = new URLSearchParams({
            part: "snippet,contentDetails,liveStreamingDetails",
            id: ids.slice(offset, offset + 50).join(","),
            key: apiKey
        });
        const response = await fetchImpl(`https://www.googleapis.com/youtube/v3/videos?${params}`, {
            signal: AbortSignal.timeout(15000)
        });
        if (!response.ok) throw new Error(`YouTube videos.list respondió HTTP ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data.items)) throw new Error("videos.list devolvió una respuesta sin items[]");
        videos.push(...data.items);
    }
    const returnedIds = new Set(videos.map((video) => video.id));
    const missingIds = ids.filter((id) => !returnedIds.has(id));
    if (missingIds.length) {
        throw new Error(`videos.list omitió ${missingIds.length} video(s) de uploads; respuesta incompleta. IDs: ${missingIds.join(", ")}`);
    }
    return videos
        .filter((video) => video.snippet?.channelId === officialChannelId)
        .map((video, index) => {
            const snippet = video.snippet || {};
            const liveDetails = video.liveStreamingDetails || {};
            const thumbnail = snippet.thumbnails?.maxres || snippet.thumbnails?.standard || snippet.thumbnails?.high || snippet.thumbnails?.medium || snippet.thumbnails?.default;
            return {
                id: video.id,
                title: snippet.title || "Transmisión sin título",
                url: `https://www.youtube.com/watch?v=${video.id}`,
                thumbnail: cleanThumbnailUrl(thumbnail?.url, video.id),
                duration: getApiVideoDuration(video.contentDetails?.duration),
                publishedAt: liveDetails.actualStartTime || snippet.publishedAt || null,
                publishedText: null,
                source: "youtube-data-api-uploads",
                channelId: snippet.channelId,
                liveBroadcastContent: snippet.liveBroadcastContent || "none",
                liveStreamingDetails: liveDetails,
                actualStartTime: liveDetails.actualStartTime || null,
                actualEndTime: liveDetails.actualEndTime || null,
                scheduledStartTime: liveDetails.scheduledStartTime || null,
                originalIndex: index
            };
        });
}

function getChannelId(html) {
    return (
        matchFirst(html, /"browseId":"(UC[^"]+)"/) ||
        matchFirst(html, /"urlCanonical":"https:\/\/www\.youtube\.com\/channel\/(UC[^"]+)"/) ||
        matchFirst(html, /https:\/\/www\.youtube\.com\/channel\/(UC[^"\\]+)/)
    );
}

function getVideoIdFromUrl(url) {
    try {
        const parsedUrl = new URL(url);
        return parsedUrl.searchParams.get("v");
    } catch {
        return null;
    }
}

function getCanonicalVideoId(html) {
    return (
        matchFirst(html, /<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})"/) ||
        matchFirst(html, /"videoId":"([a-zA-Z0-9_-]{11})"/)
    );
}

function getPlayerVideoDetails(watchHtml) {
    return parseInitialPlayerResponse(watchHtml)?.videoDetails ?? null;
}

function getPlayerLiveDetails(watchHtml) {
    return parseInitialPlayerResponse(watchHtml)?.microformat?.playerMicroformatRenderer?.liveBroadcastDetails ?? null;
}

function getWatchMetadata(watchHtml, fallbackId) {
    const videoDetails = getPlayerVideoDetails(watchHtml);
    const videoId = videoDetails?.videoId || fallbackId;
    const thumbnails = videoDetails?.thumbnail?.thumbnails ?? [];
    const thumbnail = [...thumbnails].sort((left, right) => (right.width ?? 0) - (left.width ?? 0))[0];

    return {
        id: videoId,
        title:
            videoDetails?.title ||
            matchFirst(watchHtml, /<meta name="title" content="([^"]+)"/) ||
            matchFirst(watchHtml, /"title":"([^"]+)"/) ||
            "Transmision en vivo",
        thumbnail: cleanThumbnailUrl(thumbnail?.url, videoId)
    };
}

function getPublishDate(watchHtml) {
    const isoDate =
        matchFirst(watchHtml, /"publishDate":"([^"]+)"/) ||
        matchFirst(watchHtml, /"datePublished":"([^"]+)"/) ||
        matchFirst(watchHtml, /<meta itemprop="datePublished" content="([^"]+)"/);

    return isoDate || parseSpanishPublishText(getWatchPublishText(watchHtml));
}

function getWatchPublishText(watchHtml) {
    return matchFirst(watchHtml, /"publishDate":\{"simpleText":"([^"]+)"/);
}

function parseSpanishPublishText(value) {
    if (!value) return null;

    const normalized = value
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
    const match = normalized.match(
        /(\d{1,2})\s+(ene|enero|feb|febrero|mar|marzo|abr|abril|may|mayo|jun|junio|jul|julio|ago|agosto|sep|sept|septiembre|oct|octubre|nov|noviembre|dic|diciembre)\s+(\d{4})/
    );

    if (!match) return null;

    const monthMap = {
        ene: 0,
        enero: 0,
        feb: 1,
        febrero: 1,
        mar: 2,
        marzo: 2,
        abr: 3,
        abril: 3,
        may: 4,
        mayo: 4,
        jun: 5,
        junio: 5,
        jul: 6,
        julio: 6,
        ago: 7,
        agosto: 7,
        sep: 8,
        sept: 8,
        septiembre: 8,
        oct: 9,
        octubre: 9,
        nov: 10,
        noviembre: 10,
        dic: 11,
        diciembre: 11
    };

    const day = Number(match[1]);
    const month = monthMap[match[2]];
    const year = Number(match[3]);

    if (!Number.isInteger(day) || month === undefined || !Number.isInteger(year)) return null;

    return new Date(Date.UTC(year, month, day, 12, 0, 0)).toISOString();
}

function getLiveStartDate(watchHtml) {
    const liveDetails = getPlayerLiveDetails(watchHtml);

    return (
        liveDetails?.actualStartTime ||
        liveDetails?.startTimestamp ||
        matchFirst(watchHtml, /"actualStartTime":"([^"]+)"/) ||
        matchFirst(watchHtml, /"startTimestamp":"([^"]+)"/)
    );
}

function getLiveEndDate(watchHtml) {
    const liveDetails = getPlayerLiveDetails(watchHtml);

    return (
        liveDetails?.actualEndTime ||
        liveDetails?.endTimestamp ||
        matchFirst(watchHtml, /"actualEndTime":"([^"]+)"/) ||
        matchFirst(watchHtml, /"endTimestamp":"([^"]+)"/)
    );
}

function getScheduledStartDate(watchHtml) {
    return getPlayerLiveDetails(watchHtml)?.scheduledStartTime || matchFirst(watchHtml, /"scheduledStartTime":"([^"]+)"/);
}

function getColombiaDateKey(value) {
    if (!value) return null;

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;

    return new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZone: siteTimeZone
    }).format(date);
}

function getStreamTime(item) {
    const candidates = [
        item?.actualStartTime,
        item?.startedAt,
        item?.scheduledStartTime,
        item?.publishedAt,
        item?.actualEndTime,
        item?.endedAt
    ];

    for (const candidate of candidates) {
        const time = Date.parse(candidate ?? "");
        if (!Number.isNaN(time)) return time;
    }

    return Number.NEGATIVE_INFINITY;
}

function getStreamDateKey(item) {
    return (
        getColombiaDateKey(item?.actualStartTime) ||
        getColombiaDateKey(item?.startedAt) ||
        getColombiaDateKey(item?.scheduledStartTime) ||
        getColombiaDateKey(item?.publishedAt) ||
        getColombiaDateKey(item?.actualEndTime) ||
        getColombiaDateKey(item?.endedAt)
    );
}

function selectTodayFeaturedStream(items, now = new Date()) {
    const todayKey = getColombiaDateKey(now);
    if (!todayKey) return null;

    return [...items]
        .filter((item) => item?.type === "live" || item?.isLiveBroadcast === true || item?.typePriority === 1)
        .filter((item) => getStreamDateKey(item) === todayKey)
        .sort((left, right) => getStreamTime(right) - getStreamTime(left))[0] || null;
}

function getLiveState(watchHtml, requestedVideoId = null) {
    const playerResponse = parseInitialPlayerResponse(watchHtml);
    const videoDetails = playerResponse?.videoDetails;
    const playerMicroformat = playerResponse?.microformat?.playerMicroformatRenderer;
    const liveDetails = playerMicroformat?.liveBroadcastDetails;
    const liveBroadcastContent = playerMicroformat?.liveBroadcastContent ?? null;
    const isLiveContent = videoDetails?.isLiveContent === true;
    const wasLive = videoDetails?.wasLive === true || playerMicroformat?.wasLive === true;
    const isLiveBroadcast = playerMicroformat?.isLiveBroadcast ?? null;
    const actualEndTime =
        liveDetails?.actualEndTime ||
        matchFirst(watchHtml, /"actualEndTime":"([^"]+)"/) ||
        null;
    const endTimestamp = liveDetails?.endTimestamp || matchFirst(watchHtml, /"endTimestamp":"([^"]+)"/) || null;
    const actualStartTime =
        liveDetails?.actualStartTime ||
        liveDetails?.startTimestamp ||
        matchFirst(watchHtml, /"actualStartTime":"([^"]+)"/) ||
        matchFirst(watchHtml, /"startTimestamp":"([^"]+)"/) ||
        null;
    const scheduledStartTime = liveDetails?.scheduledStartTime || matchFirst(watchHtml, /"scheduledStartTime":"([^"]+)"/) || null;
    const broadcastState = classifyYouTubeBroadcast({
        requestedVideoId,
        videoId: videoDetails?.videoId ?? null,
        expectedChannelId: officialChannelId,
        channelId: videoDetails?.channelId ?? null,
        isLiveContent,
        wasLive,
        isLiveBroadcast,
        liveBroadcastContent,
        liveBroadcastDetails: liveDetails,
        actualEndTime,
        endTimestamp,
        actualStartTime,
        startTimestamp: liveDetails?.startTimestamp || matchFirst(watchHtml, /"startTimestamp":"([^"]+)"/) || null,
        scheduledStartTime,
        isUpcoming: videoDetails?.isUpcoming === true || liveDetails?.isUpcoming === true
    });

    return {
        hasPlayerMetadata: Boolean(videoDetails?.videoId) && broadcastState.idMatches,
        videoId: videoDetails?.videoId ?? null,
        ...broadcastState,
        endTime: broadcastState.actualEndTime
    };
}

function buildStreamItem(item, watchHtml, overrides = {}) {
    const startedAt = overrides.startedAt ?? getLiveStartDate(watchHtml) ?? null;
    const endedAt = overrides.endedAt ?? getLiveEndDate(watchHtml) ?? null;
    const scheduledStartTime = overrides.scheduledStartTime ?? getScheduledStartDate(watchHtml) ?? null;
    const publishedAt = startedAt || getPublishDate(watchHtml) || item.publishedAt || endedAt || null;

    return {
        ...item,
        ...overrides,
        type: "live",
        typeLabel: overrides.typeLabel ?? "Directo",
        typePriority: 1,
        isLiveBroadcast: true,
        description:
            overrides.description ??
            "Transmision en vivo archivada del canal oficial de la Iglesia Cristiana Gracia Sobre Gracia.",
        publishedText: overrides.publishedText ?? getWatchPublishText(watchHtml) ?? item.publishedText ?? null,
        publishedAt,
        startedAt,
        actualStartTime: startedAt,
        endedAt,
        actualEndTime: endedAt,
        scheduledStartTime
    };
}

function getStoredActiveLive(...payloads) {
    return getAuthoritativeActiveLive(payloads[0], ...payloads.slice(1));
}

export async function getActiveLive(streamCandidates, knownLiveId = null, channelId = null) {
    const apiCandidates = streamCandidates.filter((item) => item?.source === "youtube-data-api-uploads");
    const apiActive = apiCandidates.find((item) =>
        item.channelId === officialChannelId &&
        item.liveBroadcastContent === "live" &&
        !item.actualEndTime
    );
    if (apiActive) {
        const activeLive = {
            ...apiActive,
            type: "live",
            typePriority: 1,
            typeLabel: "🔴 EN VIVO AHORA",
            isLiveBroadcast: true,
            isLiveNow: true,
            isUpcoming: false,
            status: "live",
            verificationSource: "youtube-data-api-videos-list",
            description: "Estamos transmitiendo nuestro servicio en este momento."
        };
        logCandidateDecision({ videoId: activeLive.id, title: activeLive.title, source: activeLive.source, decision: "LIVE", reason: "videos.list reports liveBroadcastContent=live" });
        return { activeLive, knownLiveEnded: false, verificationStatus: "ok" };
    }
    const sourcePages = [];
    let sourceErrors = 0;
    const sources = await Promise.all([channelLiveUrl, channelStreamsUrl].map(async (url) => {
        try {
            console.log(`[live] Consultando ${url}`);
            return { url, ...(await fetchPage(url)) };
        } catch (error) {
            sourceErrors += 1;
            console.warn(`[live] Error consultando ${url}: ${error.message}`);
            return null;
        }
    }));
    sourcePages.push(...sources.filter(Boolean));
    if (!sourcePages.length && !knownLiveId) {
        throw new Error("No se pudo consultar ninguna página oficial del canal ni existe un LIVE anterior que pueda verificarse directamente.");
    }
    const pageCandidates = sourcePages.flatMap(({ url, html, finalUrl }) => {
        const playerId = getPlayerVideoDetails(html)?.videoId;
        const ids = [getVideoIdFromUrl(finalUrl), getVideoIdFromUrl(url), playerId, getCanonicalVideoId(html)];
        try {
            const pageLimit = url === channelStreamsUrl ? maxLiveCandidatesPerSource : url === channelLiveUrl ? 3 : 2;
            ids.push(...getStreamItems(parseInitialData(html)).slice(0, pageLimit).map((item) => item.id));
        } catch (error) {
            sourceErrors += 1;
            console.warn(`[live] No se pudieron extraer candidatos de ${url}: ${error.message}`);
        }
        return ids.filter(Boolean);
    });
    const apiEndedLive = knownLiveId
        ? apiCandidates.find((item) => item.id === knownLiveId && item.channelId === officialChannelId && item.actualStartTime && item.actualEndTime)
        : null;
    const candidateIds = [...new Set([
        apiEndedLive ? null : knownLiveId,
        ...pageCandidates,
        ...streamCandidates
            .filter((item) => item?.source === "youtube-streams-page")
            .slice(0, maxLiveCandidatesPerSource)
            .map((item) => item.id)
    ].filter((id) => id && id !== apiEndedLive?.id))];
    console.log(`[live] Candidatos de video encontrados: ${candidateIds.length}.`);
    let knownLiveEnded = Boolean(apiEndedLive);
    let verificationErrors = 0;
    const upcomingLives = apiCandidates
        .filter((item) => item.channelId === officialChannelId && item.liveBroadcastContent === "upcoming")
        .map((item) => ({ ...item, isUpcoming: true, isLiveNow: false }));
    let endedLive = apiEndedLive ? {
        ...apiEndedLive,
        publishedAt: apiEndedLive.actualStartTime,
        startedAt: apiEndedLive.actualStartTime,
        endedAt: apiEndedLive.actualEndTime,
        type: "live",
        typeLabel: "Directo",
        typePriority: 1,
        isLiveBroadcast: true,
        isLiveNow: false,
        isUpcoming: false,
        status: "archived",
        verificationSource: "youtube-data-api-videos-list"
    } : null;
    let knownLiveUncertain = false;

    for (const videoId of candidateIds) {
        let watchPage;
        try {
            const url = `https://www.youtube.com/watch?v=${videoId}`;
            console.log(`[live] Consultando ${url}`);
            watchPage = await fetchPage(url);
        } catch (error) {
            verificationErrors += 1;
            console.error(`[live] No se pudo verificar el video ${videoId}: ${error.message}`);
            if (videoId === knownLiveId) throw error;
            if (error.status === 429) {
                if (knownLiveEnded) break;
                throw error;
            }
            continue;
        }

        const playerDetails = getPlayerVideoDetails(watchPage.html);
        if (!playerDetails?.videoId || !playerDetails?.channelId) {
            verificationErrors += 1;
            console.warn(`[live] Video ${videoId} no tiene metadata completa de video/canal; no se interpreta como NO LIVE.`);
            continue;
        }
        if (playerDetails.channelId !== officialChannelId) {
            console.log(`[live] Video ${videoId} descartado: pertenece al canal ${playerDetails.channelId}, no al canal oficial ${officialChannelId}.`);
            if (videoId === knownLiveId) {
                throw new Error(`El video LIVE previamente confirmado (${videoId}) ahora responde con un canal distinto; no se puede confirmar el cierre.`);
            }
            continue;
        }

        const watchMetadata = getWatchMetadata(watchPage.html, videoId);
        const liveState = getLiveState(watchPage.html, videoId);
        if (watchMetadata.id !== videoId) {
            console.log(`[live] Video ${videoId} descartado: ID canónico/canal no corresponde al video solicitado o al canal oficial.`);
            if (videoId === knownLiveId) {
                throw new Error(`YouTube devolvió un video distinto al LIVE previamente confirmado (${videoId}).`);
            }
            continue;
        }
        logCandidateDecision({
            videoId,
            title: watchMetadata.title,
            publishedAt: getPublishDate(watchPage.html) || null,
            actualStartTime: liveState.actualStartTime || null,
            actualEndTime: liveState.actualEndTime || null,
            liveBroadcastContent: liveState.liveBroadcastContent || null,
            source: "youtube-watch-live-metadata",
            status: liveState.isLiveNow ? "live" : liveState.isUpcoming ? "upcoming" : liveState.isArchived ? "completed" : "unknown",
            decision: liveState.isLiveNow ? "LIVE" : liveState.isUpcoming ? "UPCOMING" : liveState.isArchived ? "ARCHIVED_RECENT" : "DISCARDED",
            reason: liveState.isLiveNow ? "active-broadcast-confirmed" : liveState.isUpcoming ? "scheduled-event" : liveState.isArchived ? "youtube-confirms-broadcast-ended" : "no-live-confirmation"
        });
        if (liveState.hasPlayerMetadata && liveState.isLiveNow) {
            console.log(`[live] Video activo confirmado: ${videoId} — ${watchMetadata.title}`);
            return {
                activeLive: buildStreamItem(
                    {
                        id: videoId,
                        title: watchMetadata.title,
                        url: `https://www.youtube.com/watch?v=${videoId}`,
                        thumbnail: watchMetadata.thumbnail,
                        duration: null,
                        publishedText: "En vivo ahora",
                        originalIndex: -1
                    },
                    watchPage.html,
                    {
                        status: "live",
                        channelId: playerDetails.channelId,
                        verificationSource: "youtube-watch-live-metadata",
                        typeLabel: "🔴 EN VIVO AHORA",
                        isLiveNow: true,
                        isUpcoming: false,
                        liveBroadcastContent: liveState.liveBroadcastContent || "LIVE",
                        isLiveBroadcast: liveState.isLiveBroadcast,
                        liveBroadcastDetails: liveState.liveBroadcastDetails,
                        startedAt: getLiveStartDate(watchPage.html) || null,
                        actualStartTime: getLiveStartDate(watchPage.html) || null,
                        scheduledStartTime: getScheduledStartDate(watchPage.html) || null,
                        description: "Estamos transmitiendo nuestro servicio en este momento."
                    }
                ),
                knownLiveEnded: false,
                verificationStatus: "ok"
            };
        }

        if (liveState.hasPlayerMetadata && liveState.isUpcoming) {
            const candidate = streamCandidates.find((item) => item.id === videoId) || {};
            upcomingLives.push({
                ...candidate,
                id: videoId,
                title: watchMetadata.title,
                url: `https://www.youtube.com/watch?v=${videoId}`,
                thumbnail: watchMetadata.thumbnail,
                isUpcoming: true,
                isLiveNow: false,
                isLiveBroadcast: liveState.isLiveBroadcast,
                liveBroadcastContent: liveState.liveBroadcastContent,
                actualStartTime: liveState.actualStartTime,
                scheduledStartTime: liveState.scheduledStartTime
            });
            console.log(`[live] Video ${videoId} descartado como live actual: transmisión próxima/programada.`);
            if (videoId === knownLiveId) knownLiveUncertain = true;
            continue;
        }

        if (liveState.isArchived) {
            console.log(`[live] Video ${videoId} descartado como live actual: transmisión archivada (finalizó).`);
        } else {
            console.log(`[live] Video ${videoId} descartado: YouTube no confirma una transmisión activa.`);
        }
        if (videoId === knownLiveId && liveState.hasPlayerMetadata && liveState.isArchived) {
            knownLiveEnded = true;
            const previous = streamCandidates.find((item) => item.id === videoId) || {};
            endedLive = buildStreamItem({
                ...previous,
                id: videoId,
                title: watchMetadata.title,
                url: `https://www.youtube.com/watch?v=${videoId}`,
                thumbnail: watchMetadata.thumbnail,
                originalIndex: -1
            }, watchPage.html, {
                status: "archived",
                verificationSource: "watch-live-metadata"
            });
        } else if (
            videoId === knownLiveId &&
            liveState.hasPlayerMetadata &&
            !liveState.isLiveNow &&
            !liveState.isUpcoming
        ) {
            knownLiveUncertain = true;
        }
    }

    if (knownLiveUncertain && !knownLiveEnded) {
        throw new Error(`YouTube no confirmó si terminó el LIVE anterior (${knownLiveId}); se conserva como último estado conocido y se marca sin verificar.`);
    }
    if (knownLiveId && verificationErrors > 0 && !knownLiveEnded) {
        throw new Error(`No se pudo confirmar el estado de la transmisión activa anterior (${verificationErrors} verificación(es) fallida(s)).`);
    }
    if (!knownLiveEnded && (sourceErrors > 0 || verificationErrors > 0)) {
        throw new Error(`Resultado incompleto: errores en ${verificationErrors} video(s) y ${sourceErrors} página(s); se conservan los JSON anteriores.`);
    }

    const verificationError = knownLiveEnded && (sourceErrors > 0 || verificationErrors > 0)
        ? `El LIVE anterior terminó, pero la búsqueda del siguiente LIVE quedó incompleta (${verificationErrors} video(s), ${sourceErrors} página(s) con error).`
        : null;

    return {
        activeLive: null,
        knownLiveEnded,
        endedLive,
        endedLiveId: knownLiveEnded ? knownLiveId : null,
        verificationStatus: verificationError ? "error" : "ok",
        verificationError,
        upcomingLive: upcomingLives.sort((left, right) => Date.parse(left.scheduledStartTime || "") - Date.parse(right.scheduledStartTime || ""))[0] || null
    };
}

export async function enrichArchivedStreams(items, protectedLiveId = null) {
    const archivedItems = [];
    const failures = [];
    for (let index = 0; index < items.length; index += 2) {
        const results = await Promise.all(items.slice(index, index + 2).map(async (item) => {
            if (item.source === "youtube-data-api-uploads") {
                const details = item.liveStreamingDetails || {};
                if (item.liveBroadcastContent === "live" || item.liveBroadcastContent === "upcoming") {
                    logCandidateDecision({ videoId: item.id, title: item.title, source: item.source, decision: "DISCARDED", reason: item.liveBroadcastContent === "live" ? "still-live" : "upcoming-is-not-an-archive" });
                    return null;
                }
                if (item.channelId !== officialChannelId || !details.actualEndTime || !details.actualStartTime) {
                    logCandidateDecision({ videoId: item.id, title: item.title, source: item.source, decision: "DISCARDED", reason: "videos.list-has-no-completed-livestream-times" });
                    return null;
                }
                const archived = {
                    ...item,
                    publishedAt: details.actualStartTime,
                    startedAt: details.actualStartTime,
                    actualStartTime: details.actualStartTime,
                    endedAt: details.actualEndTime,
                    actualEndTime: details.actualEndTime,
                    scheduledStartTime: details.scheduledStartTime || null,
                    type: "live",
                    typeLabel: "Directo",
                    typePriority: 1,
                    isLiveBroadcast: true,
                    isLiveNow: false,
                    isUpcoming: false,
                    status: "archived",
                    verificationSource: "youtube-data-api-videos-list",
                    description: "Transmision en vivo archivada del canal oficial de la Iglesia Cristiana Gracia Sobre Gracia."
                };
                logCandidateDecision({ videoId: archived.id, title: archived.title, publishedAt: archived.publishedAt, actualStartTime: archived.actualStartTime, actualEndTime: archived.actualEndTime, source: item.source, status: "completed", decision: "ARCHIVED_RECENT", reason: "videos.list-confirms-start-and-end-times" });
                return archived;
            }
            try {
                if (diagnosticMode) console.log(`[archive] Consultando ${item.url}`);
                const watchHtml = await fetchText(item.url);
                const watchMetadata = getWatchMetadata(watchHtml, item.id);
                const liveState = getLiveState(watchHtml, item.id);
                const confirmedArchive = liveState.isArchived && liveState.isLiveLike;
                let decision = "DISCARDED";
                let reason = "no-confirmed-livestream-metadata";
                if (liveState.isLiveNow) reason = "still-live";
                else if (liveState.isUpcoming) reason = "upcoming-is-not-an-archive";
                else if (item.id === protectedLiveId && !confirmedArchive) reason = "protected-live-end-not-confirmed";
                else if (confirmedArchive) {
                    decision = "ARCHIVED_RECENT";
                    reason = "youtube-confirms-completed-livestream";
                }
                logCandidateDecision({
                    videoId: item.id,
                    title: watchMetadata.title || item.title,
                    publishedAt: item.publishedAt || null,
                    actualStartTime: liveState.actualStartTime || null,
                    actualEndTime: liveState.actualEndTime || null,
                    liveBroadcastContent: liveState.liveBroadcastContent || null,
                    source: item.source || "youtube-streams-page",
                    decision,
                    reason
                });
                if (decision !== "ARCHIVED_RECENT") return null;
                return buildStreamItem(item, watchHtml, {
                    title: watchMetadata.title || item.title,
                    thumbnail: watchMetadata.thumbnail || item.thumbnail,
                    status: "archived",
                    verificationSource: "youtube-watch-live-metadata"
                });
            } catch (error) {
                failures.push({ videoId: item.id, error: error.message });
                console.error(`[archive-candidate] ${JSON.stringify({
                    videoId: item.id,
                    title: item.title,
                    source: item.source || "youtube-streams-page",
                    decision: "DEFERRED",
                    reason: `metadata-request-failed: ${error.message}`
                })}`);
                return null;
            }
        }));
        archivedItems.push(...results.filter(Boolean));
    }
    if (failures.length) {
        throw new Error(`No se verificaron ${failures.length} candidato(s) de archivo; se preserva el feed previo. IDs: ${failures.map(({ videoId }) => videoId).join(", ")}`);
    }

    return archivedItems;
}

function sortByPublicationDate(items) {
    return [...items].sort((left, right) => {
        const leftTime = Date.parse(left.publishedAt ?? "");
        const rightTime = Date.parse(right.publishedAt ?? "");

        if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime) && leftTime !== rightTime) {
            return rightTime - leftTime;
        }

        return (left.originalIndex ?? 0) - (right.originalIndex ?? 0);
    });
}

export function selectFeaturedStream(activeLive, archivedItems) {
    if (activeLive?.isLiveNow === true && activeLive.status !== "archived") return activeLive;
    return sortByPublicationDate((Array.isArray(archivedItems) ? archivedItems : []).filter((item) =>
        item?.status === "archived" && item?.type === "live" && item?.isUpcoming !== true
    ))[0] || null;
}

export function mergeArchivedStreams(existingItems, newItems, activeLiveId = null) {
    const byId = new Map();
    for (const item of Array.isArray(existingItems) ? existingItems : []) {
        if (item?.id && item.id !== activeLiveId) byId.set(item.id, item);
    }
    for (const item of Array.isArray(newItems) ? newItems : []) {
        if (item?.id && item.id !== activeLiveId) byId.set(item.id, item);
    }
    return sortByPublicationDate([...byId.values()]);
}

async function main({ writeOutput = true } = {}) {
    if (!process.env.YOUTUBE_API_KEY) {
        throw new Error("Falta YOUTUBE_API_KEY. Configure el secreto del workflow para reconstruir las transmisiones desde uploads con paginación; RSS solo expone una ventana limitada.");
    }
    const existingPayload = await readJsonFile(outputPath);
    const existingLiveStatus = await readJsonFile(liveStatusPath);
    const previouslyActiveLive = getStoredActiveLive(existingLiveStatus, existingPayload);
    let streamsHtml = "";
    let streamCandidates = [];
    try {
        streamsHtml = await fetchText(channelStreamsUrl);
        streamCandidates = getStreamItems(parseInitialData(streamsHtml));
    } catch (error) {
        console.warn(`[archive] No se pudo cargar /streams; la detección del live continuará con /live, canal y video conocido: ${error.message}`);
    }
    try {
        const feedXml = await fetchText(channelUploadsFeedUrl);
        const feedItems = parseUploadsFeed(feedXml);
        streamCandidates = [...streamCandidates, ...feedItems];
        console.log(`[archive] RSS uploads: ${feedItems.length} candidato(s); union provisional con /streams: ${streamCandidates.length}.`);
    } catch (error) {
        console.warn(`[archive] No se pudo consultar el RSS de uploads; se conserva /streams como fuente de historial: ${error.message}`);
    }
    const apiItems = await fetchUploadsFromYouTubeDataApi(process.env.YOUTUBE_API_KEY);
    streamCandidates.push(...apiItems);
    console.log(`[archive] YouTube Data API uploads: ${apiItems.length} candidato(s), paginación maxResults=50 habilitada.`);
    const deduplicatedCandidates = new Map();
    for (const item of streamCandidates) {
        const prior = deduplicatedCandidates.get(item.id);
        if (!prior || item.source === "youtube-data-api-uploads" || item.source === "youtube-streams-page") {
            deduplicatedCandidates.set(item.id, item);
        }
    }
    streamCandidates = sortByPublicationDate([...deduplicatedCandidates.values()]);
    const channelId = officialChannelId;
    const detectedLive = await getActiveLive(streamCandidates, previouslyActiveLive?.id ?? null, channelId);
    const activeLive = detectedLive.activeLive;
    console.log(
        `[live] Resultado final: isLiveNow=${Boolean(activeLive)}, activeLiveId=${activeLive?.id ?? "null"}, upcomingLiveId=${detectedLive.upcomingLive?.id ?? "null"}.`
    );
    // Publicar primero el estado LIVE; el enriquecimiento del archivo puede tardar
    // varios requests secuenciales y no debe retrasar el aviso del frontend.
    const checkedAt = new Date().toISOString();
    const liveStatusPayload = buildLiveStatusSnapshot(existingLiveStatus || existingPayload || {
        channel: {
            name: "Iglesia Cristiana Gracia Sobre Gracia",
            url: channelHomeUrl,
            channelId
        },
        source: "youtube-data-api-uploads-and-live-pages"
    }, {
        activeLive,
        endedLiveId: detectedLive.endedLiveId,
        upcomingLive: detectedLive.upcomingLive,
        verificationStatus: detectedLive.verificationStatus,
        error: detectedLive.verificationError
    }, checkedAt);
    liveStatusPayload.channel = {
        name: "Iglesia Cristiana Gracia Sobre Gracia",
        url: channelHomeUrl,
        channelId
    };
    liveStatusPayload.source = "youtube-data-api-uploads-and-live-pages";
    if (writeOutput) {
        await mkdir(outputDirectory, { recursive: true });
        await writeFile(liveStatusPath, `${JSON.stringify(liveStatusPayload, null, 2)}\n`, "utf8");
        console.log(`Estado del live actualizado en ${liveStatusPath}`);
    }

    const archiveCandidates = streamCandidates
        .filter((item) => item.id !== detectedLive.endedLive?.id && item.id !== activeLive?.id);
    let archivedItems = Array.isArray(existingPayload?.items) ? existingPayload.items : [];
    let archiveError = null;
    try {
        archivedItems = mergeArchivedStreams(
            existingPayload?.items,
            [
                ...(detectedLive.endedLive ? [detectedLive.endedLive] : []),
                ...await enrichArchivedStreams(archiveCandidates, activeLive?.id ?? null)
            ],
            activeLive?.id ?? null
        );
    } catch (error) {
        archiveError = error;
        if (detectedLive.endedLive) {
            archivedItems = mergeArchivedStreams([
                ...archivedItems,
                detectedLive.endedLive
            ], [], activeLive?.id ?? null);
        }
        console.error(`[archive] Se conserva el archivo previo y el live recién finalizado; live-status.json ya quedó actualizado: ${error.message}`);
    }
    archivedItems = archivedItems.slice(0, Math.max(maxArchivedStreams, Array.isArray(existingPayload?.items) ? existingPayload.items.length : 0));
    const featuredLiveToday = selectTodayFeaturedStream(activeLive ? [activeLive, ...archivedItems] : archivedItems) ||
        selectFeaturedStream(activeLive, archivedItems);

    const payload = {
        channel: {
            name: "Iglesia Cristiana Gracia Sobre Gracia",
            url: channelHomeUrl,
            channelId
        },
        updatedAt: checkedAt,
        source: "youtube-data-api-uploads-and-live-pages",
        status: {
            ...liveStatusPayload.status,
            upcomingLiveId: detectedLive.upcomingLive?.id ?? null,
            featuredLiveTodayId: featuredLiveToday?.id ?? null,
        },
        activeLive,
        upcomingLive: detectedLive.upcomingLive,
        featuredLiveToday,
        items: archivedItems,
        archiveVerificationStatus: archiveError ? "error" : "ok",
        archiveError: archiveError?.message || null
    };
    if (writeOutput) {
        await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
        console.log(`Transmisiones actualizadas en ${outputPath}`);
    } else {
        const preview = {
            checkedAt,
            liveStatus: liveStatusPayload,
            activeLive,
            endedLive: detectedLive.endedLive,
            upcomingLive: detectedLive.upcomingLive,
            verificationStatus: detectedLive.verificationStatus,
            recentArchived: archivedItems.slice(0, maxArchivedStreams),
            featuredLiveToday,
            candidateCount: streamCandidates.length,
            archiveVerificationStatus: payload.archiveVerificationStatus,
            archiveError: payload.archiveError
        };
        console.log(`[diagnostic-result] ${JSON.stringify(preview)}`);
        if (!archiveError) return preview;
    }
    if (archiveError) throw new Error(`La detección activa terminó, pero la verificación del archivo quedó incompleta: ${archiveError.message}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) main({ writeOutput: !process.argv.includes("--diagnose") }).catch(async (error) => {
    if (process.argv.includes("--diagnose")) {
        console.error("[diagnostic-result] ERROR: no se pudo completar la consulta; no se modificó ningún JSON.", error);
        process.exitCode = 1;
        return;
    }
    console.error("[live] ERROR: estado no confirmado. Se conserva el último estado válido para no publicar un falso inactivo.", error);
    const attemptedAt = new Date().toISOString();
    try {
        const [previousLive, previousSermons] = await Promise.all([
            readJsonFile(liveStatusPath),
            readJsonFile(outputPath)
        ]);
        const snapshots = buildVerificationFailureSnapshots(previousLive, previousSermons, attemptedAt, error);
        await mkdir(outputDirectory, { recursive: true });
        await Promise.all([
            writeFile(liveStatusPath, `${JSON.stringify(snapshots.liveStatus, null, 2)}\n`, "utf8"),
            writeFile(outputPath, `${JSON.stringify(snapshots.sermons, null, 2)}\n`, "utf8")
        ]);
        console.error(`[live] Ambos JSON conservan el último resultado, sincronizan verificationStatus=error y registran lastAttemptAt=${attemptedAt}.`);
    } catch (writeError) {
        console.error("[live] No se pudo publicar el resultado de verificación fallida.", writeError);
    }
    process.exitCode = 1;
});
