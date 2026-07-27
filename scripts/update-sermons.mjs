import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const outputDirectory = path.join(projectRoot, "data");
const outputPath = path.join(outputDirectory, "predicaciones.json");
const channelHomeUrl = "https://www.youtube.com/@icgraciasobregracia";
const channelStreamsUrl = `${channelHomeUrl}/streams`;
const channelLiveUrl = `${channelHomeUrl}/live`;
const maxArchivedStreams = 8;

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
        if (!lockup || lockup.contentType !== "LOCKUP_CONTENT_TYPE_VIDEO") return;

        const id = lockup.contentId;
        const title = lockup.metadata?.lockupMetadataViewModel?.title?.content;

        if (!id || !title || seenIds.has(id)) return;

        seenIds.add(id);
        items.push({
            id,
            title,
            url: `https://www.youtube.com/watch?v=${id}`,
            thumbnail: getBestThumbnail(lockup, id),
            duration: getDuration(lockup),
            publishedText: getRelativePublishedText(lockup),
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
    return matchFirst(watchHtml, /"startTimestamp":"([^"]+)"/);
}

function getLiveState(watchHtml) {
    const isLiveNow =
        /"isLiveNow"\s*:\s*true/.test(watchHtml) ||
        /"liveBroadcastContent"\s*:\s*"live"/.test(watchHtml);
    const hasEnded = /"endTimestamp":"[^"]+"/.test(watchHtml);
    const isUpcoming =
        /"isUpcoming"\s*:\s*true/.test(watchHtml) ||
        /"liveBroadcastContent"\s*:\s*"upcoming"/.test(watchHtml);
    const isLiveLike =
        isLiveNow ||
        hasEnded ||
        isUpcoming ||
        /"isLiveBroadcast"\s*:\s*true/.test(watchHtml) ||
        /"isLiveContent"\s*:\s*true/.test(watchHtml) ||
        /"wasLive"\s*:\s*true/.test(watchHtml) ||
        /"liveBroadcastDetails"/.test(watchHtml) ||
        /"actualStartTime"/.test(watchHtml);

    return {
        isLiveLike,
        isLiveNow: isLiveNow && !hasEnded,
        isArchived: hasEnded && !isLiveNow,
        isUpcoming: isUpcoming && !isLiveNow && !hasEnded
    };
}

function buildStreamItem(item, watchHtml, overrides = {}) {
    return {
        ...item,
        ...overrides,
        type: "live",
        typeLabel: overrides.typeLabel ?? "Directo",
        typePriority: 1,
        description:
            overrides.description ??
            "Transmision en vivo archivada del canal oficial de la Iglesia Cristiana Gracia Sobre Gracia.",
        publishedText: overrides.publishedText ?? getWatchPublishText(watchHtml) ?? item.publishedText ?? null,
        publishedAt: getPublishDate(watchHtml) || getLiveStartDate(watchHtml) || item.publishedAt || null
    };
}

async function getActiveLive() {
    const page = await fetchPage(channelLiveUrl);
    const videoId = getVideoIdFromUrl(page.finalUrl) || getCanonicalVideoId(page.html);

    if (!videoId) return null;

    const liveState = getLiveState(page.html);
    if (!liveState.isLiveNow) return null;

    const title =
        matchFirst(page.html, /<meta name="title" content="([^"]+)"/) ||
        matchFirst(page.html, /"title":"([^"]+)"/) ||
        "Transmision en vivo";

    return buildStreamItem(
        {
            id: videoId,
            title,
            url: `https://www.youtube.com/watch?v=${videoId}`,
            thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            duration: null,
            publishedText: "En vivo ahora",
            originalIndex: -1
        },
        page.html,
        {
            status: "live",
            typeLabel: "EN VIVO AHORA",
            description: "Estamos transmitiendo nuestro servicio en este momento."
        }
    );
}

async function enrichArchivedStreams(items) {
    const archivedItems = [];

    for (const item of items) {
        const watchHtml = await fetchText(item.url);
        const liveState = getLiveState(watchHtml);

        if (liveState.isLiveNow || liveState.isUpcoming) {
            continue;
        }

        archivedItems.push(
            buildStreamItem(item, watchHtml, {
                status: "archived",
                verificationSource: liveState.isLiveLike ? "watch-live-metadata" : "youtube-streams-tab"
            })
        );
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
    const streamsHtml = await fetchText(channelStreamsUrl);
    const initialData = parseInitialData(streamsHtml);
    const channelId = getChannelId(streamsHtml);
    const activeLive = await getActiveLive();
    const streamCandidates = getStreamItems(initialData);
    const archivedItems = sortByPublicationDate(await enrichArchivedStreams(streamCandidates))
        .filter((item) => item.id !== activeLive?.id)
        .slice(0, maxArchivedStreams);

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
            checkedAt: new Date().toISOString()
        },
        activeLive,
        items: archivedItems
    };

    await mkdir(outputDirectory, { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(`Transmisiones actualizadas en ${outputPath}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
