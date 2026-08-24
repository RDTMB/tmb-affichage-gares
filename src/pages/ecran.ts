// Écran de gare — squelette étape 1 : bandeau charte + rappel de la gare demandée.
import { initBandeau, parametreGare } from './commun';

initBandeau();

const gare = parametreGare();
const nomGare = document.getElementById('nom-gare');
const altitude = document.getElementById('altitude-gare');
if (nomGare) {
  nomGare.textContent = gare ?? 'Gare non précisée (?gare=…)';
}
if (altitude && gare) {
  altitude.textContent = 'Altitude — étape 2';
}
