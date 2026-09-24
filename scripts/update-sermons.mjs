import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const outputDirectory = path.join(projectRoot, "data");
const outputPath = path.join(outputDirectory, "predicaciones.json");
const liveStatusPath = path.join(outputDirectory, "live-status.json");
const channelHomeUrl = "https://www.youtube.com/@icgraciasobregracia";
const channelStreamsUrl = `${channelHomeUrl}/streams`;
const channelLiveUrl = `${channelHomeUrl}/live`;
const channelVideosUrl = `${channelHomeUrl}/videos`;
const maxArchivedStreams = 8;
const siteTimeZone = "America/Bogota";

async function fetchPage(url) {
    const response = await fetch(url, {
        headers: {
            "Accept-Language": "es-CO,es;q=0.9,en;q=0.7",
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
        }
    });

    if (!response.ok) {
        throw new Error(`No se pudo cargar ${url} (${response.status})`);
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
            isUpcoming: Boolean(renderer?.upcomingEventData),
            scheduledStartTime: renderer?.upcomingEventData?.startTime
                ? new Date(Number(renderer.upcomingEventData.startTime) * 1000).toISOString()
                : null,
            originalIndex: items.length
        });
    });

    return items;
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
        liveDetails?.scheduledStartTime ||
        matchFirst(watchHtml, /"actualStartTime":"([^"]+)"/) ||
        matchFirst(watchHtml, /"startTimestamp":"([^"]+)"/) ||
        matchFirst(watchHtml, /"scheduledStartTime":"([^"]+)"/)
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
    const liveBroadcastContent = String(playerMicroformat?.liveBroadcastContent ?? "").toUpperCase();
    const isLiveContent = videoDetails?.isLiveContent === true;
    const hasEnded = Boolean(liveDetails?.endTimestamp || liveDetails?.actualEndTime);
    const actualStartTime = liveDetails?.actualStartTime || liveDetails?.startTimestamp || null;
    const scheduledStartTime = liveDetails?.scheduledStartTime || null;
    const idMatches = !requestedVideoId || videoDetails?.videoId === requestedVideoId;
    const isUpcoming = Boolean(!hasEnded && (
        videoDetails?.isUpcoming === true || liveDetails?.isUpcoming === true || liveBroadcastContent === "UPCOMING" ||
        (scheduledStartTime && Date.parse(scheduledStartTime) > Date.now() && !actualStartTime)
    ));
    const hasLiveSignal =
        liveDetails?.isLiveNow === true ||
        liveBroadcastContent === "LIVE" ||
        (playerMicroformat?.isLiveBroadcast === true && Boolean(actualStartTime));
    const isLiveNow = idMatches && hasLiveSignal && !hasEnded && !isUpcoming;
    const isLiveLike = Boolean(isLiveContent || liveDetails || hasLiveSignal);

    return {
        hasPlayerMetadata: Boolean(videoDetails?.videoId) && idMatches,
        videoId: videoDetails?.videoId ?? null,
        isLiveContent,
        liveBroadcastContent: liveBroadcastContent || null,
        isLiveBroadcast: playerMicroformat?.isLiveBroadcast ?? null,
        liveBroadcastDetails: liveDetails ?? null,
        actualStartTime,
        scheduledStartTime,
        isLiveLike,
        isLiveNow,
        isArchived: isLiveLike && hasEnded && !isLiveNow,
        isUpcoming
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
    for (const payload of payloads) {
        if (payload?.status?.isLiveNow === true && payload.activeLive?.id) {
            return payload.activeLive;
        }
    }

    return null;
}

async function getActiveLive(streamCandidates, knownLiveId = null, channelId = null) {
    const sourcePages = [];
    let sourceErrors = 0;
    for (const url of [channelLiveUrl, channelStreamsUrl, channelHomeUrl, channelVideosUrl]) {
        try {
            console.log(`[live] Consultando ${url}`);
            const page = await fetchPage(url);
            sourcePages.push({ url, ...page });
        } catch (error) {
            sourceErrors += 1;
            console.warn(`[live] Error consultando ${url}: ${error.message}`);
        }
    }
    if (!sourcePages.length) throw new Error("No se pudo consultar ninguna página oficial del canal para detectar el live.");

    const pageCandidates = sourcePages.flatMap(({ url, html, finalUrl }) => {
        const playerId = getPlayerVideoDetails(html)?.videoId;
        const ids = [getVideoIdFromUrl(finalUrl), getVideoIdFromUrl(url), playerId, getCanonicalVideoId(html)];
        try {
            ids.push(...getStreamItems(parseInitialData(html)).map((item) => item.id));
        } catch (error) {
            console.warn(`[live] No se pudieron extraer candidatos de ${url}: ${error.message}`);
        }
        return ids.filter(Boolean);
    });
    const candidateIds = new Set([knownLiveId, ...pageCandidates, ...streamCandidates.map((item) => item.id)].filter(Boolean));
    console.log(`[live] Candidatos de video encontrados: ${candidateIds.size} (${[...candidateIds].join(", ") || "ninguno"})`);
    let knownLiveEnded = false;
    let verificationErrors = 0;
    const upcomingLives = [];

    for (const videoId of candidateIds) {
        let watchPage;

        try {
            const url = `https://www.youtube.com/watch?v=${videoId}`;
            console.log(`[live] Consultando ${url}`);
            watchPage = await fetchPage(url);
        } catch (error) {
            verificationErrors += 1;
            console.error(`[live] No se pudo verificar el video ${videoId}: ${error.message}`);
            continue;
        }

        const watchMetadata = getWatchMetadata(watchPage.html, videoId);
        const liveState = getLiveState(watchPage.html, videoId);
        const playerDetails = getPlayerVideoDetails(watchPage.html);
        if (watchMetadata.id !== videoId || (channelId && playerDetails?.channelId && playerDetails.channelId !== channelId)) {
            console.log(`[live] Video ${videoId} descartado: ID canónico/canal no corresponde al video solicitado o al canal oficial.`);
            continue;
        }
        console.log(`[live] Video ${videoId}: liveBroadcastContent=${liveState.liveBroadcastContent ?? "n/d"}, isLiveBroadcast=${liveState.isLiveBroadcast ?? "n/d"}, isLiveNow=${liveState.isLiveNow}, isUpcoming=${liveState.isUpcoming}, actualStartTime=${liveState.actualStartTime ?? "n/d"}, scheduledStartTime=${liveState.scheduledStartTime ?? "n/d"}, end=${liveState.isArchived}`);
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
                knownLiveEnded: false
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
            continue;
        }

        if (liveState.isArchived) {
            console.log(`[live] Video ${videoId} descartado como live actual: transmisión archivada (finalizó).`);
        } else {
            console.log(`[live] Video ${videoId} descartado: YouTube no confirma una transmisión activa.`);
        }
        if (videoId === knownLiveId && liveState.hasPlayerMetadata && liveState.isArchived) {
            knownLiveEnded = true;
        }
    }

    if (verificationErrors > 0 || sourceErrors > 0) {
        throw new Error(`Resultado incompleto: errores en ${verificationErrors} video(s) y ${sourceErrors} página(s); se conservan los JSON anteriores.`);
    }

    return {
        activeLive: null,
        knownLiveEnded,
        upcomingLive: upcomingLives.sort((left, right) => Date.parse(left.scheduledStartTime || "") - Date.parse(right.scheduledStartTime || ""))[0] || null
    };
}

async function enrichArchivedStreams(items, protectedLiveId = null) {
    const archivedItems = [];

    for (const item of items) {
        let watchHtml;
        try {
            console.log(`[archive] Consultando ${item.url}`);
            watchHtml = await fetchText(item.url);
        } catch (error) {
            console.error(`[archive] Error verificando ${item.id}; no se reemplazarán los JSON: ${error.message}`);
            throw error;
        }
        const liveState = getLiveState(watchHtml);

        if (liveState.isLiveNow || liveState.isUpcoming) {
            console.log(`[archive] Video ${item.id} excluido del archivo: ${liveState.isUpcoming ? "próximo/programado" : "en vivo"}.`);
            continue;
        }

        // Mientras no exista un cierre confirmado, un LIVE previamente valido
        // nunca se reclasifica como archivado por una respuesta incompleta.
        if (item.id === protectedLiveId && !liveState.isArchived) {
            continue;
        }

        archivedItems.push(
            buildStreamItem(item, watchHtml, {
                status: "archived",
                verificationSource: liveState.isLiveLike ? "watch-live-metadata" : "youtube-streams-tab"
            })
        );
        console.log(`[archive] Video ${item.id} guardado como archivado${liveState.isArchived ? " (YouTube confirma que finalizó)" : " (sin señal de live activo/próximo)"}.`);
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

async function main() {
    const existingPayload = await readJsonFile(outputPath);
    const existingLiveStatus = await readJsonFile(liveStatusPath);
    const previouslyActiveLive = getStoredActiveLive(existingLiveStatus, existingPayload);
    const streamsHtml = await fetchText(channelStreamsUrl);
    const initialData = parseInitialData(streamsHtml);
    const channelId = getChannelId(streamsHtml);
    const streamCandidates = getStreamItems(initialData);
    const detectedLive = await getActiveLive(streamCandidates, previouslyActiveLive?.id ?? null, channelId);
    const activeLive = detectedLive.activeLive;
    console.log(
        `[live] Resultado final: isLiveNow=${Boolean(activeLive)}, activeLiveId=${activeLive?.id ?? "null"}, upcomingLiveId=${detectedLive.upcomingLive?.id ?? "null"}.`
    );
    const archivedItems = sortByPublicationDate(await enrichArchivedStreams(streamCandidates, activeLive?.id ?? null))
        .slice(0, maxArchivedStreams);
    const featuredLiveToday = selectTodayFeaturedStream(activeLive ? [activeLive, ...archivedItems] : archivedItems);

    if (!activeLive && !archivedItems.length) {
        throw new Error("No se encontraron transmisiones en vivo del canal.");
    }

    const payload = {
        channel: {
            name: "Iglesia Cristiana Gracia Sobre Gracia",
            url: channelHomeUrl,
            channelId
        },
        updatedAt: new Date().toISOString(),
        source: "youtube-streams-and-live-pages",
        status: {
            isLiveNow: Boolean(activeLive),
            activeLiveId: activeLive?.id ?? null,
            upcomingLiveId: detectedLive.upcomingLive?.id ?? null,
            featuredLiveTodayId: featuredLiveToday?.id ?? null,
            checkedAt: new Date().toISOString()
        },
        activeLive,
        upcomingLive: detectedLive.upcomingLive,
        featuredLiveToday,
        items: archivedItems
    };
    const liveStatusPayload = {
        channel: payload.channel,
        updatedAt: payload.updatedAt,
        source: payload.source,
        status: payload.status,
        activeLive,
        upcomingLive: detectedLive.upcomingLive
    };

    await mkdir(outputDirectory, { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await writeFile(liveStatusPath, `${JSON.stringify(liveStatusPayload, null, 2)}\n`, "utf8");
    console.log(`Transmisiones actualizadas en ${outputPath}`);
    console.log(`Estado del live actualizado en ${liveStatusPath}`);
}

main().catch(async (error) => {
    console.error("[live] ERROR: no se pudo completar la actualización de YouTube; se conservan los JSON anteriores.", error);
    process.exitCode = 1;
});
