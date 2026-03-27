document.addEventListener("DOMContentLoaded", () => {
    const modal = document.getElementById("modalEventos");
    const btnEventos = document.getElementById("btnEventos");
    const closeModalBtn = document.querySelector(".close");
    const modalContent = document.querySelector(".modal-content");
    const flechas = modalContent?.querySelector(".flechas");
    const prev = document.getElementById("prev");
    const next = document.getElementById("next");
    const modalImage = document.getElementById("imagenEventoModal");
    const serviceCards = Array.from(document.querySelectorAll(".service-card"));
    const revealElements = document.querySelectorAll(".reveal, .reveal-left, .reveal-right");
    const aviso = document.getElementById("aviso-servicios");
    const seccionServicios = document.getElementById("Servicios");
    const copyEmailButtons = document.querySelectorAll("[data-copy-email]");

    let eventos = [];
    let indice = 0;
    let avisoOcultoPorInteraccion = false;
    const FORZAR_LIVE_PRUEBA = false;

    const horariosYouTube = {
        0: { inicio: "10:00", fin: "11:50" },
        3: { inicio: "19:00", fin: "20:30" }
    };

    function abrirModal() {
        if (!modal) return;
        modal.style.display = "flex";
        document.body.style.overflow = "hidden";
    }

    function cerrarModal() {
        if (!modal) return;
        modal.style.display = "none";
        document.body.style.overflow = "";
    }

    if (btnEventos) {
        btnEventos.addEventListener("click", (event) => {
            event.preventDefault();
            abrirModal();
        });
    }

    closeModalBtn?.addEventListener("click", cerrarModal);

    modal?.addEventListener("click", (event) => {
        if (event.target === modal) {
            cerrarModal();
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && modal?.style.display === "flex") {
            cerrarModal();
        }
    });

    function construirUrlImagen(linkImagen) {
        if (!linkImagen) return null;

        const patronDrive = linkImagen.match(/\/d\/([^/]+)/);
        if (patronDrive?.[1]) {
            return `https://lh3.googleusercontent.com/d/${patronDrive[1]}`;
        }

        const patronId = linkImagen.match(/[?&]id=([^&]+)/);
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
    }

    function ocultarAvisoServicios() {
        if (!aviso) return;
        aviso.classList.remove("activo");
        avisoOcultoPorInteraccion = true;
    }

    function alternarTarjeta(card) {
        const estaActiva = card.classList.contains("is-flipped");
        cambiarEstadoTarjeta(card, !estaActiva);
        ocultarAvisoServicios();
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

    function hayBotonesLiveVisibles() {
        return Array.from(document.querySelectorAll(".boton-live")).some((boton) => {
            return window.getComputedStyle(boton).display !== "none";
        });
    }

    function actualizarAvisoServicios() {
        if (!aviso) return;

        if (!hayBotonesLiveVisibles() || avisoOcultoPorInteraccion) {
            aviso.classList.remove("activo");
            return;
        }

        const rect = seccionServicios?.getBoundingClientRect();
        if (!rect) return;

        const visible = rect.top < window.innerHeight * 0.65 && rect.bottom > window.innerHeight * 0.35;
        aviso.classList.toggle("activo", visible);
    }

    function actualizarBotonesLive() {
        const { dia, minutosActuales } = obtenerHorarioBogota();

        document.querySelectorAll(".boton-live").forEach((boton) => {
            const diaBoton = Number(boton.dataset.dia);
            const horario = horariosYouTube[diaBoton];
            const card = boton.closest(".service-card");
            const infoBtn = card?.querySelector(".info-btn");

            if (!horario) {
                boton.style.display = "none";
                card?.classList.remove("service-card-live");
                infoBtn?.classList.remove("info-btn-live");
                return;
            }

            const [horaInicio, minutoInicio] = horario.inicio.split(":").map(Number);
            const [horaFin, minutoFin] = horario.fin.split(":").map(Number);

            const inicioMin = horaInicio * 60 + minutoInicio;
            const finMin = horaFin * 60 + minutoFin;
            const estaActivo = FORZAR_LIVE_PRUEBA
                ? true
                : diaBoton === dia && minutosActuales >= inicioMin && minutosActuales <= finMin;

            boton.style.display = estaActivo ? "block" : "none";
            boton.querySelector("a")?.classList.toggle("youtube-parpadeo", estaActivo);
            card?.classList.toggle("service-card-live", estaActivo);
            infoBtn?.classList.toggle("info-btn-live", estaActivo);
        });

        actualizarAvisoServicios();
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
            } catch (error) {
                console.error("No se pudo copiar el correo:", error);
                button.textContent = "Copia manualmente";
            }

            window.setTimeout(() => {
                button.textContent = originalText;
            }, 2200);
        });
    });

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

        if (seccionServicios && aviso) {
            const observerServicios = new IntersectionObserver(
                (entries) => {
                    entries.forEach((entry) => {
                        if (!entry.isIntersecting) {
                            aviso.classList.remove("activo");
                            return;
                        }

                        actualizarAvisoServicios();
                    });
                },
                { threshold: 0.35 }
            );

            observerServicios.observe(seccionServicios);
        }
    } else {
        revealElements.forEach((elemento) => elemento.classList.add("active"));
    }

    window.addEventListener("scroll", actualizarAvisoServicios, { passive: true });
    window.addEventListener("resize", actualizarAvisoServicios);

    cargarEventos();
    actualizarBotonesLive();
    window.setInterval(actualizarBotonesLive, 60000);
});
