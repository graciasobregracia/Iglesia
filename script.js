document.addEventListener("DOMContentLoaded", () => {
    const YOUTUBE_CHANNEL_URL = "https://www.youtube.com/@icgraciasobregracia";
    const modal = document.getElementById("modalEventos");
    const btnEventos = document.getElementById("btnEventos");
    const openEventosButtons = document.querySelectorAll("[data-open-eventos]");
    const closeModalBtn = document.querySelector(".close");
    const modalContent = document.querySelector(".modal-content");
    const flechas = modalContent?.querySelector(".flechas");
    const prev = document.getElementById("prev");
    const next = document.getElementById("next");
    const modalImage = document.getElementById("imagenEventoModal");
    const serviceCards = Array.from(document.querySelectorAll(".service-card"));
    const revealElements = document.querySelectorAll(".reveal, .reveal-left, .reveal-right");
    const copyEmailButtons = document.querySelectorAll("[data-copy-email]");
    const disabledLinks = document.querySelectorAll(".contact-cta-disabled");
    const announcer = document.getElementById("announcer");
    const versiculo = document.querySelector(".versiculo");
    const versiculoReferencia = versiculo?.querySelector("span");

    let eventos = [];
    let indice = 0;
    let lastFocusedElement = null;

    const horariosYouTube = {
        6: { inicio: "19:00", fin: "21:00" },
        3: { inicio: "19:00", fin: "20:30" }
    };

    const versiculosCongregacion = [
        {
            texto: "Aunque ande en valle de sombra de muerte, no temeré mal alguno, porque tú estarás conmigo; tu vara y tu cayado me infundirán aliento",
            referencia: "Salmo 23:4"
        }
        //{//
            //texto: "Y perseveraban en la doctrina de los ap&oacute;stoles, en la comuni&oacute;n unos con otros, en el partimiento del pan y en las oraciones.",//
            //referencia: "Hechos 2:42"//
        //},//
        //{//
           // texto: "Mirad cu&aacute;n bueno y cu&aacute;n delicioso es habitar los hermanos juntos en armon&iacute;a.",//
            //referencia: "Salmo 133:1"//
        //},//
        //{//
           // texto: "Y consider&eacute;monos unos a otros para estimularnos al amor y a las buenas obras; no dejando de congregarnos, como algunos tienen por costumbre.",//
           // referencia: "Hebreos 10:24-25"//
        //},//
        //{//
            //texto: "Sol&iacute;citos en guardar la unidad del Esp&iacute;ritu en el v&iacute;nculo de la paz.",//
           // referencia: "Efesios 4:3"//
       // },//
        //{//
           // texto: "Por tanto, recib&iacute;os los unos a los otros, como tambi&eacute;n Cristo nos recibi&oacute;, para gloria de Dios.",//
            //referencia: "Romanos 15:7"//
        //}//
    ];

    function actualizarVersiculo() {
        if (!versiculo || !versiculoReferencia) return;

        const versiculoAleatorio =
            versiculosCongregacion[Math.floor(Math.random() * versiculosCongregacion.length)];

        versiculo.innerHTML = `&ldquo;${versiculoAleatorio.texto}&rdquo;<span>${versiculoAleatorio.referencia}</span>`;
    }

    function abrirModal() {
        if (!modal) return;
        lastFocusedElement = document.activeElement;
        modal.style.display = "flex";
        modal.setAttribute("aria-hidden", "false");
        btnEventos?.setAttribute("aria-expanded", "true");
        document.body.style.overflow = "hidden";
        closeModalBtn?.focus();
    }

    function cerrarModal() {
        if (!modal) return;
        modal.style.display = "none";
        modal.setAttribute("aria-hidden", "true");
        btnEventos?.setAttribute("aria-expanded", "false");
        document.body.style.overflow = "";
        if (lastFocusedElement instanceof HTMLElement) {
            lastFocusedElement.focus();
        }
    }

    if (btnEventos) {
        btnEventos.addEventListener("click", (event) => {
            event.preventDefault();
            abrirModal();
        });
    }

    openEventosButtons.forEach((button) => {
        button.addEventListener("click", (event) => {
            event.preventDefault();
            abrirModal();
        });
    });

    closeModalBtn?.addEventListener("click", cerrarModal);

    modal?.addEventListener("click", (event) => {
        if (event.target === modal) {
            cerrarModal();
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && modal?.style.display === "flex") {
            cerrarModal();
            return;
        }

        if (event.key !== "Tab" || modal?.style.display !== "flex") return;

        const focusableElements = modal.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );

        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (event.shiftKey && document.activeElement === firstElement) {
            event.preventDefault();
            lastElement.focus();
        } else if (!event.shiftKey && document.activeElement === lastElement) {
            event.preventDefault();
            firstElement.focus();
        }
    });

    function construirUrlImagen(linkImagen) {
        if (!linkImagen) return null;

        const linkLimpio = String(linkImagen).trim();
        if (/^https?:\/\//i.test(linkLimpio) && !linkLimpio.includes("drive.google.com")) {
            return linkLimpio;
        }

        const patronDrive = linkLimpio.match(/\/d\/([^/]+)/);
        if (patronDrive?.[1]) {
            return `https://lh3.googleusercontent.com/d/${patronDrive[1]}`;
        }

        const patronId = linkLimpio.match(/[?&]id=([^&]+)/);
        if (patronId?.[1]) {
            return `https://lh3.googleusercontent.com/d/${patronId[1]}`;
        }

        return null;
    }

    function crearMensajeEventos(texto) {
        const mensaje = document.createElement("div");
        mensaje.className = "evento activo";
        mensaje.innerHTML = `
            <p class="mensaje-eventos">
                <strong>${texto}</strong>
            </p>
        `;
        return mensaje;
    }

    function actualizarVisibilidadFlechas() {
        if (!flechas) return;
        flechas.style.display = eventos.length > 1 ? "flex" : "none";
    }

    function mostrarEvento(index) {
        eventos.forEach((evento, posicion) => {
            evento.classList.toggle("activo", posicion === index);
        });
    }

    function iniciarSlider() {
        eventos = Array.from(document.querySelectorAll(".evento"));
        indice = 0;

        if (!eventos.length) {
            actualizarVisibilidadFlechas();
            return;
        }

        mostrarEvento(indice);
        actualizarVisibilidadFlechas();
    }

    prev?.addEventListener("click", (event) => {
        event.stopPropagation();
        if (eventos.length < 2) return;

        indice = (indice - 1 + eventos.length) % eventos.length;
        mostrarEvento(indice);
    });

    next?.addEventListener("click", (event) => {
        event.stopPropagation();
        if (eventos.length < 2) return;

        indice = (indice + 1) % eventos.length;
        mostrarEvento(indice);
    });

    async function cargarEventos() {
        if (!modalContent || !flechas) return;

        try {
            const response = await fetch(
                "https://opensheet.elk.sh/1TfP9dNPo8P_-r0EsPVXxNlcWao0whLU5VeGt0GjiXpw/EventosIglesia"
            );

            if (!response.ok) {
                throw new Error(`No se pudieron cargar los eventos (${response.status})`);
            }

            const data = await response.json();
            const eventosExistentes = modalContent.querySelectorAll(".evento");
            eventosExistentes.forEach((evento) => evento.remove());

            let eventosValidos = 0;

            data.forEach((fila) => {
                const imgURL = construirUrlImagen(fila.LINK_IMAGEN);
                if (!imgURL) return;

                const tituloEvento = fila.TITULO || fila.EVENTO || "Evento iglesia";
                const div = document.createElement("div");
                div.className = "evento";
                div.innerHTML = `<img src="${imgURL}" alt="${tituloEvento}" loading="lazy">`;
                modalContent.insertBefore(div, flechas);
                eventosValidos += 1;
            });

            if (eventosValidos === 0) {
                modalContent.insertBefore(
                    crearMensajeEventos("Algo nuevo se acerca<br>en nuestra iglesia"),
                    flechas
                );
            }

            if (modalImage) {
                modalImage.style.display = "none";
                modalImage.removeAttribute("src");
            }

            iniciarSlider();
        } catch (error) {
            console.error("ERROR EVENTOS:", error);

            modalContent.querySelectorAll(".evento").forEach((evento) => evento.remove());
            modalContent.insertBefore(
                crearMensajeEventos("Pronto compartiremos nuevos eventos"),
                flechas
            );

            if (modalImage) {
                modalImage.style.display = "none";
                modalImage.removeAttribute("src");
            }

            iniciarSlider();
        }
    }

    function cambiarEstadoTarjeta(card, estaActiva) {
        card.classList.toggle("is-flipped", estaActiva);
        card.setAttribute("aria-pressed", String(estaActiva));
        card.setAttribute("aria-expanded", String(estaActiva));
    }

    function alternarTarjeta(card) {
        const estaActiva = card.classList.contains("is-flipped");
        cambiarEstadoTarjeta(card, !estaActiva);
    }

    serviceCards.forEach((card) => {
        const infoBtn = card.querySelector(".info-btn");
        const closeBtn = card.querySelector(".close-back");

        card.addEventListener("click", (event) => {
            if (event.target.closest("a, button")) return;
            alternarTarjeta(card);
        });

        card.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            alternarTarjeta(card);
        });

        infoBtn?.addEventListener("click", (event) => {
            event.stopPropagation();
            alternarTarjeta(card);
        });

        closeBtn?.addEventListener("click", (event) => {
            event.stopPropagation();
            cambiarEstadoTarjeta(card, false);
        });
    });

    function obtenerHorarioBogota() {
        const partes = new Intl.DateTimeFormat("en-US", {
            timeZone: "America/Bogota",
            weekday: "short",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
        }).formatToParts(new Date());

        const valores = Object.fromEntries(
            partes
                .filter((parte) => parte.type !== "literal")
                .map((parte) => [parte.type, parte.value])
        );

        const mapaDias = {
            Sun: 0,
            Mon: 1,
            Tue: 2,
            Wed: 3,
            Thu: 4,
            Fri: 5,
            Sat: 6
        };

        return {
            dia: mapaDias[valores.weekday],
            minutosActuales: Number(valores.hour) * 60 + Number(valores.minute)
        };
    }

    function convertirHoraAMinutos(hora) {
        const [horaTexto, minutoTexto] = hora.split(":");
        return Number(horaTexto) * 60 + Number(minutoTexto);
    }

    function obtenerEstadoProgramadoParaTarjeta(card, horarioActual) {
        const botonLive = card.querySelector(".boton-live");
        const diaTarjeta = Number(botonLive?.dataset.dia);
        const horario = horariosYouTube[diaTarjeta];

        if (!horario) {
            return {
                diaTarjeta,
                esHoy: false,
                estaEnFranja: false
            };
        }

        const inicioMin = convertirHoraAMinutos(horario.inicio);
        const finMin = convertirHoraAMinutos(horario.fin);
        const esHoy = diaTarjeta === horarioActual.dia;

        return {
            diaTarjeta,
            esHoy,
            estaEnFranja: esHoy && horarioActual.minutosActuales >= inicioMin && horarioActual.minutosActuales <= finMin
        };
    }

    function aplicarEstadoLiveEnTarjeta(card, estado) {
        const statusText = card.querySelector("[data-live-status]");
        const hintText = card.querySelector("[data-live-hint]");
        const botonLive = card.querySelector(".boton-live");
        const enlaceLive = botonLive?.querySelector("a");
        const infoBtn = card.querySelector(".info-btn");
        const estaEnVivo = estado.tipo === "live";

        if (statusText) {
            statusText.textContent = estado.status;
            statusText.classList.toggle("is-live", estaEnVivo);
            statusText.classList.toggle("is-today", estado.tipo === "today");
        }

        if (hintText) {
            hintText.textContent = estado.hint;
        }

        if (botonLive) {
            botonLive.hidden = !estaEnVivo;
            botonLive.style.display = estaEnVivo ? "block" : "none";
        }

        if (enlaceLive) {
            enlaceLive.href = estado.videoUrl || YOUTUBE_CHANNEL_URL;
            enlaceLive.classList.toggle("youtube-parpadeo", estaEnVivo);
        }

        card.classList.toggle("service-card-live", estaEnVivo);
        infoBtn?.classList.toggle("info-btn-live", estaEnVivo);
    }

    function construirEstadoVisualTarjeta(card, horarioActual) {
        const programacion = obtenerEstadoProgramadoParaTarjeta(card, horarioActual);

        if (programacion.estaEnFranja) {
            return {
                tipo: "live",
                status: "Estamos en vivo",
                hint: "Toca la tarjeta para ver el live",
                videoUrl: YOUTUBE_CHANNEL_URL
            };
        }

        if (programacion.esHoy) {
            return {
                tipo: "today",
                status: "Hoy hay culto",
                hint: "Toca la tarjeta para ver los detalles",
                videoUrl: YOUTUBE_CHANNEL_URL
            };
        }

        return {
            tipo: "idle",
            status: "No hay transmisión en este momento",
            hint: "Toca la tarjeta para ver los detalles",
            videoUrl: YOUTUBE_CHANNEL_URL
        };
    }

    function actualizarEstadoLiveTarjetas() {
        const horarioActual = obtenerHorarioBogota();

        serviceCards.forEach((card) => {
            const estadoTarjeta = construirEstadoVisualTarjeta(card, horarioActual);
            aplicarEstadoLiveEnTarjeta(card, estadoTarjeta);
        });
    }

    document.querySelectorAll(".flip-btn").forEach((btn) => {
        btn.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();

            const card = btn.closest(".about-card-flip");
            if (!card) return;

            card.querySelectorAll(".about-card-scroll").forEach((scroll) => {
                scroll.scrollTop = 0;
            });

            card.classList.toggle("is-flipped");
            const expanded = String(card.classList.contains("is-flipped"));
            card.querySelectorAll(".flip-btn").forEach((flipButton) => {
                flipButton.setAttribute("aria-expanded", expanded);
            });
        });
    });

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
                if (announcer) announcer.textContent = "El correo fue copiado al portapapeles.";
            } catch (error) {
                console.error("No se pudo copiar el correo:", error);
                button.textContent = "Copia manualmente";
                if (announcer) announcer.textContent = "No se pudo copiar el correo.";
            }

            window.setTimeout(() => {
                button.textContent = originalText;
            }, 2200);
        });
    });

    disabledLinks.forEach((link) => {
        link.addEventListener("click", (event) => {
            event.preventDefault();
        });
    });

    actualizarVersiculo();

    if ("IntersectionObserver" in window) {
        const revealObserver = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (!entry.isIntersecting) return;
                    entry.target.classList.add("active");
                    revealObserver.unobserve(entry.target);
                });
            },
            { threshold: 0.15 }
        );

        revealElements.forEach((elemento) => revealObserver.observe(elemento));
    } else {
        revealElements.forEach((elemento) => elemento.classList.add("active"));
    }

    cargarEventos();
    actualizarEstadoLiveTarjetas();

    window.setInterval(() => {
        if (document.visibilityState === "hidden") return;
        actualizarEstadoLiveTarjetas();
    }, 180000);

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            actualizarEstadoLiveTarjetas();
        }
    });
});
