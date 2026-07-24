const YOUTUBE_CHANNEL_URL = "https://www.youtube.com/@icgraciasobregracia";
const SERMONS_DATA_PATH = "data/predicaciones.json";
const EVENTS_SOURCE_URL =
    "https://opensheet.elk.sh/1TfP9dNPo8P_-r0EsPVXxNlcWao0whLU5VeGt0GjiXpw/EventosIglesia";

const navLinks = Array.from(document.querySelectorAll('.site-nav a[href^="#"]'));
const sections = Array.from(document.querySelectorAll("main section[id]"));
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
const eventsCarousel = document.querySelector("[data-events-carousel]");
const eventsPrevButton = document.querySelector("[data-events-prev]");
const eventsNextButton = document.querySelector("[data-events-next]");
const galleryImage = document.querySelector("[data-gallery-image]");
const copyEmailButtons = document.querySelectorAll("[data-copy-email]");

let activeModal = null;
let lastFocusedElement = null;
let eventSlides = [];
let currentEventIndex = 0;
let eventsLoaded = false;

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
        timeZone: "America/Bogota"
    }).format(date);
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

function observeSections() {
    if (!("IntersectionObserver" in window)) return;

    const navObserver = new IntersectionObserver(
        (entries) => {
            const visibleEntry = entries
                .filter((entry) => entry.isIntersecting)
                .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];

            if (visibleEntry?.target?.id) {
                setCurrentNavLink(visibleEntry.target.id);
            }
        },
        {
            threshold: [0.3, 0.6],
            rootMargin: "-20% 0px -55% 0px"
        }
    );

    sections.forEach((section) => navObserver.observe(section));
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
        { threshold: 0.15 }
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

    return `
        <article class="sermon-card" data-video-url="${url}" tabindex="0" role="link" aria-label="Abrir ${title} en YouTube">
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
    const published = formatDate(item.publishedAt);
    const url = escapeHtml(item.url || YOUTUBE_CHANNEL_URL);
    const thumbnail = escapeHtml(item.thumbnail);
    const duration = escapeHtml(item.duration || "");
    const publishedText = item.publishedAt ? published : escapeHtml(item.publishedText || "Canal oficial de YouTube");
    const typeLabel = escapeHtml(item.typeLabel || "Directo");

    return `
        <article class="sermons-feature-card reveal is-visible" data-video-url="${url}" tabindex="0" role="link" aria-label="Abrir ${title} en YouTube">
            <div class="sermons-feature-media">
                <img src="${thumbnail}" alt="Miniatura oficial de YouTube para ${title}">
                <span class="sermon-type-badge">${typeLabel}</span>
                ${duration ? `<span class="duration-badge">${duration}</span>` : ""}
                <span class="play-badge play-badge-large" aria-hidden="true">
                    <svg viewBox="0 0 24 24" focusable="false"><path d="m8 6 10 6-10 6V6Z"></path></svg>
                </span>
            </div>
            <div class="sermons-feature-content">
                <p class="eyebrow eyebrow-dark">Transmision destacada</p>
                <div class="sermon-meta">
                    <span>${publishedText}</span>
                    <span>${typeLabel}</span>
                </div>
                <h3><a href="${url}" target="_blank" rel="noopener noreferrer">${title}</a></h3>
                <p>${description}</p>
                <div class="hero-actions">
                    <a class="button button-primary" href="${url}" target="_blank" rel="noopener noreferrer">Ver transmision</a>
                    <a class="button button-secondary" href="${escapeHtml(
                        YOUTUBE_CHANNEL_URL
                    )}" target="_blank" rel="noopener noreferrer">Ir al canal oficial</a>
                </div>
            </div>
        </article>
    `;
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
        const response = await fetch(SERMONS_DATA_PATH, { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`No se pudo cargar ${SERMONS_DATA_PATH}`);
        }

        const data = await response.json();
        const items = Array.isArray(data.items) ? data.items : [];

        const validItems = items.filter((item) => item?.url && item?.thumbnail && item?.title);

        if (!validItems.length) {
            renderSermonsFallback();
            return;
        }

        const [featured, ...rest] = validItems;
        sermonsFeatured.innerHTML = renderFeaturedSermon(featured);
        sermonsTrack.innerHTML = rest.length
            ? rest.map((item) => renderSermonCard(item)).join("")
            : renderSermonCard(featured);

        setupSermonCards();
        updateRailButtons(sermonsTrack, sermonsPrevButton, sermonsNextButton);
    } catch (error) {
        console.error("No se pudieron cargar las transmisiones:", error);
        renderSermonsFallback();
    }
}

function setupSermonCards() {
    document.querySelectorAll("[data-video-url]").forEach((card) => {
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

    const matchByPath = cleanValue.match(/\/d\/([^/]+)/);
    if (matchByPath?.[1]) {
        return `https://lh3.googleusercontent.com/d/${matchByPath[1]}`;
    }

    const matchByQuery = cleanValue.match(/[?&]id=([^&]+)/);
    if (matchByQuery?.[1]) {
        return `https://lh3.googleusercontent.com/d/${matchByQuery[1]}`;
    }

    return null;
}

function renderEventsFallback(message) {
    if (!eventsCarousel) return;

    eventsCarousel.innerHTML = `
        <div class="event-slide event-empty is-active">
            <h3>${escapeHtml(message)}</h3>
            <p>Te invitamos a estar atento a las próximas actividades de la iglesia.</p>
        </div>
    `;

    eventSlides = Array.from(eventsCarousel.querySelectorAll(".event-slide"));
    currentEventIndex = 0;
    updateEventButtons();
}

function showEvent(index) {
    if (!eventSlides.length) return;

    currentEventIndex = index;
    eventSlides.forEach((slide, slideIndex) => {
        slide.classList.toggle("is-active", slideIndex === currentEventIndex);
    });
    updateEventButtons();
}

function updateEventButtons() {
    const isDisabled = eventSlides.length <= 1;
    if (eventsPrevButton) eventsPrevButton.disabled = isDisabled;
    if (eventsNextButton) eventsNextButton.disabled = isDisabled;
}

async function loadEvents() {
    if (eventsLoaded || !eventsCarousel) return;

    try {
        const response = await fetch(EVENTS_SOURCE_URL, { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`No se pudieron cargar los eventos (${response.status})`);
        }

        const rows = await response.json();
        const slidesMarkup = rows
            .map((row) => {
                const imageUrl = buildDriveImageUrl(row.LINK_IMAGEN);
                if (!imageUrl) return "";

                const title = escapeHtml(row.TITULO || row.EVENTO || "Evento de la iglesia");
                return `
                    <article class="event-slide">
                        <img src="${escapeHtml(imageUrl)}" alt="${title}" loading="lazy">
                    </article>
                `;
            })
            .filter(Boolean)
            .join("");

        if (!slidesMarkup) {
            renderEventsFallback("Próximamente compartiremos nuevos eventos y actividades de la iglesia.");
            eventsLoaded = true;
            return;
        }

        eventsCarousel.innerHTML = slidesMarkup;
        eventSlides = Array.from(eventsCarousel.querySelectorAll(".event-slide"));
        showEvent(0);
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
            openModal(eventsModal);
        });
    });

    document.querySelector("[data-close-events]")?.addEventListener("click", () => {
        closeModal(eventsModal);
    });

    eventsPrevButton?.addEventListener("click", () => {
        if (eventSlides.length < 2) return;
        const nextIndex = (currentEventIndex - 1 + eventSlides.length) % eventSlides.length;
        showEvent(nextIndex);
    });

    eventsNextButton?.addEventListener("click", () => {
        if (eventSlides.length < 2) return;
        const nextIndex = (currentEventIndex + 1) % eventSlides.length;
        showEvent(nextIndex);
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
                closeModal(modal);
            }
        });
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && activeModal) {
            if (activeModal === galleryModal) {
                closeGallery();
            } else {
                closeModal(activeModal);
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
    setCurrentNavLink("inicio");
    observeSections();

    window.addEventListener("scroll", () => {
        updateHeaderState();
        updateScrollTopButton();
    });

    menuToggle?.addEventListener("click", () => {
        toggleMenu();
    });

    navLinks.forEach((link) => {
        link.addEventListener("click", () => toggleMenu(false));
    });

    scrollTopButton?.addEventListener("click", () => {
        window.scrollTo({ top: 0, behavior: "smooth" });
    });
}

initializeNavigation();
observeRevealElements();
setupCopyEmailButtons();
setupEvents();
setupGallery();
setupModalDismiss();
setupSermonRail();
loadSermons();
