
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

        // borrar eventos previos si existen
        contenedor.querySelectorAll(".evento").forEach(e => e.remove());

        data.forEach((fila, i) => {


            if (!fila.LINK_IMAGEN) return;

            // extraer ID de Drive
            let id = fila.LINK_IMAGEN.match(/\/d\/([^\/]+)/)[1];

            // convertir a imagen directa
            let imgURL = "https://lh3.googleusercontent.com/d/" + id;

            const div = document.createElement("div");
            div.className = "evento" + (i === 0 ? " activo" : "");
            div.innerHTML = `<img src="${imgURL}" alt="Eventos iglesia">`;

            contenedor.insertBefore(div, contenedor.querySelector(".flechas"));
        });

        iniciarSlider();

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
window.scrollTo({ top: 700, behavior: 'smooth' });

document.querySelectorAll('.flip-btn').forEach(btn => {
    btn.addEventListener('click', e => {
        e.stopPropagation();
        btn.closest('.about-card-flip')
            .classList.toggle('is-flipped');
    });
});
