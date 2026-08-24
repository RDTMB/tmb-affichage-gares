// Grille du jour — squelette étape 1 : bandeau charte uniquement.
import { initBandeau, parametreGare } from './commun';

initBandeau();

const gare = parametreGare();
const nomGare = document.getElementById('nom-gare');
if (nomGare && gare) {
  nomGare.textContent = `Grille du jour — ${gare}`;
}
