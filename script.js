// ============ MODAL + SLIDER EVENTOS ============
const modal = document.getElementById("modalEventos");
const btnEventos = document.getElementById("btnEventos");
const closeBtn = document.querySelector(".close");

let eventos = document.querySelectorAll(".evento");
let indice = 0;

// Abrir modal
if (btnEventos) {
    btnEventos.addEventListener("click", function (e) {
        e.preventDefault();
        modal.style.display = "flex";
        eventos.forEach(ev => ev.classList.remove("activo"));
        indice = 0;
        if (eventos[indice]) eventos[indice].classList.add("activo");
    });
}

// Cerrar modal
if (closeBtn) {
    closeBtn.addEventListener("click", function () {
        modal.style.display = "none";
    });
}

// Flechas
const nextBtn = document.getElementById("next");
const prevBtn = document.getElementById("prev");

if (nextBtn) {
    nextBtn.addEventListener("click", () => {
        eventos[indice].classList.remove("activo");
        indice = (indice + 1) % eventos.length;
        eventos[indice].classList.add("activo");
    });
}

if (prevBtn) {
    prevBtn.addEventListener("click", () => {
        eventos[indice].classList.remove("activo");
        indice = (indice - 1 + eventos.length) % eventos.length;
        eventos[indice].classList.add("activo");
    });
}

// Cerrar modal al hacer clic fuera
window.addEventListener("click", function (e) {
    if (e.target === modal) modal.style.display = "none";
});


// ============ ANIMACIÓN DE TARJETAS ============
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
