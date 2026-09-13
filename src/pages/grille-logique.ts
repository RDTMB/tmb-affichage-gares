// Grille du jour — décisions PURES, sans DOM, donc testables.
//
// `grille.ts` construit son affichage dès le chargement : Vitest ne peut pas
// l'importer (le dépôt n'a pas de jsdom). Ce qui se décide plutôt que se
// dessine vit donc ici, comme `supervision-logique.ts` pour la supervision.
import type { GareId, PassageTrain } from '../core/types';

/**
 * Ce dont le choix de la colonne éclairée a besoin. Volontairement plus étroit
 * que `ColonneTrain` : la règle ne doit pas pouvoir se mettre à dépendre de
 * l'affichage.
 */
export interface ColonneCandidate {
  /** Le train de la colonne — son numéro sert à départager, ses passages à décider. */
  train: { numero: number; passages: readonly PassageTrain[] };
  /** Retard du train, en secondes. S'ajoute à TOUTES ses heures. */
  decalage: number;
  /** Départ RÉEL depuis l'origine du train (théorique + retard). */
  departReel_s: number;
  supprime: boolean;
  /** Train arrivé à son terminus : la colonne est atténuée. */
  passe: boolean;
}

/**
 * Heure à laquelle ce train part de `gare`, retard compris — ou `null` s'il
 * n'y a rien à y prendre.
 *
 * DEUX ABSENCES, et une seule règle les couvre toutes les deux. Mesuré dans
 * `docs/grilles-historique/2026-ete-grand-service.json` le 13/09/2026 :
 *
 *   • un EXPRESS n'a AUCUN passage au Col de Voza ni à Bellevue — ses passages
 *     sautent de Motivon au Nid d'Aigle. Sur un écran posé à Bellevue, il
 *     n'est pas un prochain train : sa colonne existe, elle affiche « | », et
 *     c'est tout ce qu'elle doit faire ;
 *   • le TERMINUS n'a pas de départ — `{"gare":"nid-daigle","a":"15:05:30"}`,
 *     sans `d`. Une montée ARRIVE au Nid d'Aigle et n'en repart jamais : la
 *     désigner comme « prochain départ » y enverrait le voyageur vers un train
 *     qu'il ne peut pas prendre. C'est la descente qu'il attend.
 *
 * Une gare retirée par une section restreinte tombe dans le premier cas : le
 * train n'y a plus de passage.
 */
export function departLocal_s(colonne: ColonneCandidate, gare: GareId): number | null {
  const passage = colonne.train.passages.find((p) => p.gare === gare);
  if (!passage || passage.depart_s === null) return null;
  return passage.depart_s + colonne.decalage;
}

/**
 * Index de la colonne à ÉCLAIRER, ou -1 s'il n'y en a aucune.
 *
 * LA RÈGLE (décision de l'exploitant du 13/09/2026) : le prochain départ DE LA
 * GARE DE L'ÉCRAN, et non plus de l'origine de la ligne.
 *
 * LE DÉFAUT QU'ELLE RÉPARE, mesuré le 13/09/2026 à 14 h 05 sur
 * `?gare=saint-gervais` : le TRAIN 19 part du Fayet à 14 h 00 et de
 * Saint-Gervais à 14 h 15. La règle d'origine l'écartait — il était déjà parti
 * du Fayet — et éclairait le TRAIN 21, qui ne passe qu'à 15 h 15. Le voyageur
 * de Saint-Gervais avait dix minutes pour prendre le sien, et l'écran lui en
 * désignait un autre, une heure plus tard. Le code était cohérent avec
 * lui-même ; c'est la règle qui était fausse du point de vue de celui qui lit.
 *
 * SANS `?gare=` (supervision, poste de consultation), `gare` vaut `null` et la
 * règle reste celle de l'ORIGINE. Ce n'est pas un reste : hors d'une gare,
 * « d'ici » n'a pas de sens, la grille se lit alors comme l'horaire de toute
 * la ligne, et l'heure d'origine est ce qu'une colonne annonce en tête.
 *
 * CE QUI NE CHANGE PAS, et qui a été vérifié avant de toucher au tri :
 *   • le RETARD compte toujours — on compare des heures RÉELLES, ici celles de
 *     cette gare-ci (`depart_s + decalage`). Un gros retard peut inverser
 *     l'ordre des colonnes, et il doit continuer de le pouvoir ;
 *   • les colonnes SUPPRIMÉES et PASSÉES restent hors du choix.
 *
 * AUCUNE COLONNE quand plus rien ne part d'ici aujourd'hui — fin de service,
 * ou gare que la journée ne dessert plus. En éclairer une par défaut
 * désignerait un train qu'on ne peut pas prendre : ce serait le défaut qu'on
 * répare, sous une autre forme. Le voyageur voit alors le tableau sans
 * surlignage, ses colonnes passées atténuées — et l'écran des départs de la
 * gare, lui, annonce déjà la fin de service.
 */
export function indexProchainDepart(
  colonnes: readonly ColonneCandidate[],
  gare: GareId | null,
  maintenant_s: number,
): number {
  let choisi = -1;
  let meilleure = Number.POSITIVE_INFINITY;
  colonnes.forEach((c, i) => {
    if (c.supprime || c.passe) return;
    const heure = gare === null ? c.departReel_s : departLocal_s(c, gare);
    if (heure === null || heure <= maintenant_s) return;
    // À égalité d'heure, le plus petit numéro : deux colonnes ne doivent
    // jamais s'échanger la lumière d'un rendu à l'autre.
    const tenant = colonnes[choisi]?.train.numero ?? Number.POSITIVE_INFINITY;
    if (heure < meilleure || (heure === meilleure && c.train.numero < tenant)) {
      meilleure = heure;
      choisi = i;
    }
  });
  return choisi;
}
