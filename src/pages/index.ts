// Portail de test : liens vers les écrans des 6 gares + la grille + la supervision.
import { initBandeau } from './commun';
import { ORDRE_GARES, type GareId } from '../core/types';

initBandeau();

// Noms et altitudes officiels (identiques aux grilles JSON, dupliqués ici pour
// éviter de charger une grille complète sur le portail).
const GARES: Record<GareId, { nom: string; altitude_m: number }> = {
  'le-fayet': { nom: 'Le Fayet', altitude_m: 580 },
  'saint-gervais': { nom: 'Saint-Gervais', altitude_m: 786 },
  motivon: { nom: 'Motivon', altitude_m: 1375 },
  'col-de-voza': { nom: 'Col de Voza', altitude_m: 1653 },
  bellevue: { nom: 'Bellevue', altitude_m: 1794 },
  'nid-daigle': { nom: "Nid d'Aigle", altitude_m: 2412 },
};

const liste = document.getElementById('liste-gares');
if (liste) {
  for (const id of ORDRE_GARES) {
    const gare = GARES[id];
    const li = document.createElement('li');

    const nom = document.createElement('span');
    nom.className = 'nom-gare';
    nom.textContent = gare.nom;

    const altitude = document.createElement('span');
    altitude.className = 'altitude';
    altitude.textContent = `${gare.altitude_m} m`;

    const lienEcran = document.createElement('a');
    lienEcran.href = `ecran.html?gare=${id}`; // relatif : compatible base GitHub Pages
    lienEcran.textContent = 'Écran';

    const lienGrille = document.createElement('a');
    lienGrille.href = `grille.html?gare=${id}`;
    lienGrille.textContent = 'Grille';

    li.append(nom, altitude, lienEcran, lienGrille);
    liste.append(li);
  }
}
