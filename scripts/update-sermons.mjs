import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const outputDirectory = path.join(projectRoot, "data");
const outputPath = path.join(outputDirectory, "predicaciones.json");
const channelHomeUrl = "https://www.youtube.com/@icgraciasobregracia";
const streamsUrl = `${channelHomeUrl}/streams`;
const maxStreams = 8;

async function fetchText(url) {
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

    return response.text();
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
        throw new Error("No se encontro ytInitialData en la pestaña de transmisiones.");
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

function getPublishDate(watchHtml) {
    return (
        matchFirst(watchHtml, /"publishDate":"([^"]+)"/) ||
        matchFirst(watchHtml, /"datePublished":"([^"]+)"/) ||
        matchFirst(watchHtml, /<meta itemprop="datePublished" content="([^"]+)"/)
    );
}

function hasLiveMetadata(watchHtml) {
    return (
        /"isLiveBroadcast"\s*:\s*true/.test(watchHtml) ||
        /"isLiveContent"\s*:\s*true/.test(watchHtml) ||
        /"wasLive"\s*:\s*true/.test(watchHtml) ||
        /"liveBroadcastDetails"/.test(watchHtml) ||
        /"actualStartTime"/.test(watchHtml)
    );
}

async function enrichAndValidateStreams(items) {
    const validatedItems = [];

    for (const item of items) {
        const watchHtml = await fetchText(item.url);

        if (!hasLiveMetadata(watchHtml)) {
            console.warn(`Descartado por no exponer metadata de live: ${item.id} - ${item.title}`);
            continue;
        }

        validatedItems.push({
            ...item,
            type: "live",
            typeLabel: "Directo",
            typePriority: 1,
            description: "Transmisión en vivo archivada del canal oficial de la Iglesia Cristiana Gracia Sobre Gracia.",
            publishedAt: getPublishDate(watchHtml) || null
        });
    }

    return validatedItems;
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
    const streamsHtml = await fetchText(streamsUrl);
    const initialData = parseInitialData(streamsHtml);
    const channelId = getChannelId(streamsHtml);
    const streamCandidates = getStreamItems(initialData);
    const items = sortByPublicationDate(await enrichAndValidateStreams(streamCandidates)).slice(0, maxStreams);

    if (!items.length) {
        throw new Error("No se encontraron transmisiones en vivo archivadas verificables en el canal.");
    }

    const payload = {
        channel: {
            name: "Iglesia Cristiana Gracia Sobre Gracia",
            url: channelHomeUrl,
            channelId
        },
        updatedAt: new Date().toISOString(),
        source: "youtube-streams-page",
        items
    };

    await mkdir(outputDirectory, { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(`Transmisiones actualizadas en ${outputPath}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
