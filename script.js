const YOUTUBE_CHANNEL_URL = "https://www.youtube.com/@icgraciasobregracia";
const SERMONS_DATA_PATH = "data/predicaciones.json";
const LIVE_STATUS_DATA_PATH = "data/live-status.json";
const LIVE_STATUS_POLL_INTERVAL = 60000;
const LIVE_NOTICE_VISIBLE_DURATION = 10000;
const LIVE_NOTICE_EXIT_DURATION = 420;
const SITE_TIME_ZONE = "America/Bogota";
const EVENTS_SOURCE_URL =
    "https://opensheet.elk.sh/1TfP9dNPo8P_-r0EsPVXxNlcWao0whLU5VeGt0GjiXpw/EventosIglesia";

const navLinks = Array.from(document.querySelectorAll('.site-nav a[href^="#"]:not(.nav-cta)'));
const menuLinks = Array.from(document.querySelectorAll('.site-nav a[href^="#"]'));
const navSections = navLinks
    .map((link) => {
        const sectionId = decodeURIComponent(link.getAttribute("href")?.slice(1) || "").trim();
        const section = sectionId ? document.getElementById(sectionId) : null;
        return section instanceof HTMLElement ? section : null;
    })
    .filter((section, index, list) => section && list.indexOf(section) === index);
const header = document.querySelector(".site-header");
const menuToggle = document.querySelector(".menu-toggle");
const siteNav = document.querySelector(".site-nav");
const scrollTopButton = document.querySelector("[data-scroll-top]");
const revealElements = document.querySelectorAll(".reveal");
const announcer = document.getElementById("announcer");
const currentYearTarget = document.querySelector("[data-current-year]");
const sermonsFeatured = document.querySelector("[data-sermon-featured]");
const sermonsTrack = document.querySelector("[data-sermons-track]");
const sermonsPrevButton = document.querySelector("[data-sermons-prev]");
const sermonsNextButton = document.querySelector("[data-sermons-next]");
const eventsModal = document.getElementById("modal-eventos");
const galleryModal = document.getElementById("modal-galeria");
const eventsStage = document.querySelector("[data-events-stage]");
const eventsPrevButton = document.querySelector("[data-events-prev]");
const eventsNextButton = document.querySelector("[data-events-next]");
const eventMediaKind = document.querySelector("[data-event-media-kind]");
const eventMediaTitle = document.querySelector("[data-event-media-title]");
const eventCounter = document.querySelector("[data-event-counter]");
const eventDescription = document.querySelector("[data-event-description]");
const eventStatus = document.querySelector("[data-event-status]");
const eventActions = document.querySelector("[data-event-actions]");
const galleryImage = document.querySelector("[data-gallery-image]");
const copyEmailButtons = document.querySelectorAll("[data-copy-email]");

let activeModal = null;
let lastFocusedElement = null;
let eventItems = [];
let currentEventIndex = 0;
let currentMediaIndex = 0;
let eventsLoaded = false;
let liveNoticeSlot = null;
let activeLiveSignature = "";
let dismissedLiveSignature = "";
let liveNoticeHideTimer = null;
let liveNoticeTransitionTimer = null;
let archivedFeaturedSermon = null;
let renderedFeaturedSermonSignature = "";
let navigationFrame = null;

if (currentYearTarget) {
    currentYearTarget.textContent = String(new Date().getFullYear());
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function formatDate(dateString) {
    if (!dateString) return "Canal oficial de YouTube";

    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return "Canal oficial de YouTube";

    return new Intl.DateTimeFormat("es-CO", {
        dateStyle: "long",
        timeZone: SITE_TIME_ZONE
    }).format(date);
}

function formatDateTime(dateString) {
    if (!dateString) return null;

    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return null;

    return new Intl.DateTimeFormat("es-CO", {
        dateStyle: "long",
        timeStyle: "short",
        timeZone: SITE_TIME_ZONE
    }).format(date);
}

function getColombiaDateKey(value) {
    if (!value) return null;

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;

    return new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZone: SITE_TIME_ZONE
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

function isLiveStreamItem(item) {
    if (!item) return false;
    if (item.type === "live" || item.typePriority === 1 || item.isLiveBroadcast === true) return true;

    const label = String(item.typeLabel ?? "").toLowerCase();
    return label.includes("directo") || label.includes("live") || label.includes("en vivo");
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

function selectTodayFeaturedSermon(items, now = new Date()) {
    const todayKey = getColombiaDateKey(now);
    if (!todayKey) return null;

    return [...items]
        .filter((item) => item?.url && item?.thumbnail && item?.title)
        .filter(isLiveStreamItem)
        .filter((item) => getStreamDateKey(item) === todayKey)
        .sort((left, right) => getStreamTime(right) - getStreamTime(left))[0] || null;
}

function updateHeaderState() {
    if (!header) return;

    const isScrolled = window.scrollY > 24;
    header.classList.toggle("is-scrolled", isScrolled);
}

function toggleMenu(forceState) {
    if (!menuToggle || !siteNav) return;

    const nextState =
        typeof forceState === "boolean" ? forceState : menuToggle.getAttribute("aria-expanded") !== "true";

    menuToggle.setAttribute("aria-expanded", String(nextState));
    menuToggle.setAttribute("aria-label", nextState ? "Cerrar navegación" : "Abrir navegación");
    siteNav.classList.toggle("is-open", nextState);
}

function updateScrollTopButton() {
    if (!scrollTopButton) return;

    scrollTopButton.classList.toggle("is-visible", window.scrollY > 500);
}

function setCurrentNavLink(id) {
    navLinks.forEach((link) => {
        const isCurrent = link.getAttribute("href") === `#${id}`;
        if (isCurrent) {
            link.setAttribute("aria-current", "true");
        } else {
            link.removeAttribute("aria-current");
        }
    });
}

function getHeaderOffset() {
    return (header?.offsetHeight || 96) + 18;
}

function syncCurrentNavLink() {
    if (!navSections.length) return;

    const activationPoint = window.scrollY + getHeaderOffset() + Math.min(window.innerHeight * 0.18, 140);
    let activeId = navSections[0].id;

    navSections.forEach((section) => {
        if (activationPoint >= section.offsetTop) {
            activeId = section.id;
        }
    });

    setCurrentNavLink(activeId);
}

function requestNavigationSync() {
    if (navigationFrame !== null) return;

    navigationFrame = window.requestAnimationFrame(() => {
        navigationFrame = null;
        syncCurrentNavLink();
    });
}

function getHashTargetId() {
    return decodeURIComponent(window.location.hash.replace(/^#/, "")).trim();
}

function syncNavFromHash() {
    const hashId = getHashTargetId();
    if (!hashId) return;

    const hasMatchingNavLink = navLinks.some((link) => link.getAttribute("href") === `#${hashId}`);
    if (hasMatchingNavLink) {
        setCurrentNavLink(hashId);
    }
}

function assignRevealDelays() {
    document
        .querySelectorAll(".info-grid, .schedule-grid, .social-grid, .gallery-grid")
        .forEach((group) => {
            Array.from(group.children).forEach((child, index) => {
                if (!child.classList.contains("reveal")) return;
                child.style.setProperty("--reveal-delay", `${Math.min(index * 80, 320)}ms`);
            });
        });
}

function observeRevealElements() {
    if (!("IntersectionObserver" in window)) {
        revealElements.forEach((element) => element.classList.add("is-visible"));
        return;
    }

    const revealObserver = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add("is-visible");
                revealObserver.unobserve(entry.target);
            });
        },
        { threshold: 0.15, rootMargin: "0px 0px -8% 0px" }
    );

    revealElements.forEach((element) => revealObserver.observe(element));
}

function focusFirstElement(container) {
    const focusable = container?.querySelector(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    if (focusable instanceof HTMLElement) {
        focusable.focus();
    }
}

function openModal(modal) {
    if (!modal) return;

    lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    activeModal = modal;
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    focusFirstElement(modal);
}

function closeModal(modal) {
    if (!modal) return;

    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");

    if (activeModal === modal) {
        activeModal = null;
    }

    if (lastFocusedElement instanceof HTMLElement) {
        lastFocusedElement.focus();
    }
}

function trapModalFocus(event) {
    if (!activeModal || event.key !== "Tab") return;

    const focusableElements = Array.from(
        activeModal.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
    ).filter((element) => !element.hasAttribute("disabled"));

    if (!focusableElements.length) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
    }
}

function updateRailButtons(track, prevButton, nextButton) {
    if (!track || !prevButton || !nextButton) return;

    const maxScrollLeft = Math.max(track.scrollWidth - track.clientWidth, 0);
    prevButton.disabled = track.scrollLeft <= 8;
    nextButton.disabled = track.scrollLeft >= maxScrollLeft - 8;
}

function scrollTrack(track, direction) {
    if (!track) return;

    const card = track.firstElementChild;
    const gap = 16;
    const scrollAmount = card instanceof HTMLElement ? card.offsetWidth + gap : track.clientWidth * 0.85;

    track.scrollBy({
        left: scrollAmount * direction,
        behavior: "smooth"
    });
}

function renderSermonCard(item) {
    const title = escapeHtml(item.title || "Transmision reciente");
    const description = escapeHtml(
        item.description || "Accede a la transmision completa desde el canal oficial de la iglesia."
    );
    const published = formatDate(item.publishedAt);
    const url = escapeHtml(item.url || YOUTUBE_CHANNEL_URL);
    const thumbnail = escapeHtml(item.thumbnail);
    const duration = escapeHtml(item.duration || "");
    const publishedText = item.publishedAt ? published : escapeHtml(item.publishedText || "Canal oficial de YouTube");
    const typeLabel = escapeHtml(item.typeLabel || "Directo");
    const liveClass = item.status === "live" ? " is-live-now" : "";

    return `
        <article class="sermon-card${liveClass}" data-video-url="${url}" tabindex="0" role="link" aria-label="Abrir ${title} en YouTube">
            <div class="sermon-thumb">
                <img src="${thumbnail}" alt="Miniatura oficial de YouTube para ${title}" loading="lazy">
                <span class="sermon-type-badge">${typeLabel}</span>
                ${duration ? `<span class="duration-badge">${duration}</span>` : ""}
                <span class="play-badge" aria-hidden="true">
                    <svg viewBox="0 0 24 24" focusable="false"><path d="m8 6 10 6-10 6V6Z"></path></svg>
                </span>
            </div>
            <div class="sermon-body">
                <p class="sermon-meta">${escapeHtml(publishedText)}</p>
                <h4><a href="${url}" target="_blank" rel="noopener noreferrer">${title}</a></h4>
                <p>${description}</p>
                <a class="text-link" href="${url}" target="_blank" rel="noopener noreferrer">Ver transmision</a>
            </div>
        </article>
    `;
}

function renderFeaturedSermon(item) {
    const title = escapeHtml(item.title || "Canal oficial de transmisiones");
    const description = escapeHtml(
        item.description ||
            "Transmision en vivo archivada en el canal oficial de la Iglesia Cristiana Gracia Sobre Gracia."
    );
    const liveStartedAt = item.actualStartTime || item.startedAt || item.publishedAt;
    const published = item.status === "live" ? formatDateTime(liveStartedAt) || formatDate(liveStartedAt) : formatDate(item.publishedAt);
    const url = escapeHtml(item.url || YOUTUBE_CHANNEL_URL);
    const thumbnail = escapeHtml(item.thumbnail);
    const duration = escapeHtml(item.duration || "");
    const publishedText = item.publishedAt ? published : escapeHtml(item.publishedText || "Canal oficial de YouTube");
    const typeLabel = escapeHtml(item.typeLabel || "Directo");
    const isLiveNow = item.status === "live";
    const liveClass = isLiveNow ? " is-live-now" : "";
    const kicker = "Transmision destacada";
    const primaryAction = "Ver transmision";
    const metaText = publishedText;

    return `
        <article class="sermons-feature-card reveal is-visible${liveClass}" data-video-url="${url}" tabindex="0" role="link" aria-label="Abrir ${title} en YouTube">
            <div class="sermons-feature-media">
                <img src="${thumbnail}" alt="Miniatura oficial de YouTube para ${title}">
                <span class="sermon-type-badge">${typeLabel}</span>
                ${duration ? `<span class="duration-badge">${duration}</span>` : ""}
                <span class="play-badge play-badge-large" aria-hidden="true">
                    <svg viewBox="0 0 24 24" focusable="false"><path d="m8 6 10 6-10 6V6Z"></path></svg>
                </span>
            </div>
            <div class="sermons-feature-content">
                <p class="eyebrow eyebrow-dark">${kicker}</p>
                <div class="sermon-meta">
                    <span>${escapeHtml(metaText)}</span>
                    <span>${typeLabel}</span>
                </div>
                <h3><a href="${url}" target="_blank" rel="noopener noreferrer">${title}</a></h3>
                <p>${description}</p>
                <div class="hero-actions">
                    <a class="button button-primary" href="${url}" target="_blank" rel="noopener noreferrer">${primaryAction}</a>
                    <a class="button button-secondary" href="${escapeHtml(
                        YOUTUBE_CHANNEL_URL
                    )}" target="_blank" rel="noopener noreferrer">Ir al canal oficial</a>
                </div>
            </div>
        </article>
    `;
}

function ensureLiveNoticeSlot() {
    if (liveNoticeSlot) return liveNoticeSlot;

    liveNoticeSlot = document.createElement("aside");
    liveNoticeSlot.className = "live-notice";
    liveNoticeSlot.setAttribute("data-live-notice", "");
    liveNoticeSlot.setAttribute("role", "status");
    liveNoticeSlot.setAttribute("aria-live", "polite");
    liveNoticeSlot.hidden = true;

    if (header?.parentElement) {
        header.insertAdjacentElement("afterend", liveNoticeSlot);
    } else {
        document.body.prepend(liveNoticeSlot);
    }

    return liveNoticeSlot;
}

function getActiveLiveFromStatus(data) {
    if (data?.status?.isLiveNow !== true) return null;
    if (!data.activeLive) return null;

    return {
        ...data.activeLive,
        url: data.activeLive.url || data.channel?.url || YOUTUBE_CHANNEL_URL,
        status: "live",
        typeLabel: data.activeLive.typeLabel || "🔴 EN VIVO AHORA",
        description: data.activeLive.description || "Estamos transmitiendo nuestro servicio en este momento."
    };
}

function updateFeaturedSermon(item) {
    if (!sermonsFeatured || !item) return;

    const signature = [item.id, item.url, item.title, item.thumbnail, item.publishedAt, item.status].join("|");
    if (signature === renderedFeaturedSermonSignature) return;

    renderedFeaturedSermonSignature = signature;
    sermonsFeatured.innerHTML = renderFeaturedSermon(item);
    setupSermonCards(sermonsFeatured);
}

function getFeaturedLiveFromStatus(data) {
    const activeLive = data?.activeLive;
    if (data?.status?.isLiveNow !== true || !activeLive || !activeLive.id || !activeLive.title || !activeLive.thumbnail || !activeLive.url) {
        return null;
    }

    try {
        const videoUrl = new URL(activeLive.url);
        if (!["youtube.com", "www.youtube.com", "m.youtube.com"].includes(videoUrl.hostname)) return null;
        if (videoUrl.pathname !== "/watch" || videoUrl.searchParams.get("v") !== activeLive.id) return null;
    } catch {
        return null;
    }

    return {
        ...activeLive,
        status: "live",
        typeLabel: activeLive.typeLabel || "🔴 EN VIVO AHORA",
        description: activeLive.description || "Estamos transmitiendo en vivo ahora mismo.",
        publishedAt: activeLive.actualStartTime || activeLive.startedAt || activeLive.publishedAt || null
    };
}

function getLiveSignature(activeLive) {
    return `${activeLive.id || activeLive.url}:${activeLive.startedAt || activeLive.publishedAt || ""}`;
}

function clearLiveNoticeTimers() {
    if (liveNoticeHideTimer) {
        window.clearTimeout(liveNoticeHideTimer);
        liveNoticeHideTimer = null;
    }

    if (liveNoticeTransitionTimer) {
        window.clearTimeout(liveNoticeTransitionTimer);
        liveNoticeTransitionTimer = null;
    }
}

function hideLiveNotice({ remember = true, immediate = false } = {}) {
    const slot = liveNoticeSlot;
    if (!slot) return;

    clearLiveNoticeTimers();

    if (remember && activeLiveSignature) {
        dismissedLiveSignature = activeLiveSignature;
    }

    const finishHide = () => {
        slot.hidden = true;
        slot.classList.remove("is-visible", "is-hiding");
        slot.innerHTML = "";
    };

    if (immediate) {
        finishHide();
        return;
    }

    slot.classList.remove("is-visible");
    slot.classList.add("is-hiding");
    liveNoticeTransitionTimer = window.setTimeout(finishHide, LIVE_NOTICE_EXIT_DURATION);
}

function renderLiveStatus(activeLive) {
    const slot = ensureLiveNoticeSlot();
    if (!slot) return;

    if (!activeLive) {
        activeLiveSignature = "";
        dismissedLiveSignature = "";
        hideLiveNotice({ remember: false, immediate: true });
        return;
    }

    const nextSignature = getLiveSignature(activeLive);
    if (nextSignature === dismissedLiveSignature) return;
    if (nextSignature === activeLiveSignature && !slot.hidden) return;

    activeLiveSignature = nextSignature;
    clearLiveNoticeTimers();
    slot.hidden = false;
    slot.classList.remove("is-visible", "is-hiding");
    slot.innerHTML = `
        <div class="container live-notice-inner">
            <div class="live-notice-copy">
                <span class="live-dot" aria-hidden="true"></span>
                <div>
                    <p class="live-notice-kicker">ESTAMOS EN VIVO AHORA MISMO</p>
                    <h2>${escapeHtml(activeLive.title || "Transmisión en vivo")}</h2>
                    <p>Acompáñanos en nuestra transmisión actual.</p>
                </div>
            </div>
            <div class="live-notice-actions">
                <a class="button button-primary" href="${escapeHtml(
                    activeLive.url
                )}" target="_blank" rel="noopener noreferrer" aria-label="Ver transmisión en vivo ahora mismo">
                    Ver transmisión
                </a>
                <button class="live-notice-close" type="button" data-close-live-notice aria-label="Cerrar aviso de transmisión en vivo">
                    &times;
                </button>
            </div>
        </div>
    `;

    slot.querySelector("[data-close-live-notice]")?.addEventListener("click", () => {
        hideLiveNotice({ remember: true });
    });

    window.requestAnimationFrame(() => {
        slot.classList.add("is-visible");
    });

    liveNoticeHideTimer = window.setTimeout(() => {
        hideLiveNotice({ remember: true });
    }, LIVE_NOTICE_VISIBLE_DURATION);
}

async function refreshLiveStatus() {
    try {
        const response = await fetch(`${LIVE_STATUS_DATA_PATH}?updated=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) return;

        const data = await response.json();
        renderLiveStatus(getActiveLiveFromStatus(data));

        const activeLive = getFeaturedLiveFromStatus(data);
        const featured = activeLive || archivedFeaturedSermon;
        updateFeaturedSermon(featured);
    } catch (error) {
        return;
    }
}

function renderSermonsFallback() {
    if (!sermonsFeatured || !sermonsTrack) return;

    sermonsFeatured.innerHTML = `
        <article class="sermons-fallback reveal is-visible">
            <div class="sermons-feature-content">
                <p class="eyebrow eyebrow-dark">Canal oficial</p>
                <div class="sermon-meta">
                    <span>Transmisiones oficiales de YouTube</span>
                </div>
                <h3>No se pudieron cargar las transmisiones recientes en este momento.</h3>
                <p>
                    Puedes entrar directamente al canal oficial mientras se actualiza el archivo estatico de transmisiones.
                </p>
                <div class="hero-actions">
                    <a class="button button-primary" href="${YOUTUBE_CHANNEL_URL}" target="_blank" rel="noopener noreferrer">Ir al canal oficial</a>
                </div>
            </div>
        </article>
    `;

    sermonsTrack.innerHTML = "";

    updateRailButtons(sermonsTrack, sermonsPrevButton, sermonsNextButton);
}

async function loadSermons() {
    if (!sermonsFeatured || !sermonsTrack) return;

    try {
        const response = await fetch(`${SERMONS_DATA_PATH}?updated=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`No se pudo cargar ${SERMONS_DATA_PATH}`);
        }

        const data = await response.json();
        const items = Array.isArray(data.items) ? data.items : [];
        const validItems = items.filter((item) => item?.url && item?.thumbnail && item?.title);
        let liveStatus = null;
        try {
            const liveResponse = await fetch(`${LIVE_STATUS_DATA_PATH}?updated=${Date.now()}`, { cache: "no-store" });
            if (liveResponse.ok) {
                liveStatus = await liveResponse.json();
            } else {
                console.warn(`No se pudo cargar ${LIVE_STATUS_DATA_PATH} (${liveResponse.status}); se usará la transmisión archivada.`);
            }
        } catch (error) {
            console.warn(`No se pudo cargar ${LIVE_STATUS_DATA_PATH}; se usará la transmisión archivada.`, error);
        }

        const activeLive = getFeaturedLiveFromStatus(liveStatus);
        const featuredFromPayload =
            data.featuredLiveToday?.url && data.featuredLiveToday?.thumbnail && data.featuredLiveToday?.title
                ? data.featuredLiveToday
                : null;
        archivedFeaturedSermon =
            selectTodayFeaturedSermon([featuredFromPayload, ...validItems].filter(Boolean)) || validItems[0] || null;
        const featured = activeLive || archivedFeaturedSermon;

        if (!featured) {
            renderSermonsFallback();
            return;
        }

        updateFeaturedSermon(featured);
        sermonsTrack.innerHTML = validItems.length
            ? validItems.map((item) => renderSermonCard(item)).join("")
            : activeLive
              ? ""
              : renderSermonCard(featured);

        setupSermonCards();
        updateRailButtons(sermonsTrack, sermonsPrevButton, sermonsNextButton);
    } catch (error) {
        console.error("No se pudieron cargar las transmisiones:", error);
        renderSermonsFallback();
    }
}

function setupSermonCards(scope = document) {
    scope.querySelectorAll("[data-video-url]").forEach((card) => {
        if (card.dataset.cardBound === "true") return;
        card.dataset.cardBound = "true";

        card.addEventListener("click", (event) => {
            if (event.target.closest("a")) return;

            const videoUrl = card.getAttribute("data-video-url");
            if (videoUrl) {
                window.open(videoUrl, "_blank", "noopener,noreferrer");
            }
        });

        card.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            if (event.target.closest("a")) return;

            event.preventDefault();
            const videoUrl = card.getAttribute("data-video-url");
            if (videoUrl) {
                window.open(videoUrl, "_blank", "noopener,noreferrer");
            }
        });
    });
}

function buildDriveImageUrl(value) {
    if (!value) return null;

    const cleanValue = String(value).trim();
    if (/^https?:\/\//i.test(cleanValue) && !cleanValue.includes("drive.google.com")) {
        return cleanValue;
    }

    const driveFileId = extractDriveFileId(cleanValue);
    return driveFileId ? `https://lh3.googleusercontent.com/d/${driveFileId}` : null;
}

function normalizeSheetKey(value) {
    return String(value ?? "")
        .trim()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .toUpperCase();
}

function normalizeMediaType(value) {
    const cleanValue = String(value ?? "")
        .trim()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();

    if (!cleanValue) return null;
    if (["video", "mp4", "mov", "m4v", "webm", "video/mp4", "video/quicktime"].includes(cleanValue)) {
        return "video";
    }

    if (
        ["imagen", "image", "foto", "fotografia", "fotografia", "jpg", "jpeg", "png", "webp", "gif"].includes(
            cleanValue
        )
    ) {
        return "image";
    }

    return null;
}

function extractDriveFileId(value) {
    if (!value) return null;

    const cleanValue = String(value).trim();
    const matchByPath = cleanValue.match(/\/d\/([^/]+)/i);
    if (matchByPath?.[1]) {
        return matchByPath[1];
    }

    const matchByQuery = cleanValue.match(/[?&]id=([^&]+)/i);
    if (matchByQuery?.[1]) {
        return matchByQuery[1];
    }

    return null;
}

function buildDriveVideoUrl(fileId) {
    return fileId ? `https://drive.google.com/uc?export=download&id=${fileId}` : null;
}

function buildDriveThumbnailUrl(fileId, size = "w1200") {
    return fileId ? `https://drive.google.com/thumbnail?id=${fileId}&sz=${size}` : null;
}

function looksLikeVideoUrl(value) {
    return /\.(mp4|m4v|mov|webm|ogg)(?:[?#].*)?$/i.test(String(value ?? "").trim());
}

function isExternalUrl(value) {
    return /^https?:\/\//i.test(String(value ?? "").trim());
}

function splitSheetUrls(value) {
    return String(value ?? "")
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean);
}

function getSheetValue(row, aliases) {
    const normalizedEntries = Object.entries(row || {}).map(([key, value]) => [normalizeSheetKey(key), value]);

    for (const alias of aliases) {
        const normalizedAlias = normalizeSheetKey(alias);
        const match = normalizedEntries.find(([key, value]) => key === normalizedAlias && String(value ?? "").trim());
        if (match) {
            return String(match[1]).trim();
        }
    }

    return "";
}

function resolveMediaSource(rawUrl, mediaType) {
    const driveFileId = extractDriveFileId(rawUrl);

    if (mediaType === "video") {
        if (driveFileId) {
            const videoUrl = buildDriveVideoUrl(driveFileId);
            return {
                isValid: Boolean(videoUrl),
                embedMode: "video",
                previewUrl: videoUrl,
                thumbnailUrl: buildDriveThumbnailUrl(driveFileId, "w800"),
                note: ""
            };
        }

        if (looksLikeVideoUrl(rawUrl)) {
            return {
                isValid: true,
                embedMode: "video",
                previewUrl: rawUrl,
                thumbnailUrl: null,
                note: ""
            };
        }

        return {
            isValid: false,
            embedMode: "video",
            previewUrl: null,
            thumbnailUrl: null,
            note: "No pudimos reproducir este video en el modal. Revisa que el archivo sea publico y compatible."
        };
    }

    if (driveFileId) {
        const imageUrl = buildDriveImageUrl(rawUrl);
        return {
            isValid: Boolean(imageUrl),
            embedMode: "image",
            previewUrl: imageUrl,
            thumbnailUrl: buildDriveThumbnailUrl(driveFileId, "w800") || imageUrl,
            note: ""
        };
    }

    if (isExternalUrl(rawUrl)) {
        return {
            isValid: true,
            embedMode: "image",
            previewUrl: rawUrl,
            thumbnailUrl: rawUrl,
            note: ""
        };
    }

    return {
        isValid: false,
        embedMode: "image",
        previewUrl: null,
        thumbnailUrl: null,
        note: "No pudimos cargar este archivo multimedia. Revisa que el enlace sea publico y compatible."
    };
}

function getEventTitle(row, index) {
    return getSheetValue(row, ["EVENTO", "TITULO", "NOMBRE_EVENTO", "TITLE", "NOMBRE"]) || "Eventos destacados";
}

function getEventGroupKey(row, title) {
    const explicitId = getSheetValue(row, ["ID_EVENTO", "EVENT_ID", "EVENTO_ID", "ID"]);
    return normalizeSheetKey(explicitId || title || "EVENTOS_DESTACADOS") || "EVENTOS_DESTACADOS";
}

function getEventDescription(row, mediaType) {
    return (
        getSheetValue(row, ["DESCRIPCION", "DESCRIPCION_MEDIA", "DETALLE", "DETALLES", "NOTAS"]) ||
        (mediaType === "video"
            ? "Reproduce este video dentro de la galeria multimedia de la iglesia."
            : "Imagen compartida desde la galeria de eventos de la iglesia.")
    );
}

function normalizeEventMediaItems(row, index) {
    const imageUrl = getSheetValue(row, ["LINK_IMAGEN", "URL_IMAGEN", "IMAGEN", "IMAGE_URL"]);
    const videoUrl = getSheetValue(row, ["LINK_VIDEO", "URL_VIDEO", "VIDEO", "VIDEO_URL"]);
    const genericUrl = getSheetValue(row, ["LINK_MEDIA", "URL_MEDIA", "ENLACE", "LINK", "URL", "LINK_DRIVE"]);
    const explicitType = normalizeMediaType(
        getSheetValue(row, ["TIPO", "TIPO_MEDIA", "TIPO_ARCHIVO", "MEDIA_TYPE", "FORMATO"])
    );
    const title = getEventTitle(row, index);
    const alt = getSheetValue(row, ["ALT", "TEXTO_ALT", "DESCRIPCION_ALT"]);
    const mediaRows = [];

    splitSheetUrls(imageUrl).forEach((rawUrl, mediaIndex) => {
        mediaRows.push({ rawUrl, type: "image", mediaIndex });
    });

    splitSheetUrls(videoUrl).forEach((rawUrl, mediaIndex) => {
        mediaRows.push({ rawUrl, type: "video", mediaIndex });
    });

    splitSheetUrls(genericUrl).forEach((rawUrl, mediaIndex) => {
        const hasSpecificUrl = rawUrl === imageUrl || rawUrl === videoUrl;
        if (hasSpecificUrl) return;

        mediaRows.push({
            rawUrl,
            type: explicitType || (looksLikeVideoUrl(rawUrl) ? "video" : "image"),
            mediaIndex
        });
    });

    return mediaRows.map(({ rawUrl, type, mediaIndex }) => {
        const mediaSource = resolveMediaSource(rawUrl, type);

        return {
            id: `${getEventGroupKey(row, title)}-${index}-${mediaIndex}`,
            type,
            typeLabel: type === "video" ? "Video" : "Imagen",
            title,
            description: getEventDescription(row, type),
            alt: alt || `${type === "video" ? "Video" : "Imagen"} de ${title}`,
            rawUrl,
            ...mediaSource
        };
    });
}

function getMediaIcon(type) {
    return type === "video"
        ? `<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="m8 6 10 6-10 6V6Z"></path></svg>`
        : `<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><rect x="4" y="6" width="16" height="12" rx="2"></rect><circle cx="9" cy="11" r="1.4"></circle><path d="m20 15-4.2-4.2L9 17"></path></svg>`;
}

function getEventMediaSummary(media = []) {
    const hasImages = media.some((item) => item.type === "image");
    const hasVideos = media.some((item) => item.type === "video");

    if (hasImages && hasVideos) {
        return { type: "mixed", label: "Multimedia" };
    }

    if (hasVideos) {
        return { type: "video", label: "Video" };
    }

    if (hasImages) {
        return { type: "image", label: "Imagen" };
    }

    return { type: "empty", label: "Sin multimedia" };
}

function getEventMediaResourceKey(item) {
    const driveFileId = extractDriveFileId(item?.rawUrl);
    if (driveFileId) return `drive:${driveFileId}`;

    return String(item?.rawUrl || "")
        .trim()
        .replace(/#.*/, "");
}

function buildEventGroups(rows) {
    const groups = new Map();

    rows.forEach((row, index) => {
        const title = getEventTitle(row, index);
        const groupKey = getEventGroupKey(row, title || index);
        const media = normalizeEventMediaItems(row, index);

        if (!groups.has(groupKey)) {
            groups.set(groupKey, {
                id: groupKey,
                title,
                description:
                    getSheetValue(row, ["DESCRIPCION", "DESCRIPCION_MEDIA", "DETALLE", "DETALLES", "NOTAS"]) ||
                    "Galeria multimedia de eventos de la iglesia.",
                media: []
            });
        }

        const group = groups.get(groupKey);
        group.media.push(...media);
    });

    return Array.from(groups.values())
        .map((group) => {
            const seenMedia = new Set();
            const media = group.media.filter((item) => {
                const resourceKey = getEventMediaResourceKey(item);
                if (!resourceKey || seenMedia.has(resourceKey)) return false;

                seenMedia.add(resourceKey);
                return true;
            });
            const summary = getEventMediaSummary(media);
            const thumbnailMedia = media.find((item) => item.thumbnailUrl || item.previewUrl);

            return {
                ...group,
                media,
                type: summary.type,
                typeLabel: summary.label,
                thumbnailUrl: thumbnailMedia?.thumbnailUrl || thumbnailMedia?.previewUrl || null
            };
        })
        .filter((group) => group.media.length > 0);
}

function resetEventStage() {
    if (!eventsStage) return;

    const inlineVideo = eventsStage.querySelector("video");
    if (inlineVideo instanceof HTMLVideoElement) {
        inlineVideo.pause();
        inlineVideo.removeAttribute("src");
        inlineVideo.load();
    }

    const iframe = eventsStage.querySelector("iframe");
    if (iframe instanceof HTMLIFrameElement) {
        iframe.src = "about:blank";
    }

    eventsStage.innerHTML = "";
}

function setEventStatus(message = "") {
    if (!eventStatus) return;

    eventStatus.hidden = !message;
    eventStatus.textContent = message;
}

function renderEventsFallback(message) {
    resetEventStage();
    eventItems = [];
    currentEventIndex = 0;
    currentMediaIndex = 0;

    if (eventsStage) {
        eventsStage.innerHTML = `
            <article class="event-stage-card event-stage-card-empty">
                <div class="event-placeholder">
                    <span class="event-placeholder-icon" aria-hidden="true">${getMediaIcon("image")}</span>
                    <h3>${escapeHtml(message)}</h3>
                    <p>Te invitamos a estar atento a las próximas actividades de la iglesia.</p>
                </div>
            </article>
        `;
    }

    if (eventMediaKind) {
        eventMediaKind.textContent = "Multimedia";
        eventMediaKind.dataset.kind = "image";
    }

    if (eventMediaTitle) {
        eventMediaTitle.textContent = "Eventos destacados";
    }

    if (eventCounter) {
        eventCounter.textContent = "";
    }

    if (eventDescription) {
        eventDescription.textContent =
            "Entérate de nuestros eventos, novedades y anuncios.";
    }

    if (eventActions) {
        eventActions.innerHTML = "";
    }

    setEventStatus("");
    updateEventButtons();
}

function renderEventUnavailableState(item, message) {
    if (!eventsStage) return;

    eventsStage.innerHTML = `
        <article class="event-stage-card event-stage-card-empty">
            <div class="event-placeholder">
                <span class="event-placeholder-icon" aria-hidden="true">${getMediaIcon(item?.type || "image")}</span>
                <h3>${escapeHtml(item?.title || "Galeria multimedia")}</h3>
                <p>${escapeHtml(message)}</p>
            </div>
        </article>
    `;
}

function updateEventButtons() {
    const eventItem = eventItems[currentEventIndex];
    const mediaCount = eventItem?.media?.length || 0;
    const hasPreviousMedia = currentMediaIndex > 0 || currentEventIndex > 0;
    const hasNextMedia = currentMediaIndex < mediaCount - 1 || currentEventIndex < eventItems.length - 1;

    if (eventsPrevButton) {
        eventsPrevButton.disabled = !hasPreviousMedia;
    }

    if (eventsNextButton) {
        eventsNextButton.disabled = !hasNextMedia;
    }
}

function renderCurrentEvent() {
    if (!eventItems.length || !eventsStage) return;

    const eventItem = eventItems[currentEventIndex];
    const media = eventItem.media || [];
    const item = media[currentMediaIndex] || null;
    resetEventStage();

    if (eventMediaKind) {
        eventMediaKind.textContent = item?.typeLabel || eventItem.typeLabel;
        eventMediaKind.dataset.kind = item?.type || eventItem.type;
    }

    if (eventMediaTitle) {
        eventMediaTitle.textContent = eventItem.title;
    }

    if (eventCounter) {
        const totalMedia = eventItems.reduce((total, event) => total + event.media.length, 0);
        const currentPosition = eventItems
            .slice(0, currentEventIndex)
            .reduce((total, event) => total + event.media.length, 0) + currentMediaIndex + 1;
        eventCounter.textContent = media.length ? `${currentPosition} de ${totalMedia}` : "";
    }

    if (eventDescription) {
        eventDescription.textContent = item?.description || eventItem.description;
    }

    if (eventActions) {
        eventActions.innerHTML = "";
    }

    setEventStatus(item?.note || "");

    if (!item) {
        renderEventUnavailableState(eventItem, "No hay contenido multimedia disponible por el momento.");
        updateEventButtons();
        return;
    }

    if (!item.isValid || !item.previewUrl) {
        renderEventUnavailableState(item, item.note || "No hay contenido multimedia disponible por el momento.");
        updateEventButtons();
        return;
    }

    const mediaMarkup =
        item.embedMode === "video"
              ? `<video src="${escapeHtml(item.previewUrl)}" controls preload="metadata" playsinline aria-label="${escapeHtml(
                    item.alt
                )}"></video>`
              : `<img src="${escapeHtml(item.previewUrl)}" alt="${escapeHtml(item.alt)}" loading="lazy" data-event-stage-image>`;

    eventsStage.innerHTML = `
        <article class="event-stage-card event-stage-card-${escapeHtml(item.type)}">
            ${mediaMarkup}
        </article>
    `;

    const stageImage = eventsStage.querySelector("[data-event-stage-image]");
    if (stageImage instanceof HTMLImageElement) {
        stageImage.addEventListener(
            "error",
            () => {
                const fallbackMessage =
                    "No pudimos mostrar esta imagen en este momento.";
                setEventStatus(fallbackMessage);
                renderEventUnavailableState(item, fallbackMessage);
            },
            { once: true }
        );
    }

    const stageVideo = eventsStage.querySelector("video");
    if (stageVideo instanceof HTMLVideoElement) {
        stageVideo.addEventListener(
            "error",
            () => {
                const fallbackMessage = "No pudimos reproducir este video en el modal.";
                setEventStatus(fallbackMessage);
                renderEventUnavailableState(item, fallbackMessage);
            },
            { once: true }
        );
    }

    updateEventButtons();
}

function moveEventMedia(direction) {
    const media = eventItems[currentEventIndex]?.media || [];
    const nextMediaIndex = currentMediaIndex + direction;

    if (nextMediaIndex >= 0 && nextMediaIndex < media.length) {
        currentMediaIndex = nextMediaIndex;
    } else if (direction > 0 && currentEventIndex < eventItems.length - 1) {
        currentEventIndex += 1;
        currentMediaIndex = 0;
    } else if (direction < 0 && currentEventIndex > 0) {
        currentEventIndex -= 1;
        currentMediaIndex = eventItems[currentEventIndex].media.length - 1;
    } else {
        return;
    }

    renderCurrentEvent();
}

async function loadEvents() {
    if (eventsLoaded || !eventsStage) return;

    try {
        const response = await fetch(EVENTS_SOURCE_URL, { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`No se pudieron cargar los eventos (${response.status})`);
        }

        const rows = await response.json();
        eventItems = buildEventGroups(Array.isArray(rows) ? rows : []);

        if (!eventItems.length) {
            renderEventsFallback("Próximamente compartiremos nuevos eventos y actividades de la iglesia.");
            eventsLoaded = true;
            return;
        }

        currentEventIndex = 0;
        currentMediaIndex = 0;
        renderCurrentEvent();
        eventsLoaded = true;
    } catch (error) {
        console.error("No se pudieron cargar los eventos:", error);
        renderEventsFallback("Próximamente compartiremos nuevos eventos y actividades de la iglesia.");
        eventsLoaded = true;
    }
}

function openGallery(imageSrc, imageAlt) {
    if (!galleryModal || !galleryImage) return;

    galleryImage.src = imageSrc;
    galleryImage.alt = imageAlt;
    openModal(galleryModal);
}

function closeGallery() {
    if (!galleryModal || !galleryImage) return;

    closeModal(galleryModal);
    galleryImage.removeAttribute("src");
    galleryImage.removeAttribute("alt");
}

function setupCopyEmailButtons() {
    copyEmailButtons.forEach((button) => {
        button.addEventListener("click", async () => {
            const email = button.getAttribute("data-copy-email");
            if (!email) return;

            const originalText = button.textContent;

            try {
                if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(email);
                } else {
                    const helper = document.createElement("textarea");
                    helper.value = email;
                    helper.setAttribute("readonly", "");
                    helper.style.position = "absolute";
                    helper.style.left = "-9999px";
                    document.body.appendChild(helper);
                    helper.select();
                    document.execCommand("copy");
                    document.body.removeChild(helper);
                }

                button.textContent = "Correo copiado";
                if (announcer) {
                    announcer.textContent = "El correo fue copiado al portapapeles.";
                }
            } catch (error) {
                console.error("No se pudo copiar el correo:", error);
                button.textContent = "Copia manualmente";
                if (announcer) {
                    announcer.textContent = "No se pudo copiar el correo.";
                }
            }

            window.setTimeout(() => {
                button.textContent = originalText;
            }, 2200);
        });
    });
}

function setupEvents() {
    document.querySelectorAll("[data-open-events]").forEach((button) => {
        button.addEventListener("click", async () => {
            await loadEvents();
            if (eventItems.length) {
                renderCurrentEvent();
            }
            openModal(eventsModal);
        });
    });

    document.querySelector("[data-close-events]")?.addEventListener("click", () => {
        closeEventsModal();
    });

    eventsPrevButton?.addEventListener("click", () => {
        moveEventMedia(-1);
    });

    eventsNextButton?.addEventListener("click", () => {
        moveEventMedia(1);
    });
}

function setupGallery() {
    document.querySelectorAll("[data-gallery-trigger]").forEach((trigger) => {
        trigger.addEventListener("click", () => {
            const imageSrc = trigger.getAttribute("data-image-src");
            const imageAlt = trigger.getAttribute("data-image-alt") || "Imagen de la galeria";
            if (!imageSrc) return;

            openGallery(imageSrc, imageAlt);
        });
    });

    document.querySelector("[data-close-gallery]")?.addEventListener("click", closeGallery);
}

function setupModalDismiss() {
    [eventsModal, galleryModal].forEach((modal) => {
        if (!modal) return;

        modal.addEventListener("click", (event) => {
            if (event.target !== modal) return;

            if (modal === galleryModal) {
                closeGallery();
            } else {
                closeEventsModal();
            }
        });
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && activeModal) {
            if (activeModal === galleryModal) {
                closeGallery();
            } else {
                closeEventsModal();
            }
        }

        trapModalFocus(event);
    });
}

function setupSermonRail() {
    sermonsPrevButton?.addEventListener("click", () => scrollTrack(sermonsTrack, -1));
    sermonsNextButton?.addEventListener("click", () => scrollTrack(sermonsTrack, 1));

    sermonsTrack?.addEventListener("scroll", () => {
        updateRailButtons(sermonsTrack, sermonsPrevButton, sermonsNextButton);
    });

    window.addEventListener("resize", () => {
        updateRailButtons(sermonsTrack, sermonsPrevButton, sermonsNextButton);
    });
}

function initializeNavigation() {
    updateHeaderState();
    updateScrollTopButton();
    requestNavigationSync();

    window.addEventListener(
        "scroll",
        () => {
            updateHeaderState();
            updateScrollTopButton();
            requestNavigationSync();
        },
        { passive: true }
    );

    window.addEventListener("resize", () => {
        if (window.innerWidth > 900) {
            toggleMenu(false);
        }

        requestNavigationSync();
    });

    window.addEventListener("hashchange", () => {
        toggleMenu(false);
        syncNavFromHash();
        requestNavigationSync();
    });

    window.addEventListener("load", () => {
        syncNavFromHash();
        requestNavigationSync();
        window.setTimeout(requestNavigationSync, 160);
    });

    menuToggle?.addEventListener("click", () => {
        toggleMenu();
    });

    menuLinks.forEach((link) => {
        link.addEventListener("click", () => {
            const targetId = decodeURIComponent(link.getAttribute("href")?.replace(/^#/, "") || "").trim();
            if (targetId && navLinks.some((navLink) => navLink.getAttribute("href") === `#${targetId}`)) {
                setCurrentNavLink(targetId);
            }

            toggleMenu(false);
            window.setTimeout(requestNavigationSync, 90);
            window.setTimeout(requestNavigationSync, 360);
        });
    });

    scrollTopButton?.addEventListener("click", () => {
        window.scrollTo({ top: 0, behavior: "smooth" });
    });
}

function closeEventsModal() {
    resetEventStage();
    currentMediaIndex = 0;
    closeModal(eventsModal);
}

assignRevealDelays();
initializeNavigation();
observeRevealElements();
setupCopyEmailButtons();
setupEvents();
setupGallery();
setupModalDismiss();
setupSermonRail();
loadSermons();
refreshLiveStatus();
window.setInterval(refreshLiveStatus, LIVE_STATUS_POLL_INTERVAL);
