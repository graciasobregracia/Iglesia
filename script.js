
// MODAL EVENTOS

const modal = document.getElementById("modalEventos");
const btnEventos = document.getElementById("btnEventos");
const span = document.querySelector(".close");

btnEventos.onclick = function () {
    modal.style.display = "flex";
};

span.onclick = function () {
    modal.style.display = "none";
};

window.onclick = function (event) {
    if (event.target === modal) {
        modal.style.display = "none";
    }
};


// EVENTOS DESDE GOOGLE SHEETS



fetch("https://opensheet.elk.sh/1TfP9dNPo8P_-r0EsPVXxNlcWao0whLU5VeGt0GjiXpw/EventosIglesia")
    .then(res => res.json())
    .then(data => {

        console.log("EVENTOS DESDE SHEET:", data);

        const contenedor = document.querySelector(".modal-content");

        // borrar eventos previos
        contenedor.querySelectorAll(".evento").forEach(e => e.remove());

        let eventosValidos = 0;

        data.forEach(fila => {

            if (!fila.LINK_IMAGEN) return;

            const match = fila.LINK_IMAGEN.match(/\/d\/([^\/]+)/);
            if (!match) return;

            const id = match[1];
            let imgURL = "https://lh3.googleusercontent.com/d/" + id;


            const div = document.createElement("div");
            div.className = "evento";
            div.innerHTML = `<img src="${imgURL}" alt="Eventos iglesia">`;

            contenedor.insertBefore(div, contenedor.querySelector(".flechas"));
            eventosValidos++;
        });

        // SI NO HAY EVENTOS → MENSAJE AMIGABLE
        if (eventosValidos === 0) {

            const mensaje = document.createElement("div");
            mensaje.className = "evento activo";
            mensaje.innerHTML = `
        <p class="mensaje-eventos">
           <strong>Algo nuevo se acerca<br>
           en nuestra iglesia</strong>
        </p>
    `;

            contenedor.insertBefore(mensaje, contenedor.querySelector(".flechas"));
        }

        iniciarSlider();

        // OCULTAR FLECHAS SI NO SON NECESARIAS
        const flechas = contenedor.querySelector(".flechas");
        if (eventosValidos <= 1 && flechas) {
            flechas.style.display = "none";
        } else if (flechas) {
            flechas.style.display = "flex";
        }

    })
    .catch(err => console.error("ERROR EVENTOS:", err));

// SLIDER EVENTOS 

let eventos = [];
let indice = 0;

function iniciarSlider() {

    eventos = document.querySelectorAll(".evento");
    indice = 0;

    const prev = document.getElementById("prev");
    const next = document.getElementById("next");

    function mostrarEvento(i) {
        eventos.forEach((ev, index) => {
            ev.classList.toggle("activo", index === i);
        });
    }

    if (eventos.length > 0) {
        mostrarEvento(indice);
    }

    prev.onclick = () => {
        indice = (indice - 1 + eventos.length) % eventos.length;
        mostrarEvento(indice);
    };

    next.onclick = () => {
        indice = (indice + 1) % eventos.length;
        mostrarEvento(indice);
    };
}

// ANIMACIÓN DE TARJETAS 
document.querySelectorAll('.service-card').forEach(card => {
    const closeBtn = card.querySelector('.close-back');

    // Girar al hacer clic
    card.addEventListener('click', () => {
        card.classList.toggle('is-flipped');
    });

    // Botón "Volver"
    if (closeBtn) {
        closeBtn.addEventListener('click', e => {
            e.stopPropagation();
            card.classList.remove('is-flipped');
        });
    }
});



// HORARIO DE TRANSMISIONES (INICIO Y FIN)
const horariosYouTube = {
    1: { inicio: "19:00", fin: "20:30" }, // Lunes 7pm - 8:30pm
    3: { inicio: "19:00", fin: "22:30" }, // Miércoles 7pm - 8:30pm
    0: { inicio: "10:00", fin: "11:50" }  // Domingo 10am - 11:50am
};

const ahora = new Date();
const dia = ahora.getDay();
const horaActualMin = ahora.getHours() * 60 + ahora.getMinutes();

const botonesYT = document.querySelectorAll(".boton-live");

botonesYT.forEach(boton => {

    const diaBoton = parseInt(boton.dataset.dia);

    if (!horariosYouTube[diaBoton]) return;

    const inicio = horariosYouTube[diaBoton].inicio;
    const fin = horariosYouTube[diaBoton].fin;

    const [hi, mi] = inicio.split(":").map(Number);
    const [hf, mf] = fin.split(":").map(Number);

    const inicioMin = hi * 60 + mi;
    const finMin = hf * 60 + mf;

    if (diaBoton === dia && horaActualMin >= inicioMin && horaActualMin <= finMin) {
        boton.style.display = "block";
        boton.querySelector("a").classList.add("youtube-parpadeo");
    } else {
        boton.style.display = "none";
    }

});


document.querySelectorAll('.flip-btn').forEach(btn => {
    btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();

        const card = btn.closest('.about-card-flip');
        if (!card) return;

        // Reiniciar scroll SOLO del lado visible
        const activeScroll = card.querySelector(
            card.classList.contains('is-flipped')
                ? '.about-card-front .about-card-scroll'
                : '.about-card-back .about-card-scroll'
        );

        if (activeScroll) {
            activeScroll.scrollTop = 0;
        }

        // Girar tarjeta
        card.classList.toggle('is-flipped');
    }, { passive: false });
});
// ===== SCROLL REVEAL OBSERVER =====
const revealElements = document.querySelectorAll(
    ".reveal, .reveal-left, .reveal-right"
);

const revealObserver = new IntersectionObserver(
    (entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add("active");
                revealObserver.unobserve(entry.target); // solo una vez
            }
        });
    },
    {
        threshold: 0.15
    }
);

revealElements.forEach(el => revealObserver.observe(el));

