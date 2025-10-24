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
