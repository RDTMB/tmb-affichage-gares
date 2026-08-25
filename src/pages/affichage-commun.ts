// Éléments d'affichage partagés entre l'écran de gare et la grille du jour :
// échappement HTML, pied de page (messages défilants + météo sommet).
import type { GareId, Grille, Message, Params, PassageGare } from '../core/types';
import { dureeDefilementS, vitesseTickerValide } from './ticker';

export function echapper(texte: string): string {
  return texte
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Messages visibles pour une gare (cible toutes / gares / train encore
 * desservi, non expirés à l'heure simulable). `gare` null (grille sans
 * paramètre) : seuls les messages « toutes » s'affichent.
 */
export function messagesVisibles(
  messages: Message[],
  gare: GareId | null,
  passagesRestants: PassageGare[],
  maintenantMs: number,
): Message[] {
  return messages.filter((m) => {
    if (!m.actif) return false;
    if (m.expire_at && new Date(m.expire_at).getTime() < maintenantMs) return false;
    if (m.cible_type === 'gares') return gare !== null && (m.gares ?? []).includes(gare);
    if (m.cible_type === 'train') {
      return gare !== null && passagesRestants.some((p) => p.numero === m.train_numero);
    }
    return true;
  });
}

/**
 * Contenu du bandeau : « FR • EN » quand la traduction existe, français SEUL
 * sinon — pas de séparateur « • » orphelin ni de bloc anglais vide (la
 * traduction indisponible ne doit jamais produire de faux anglais).
 */
export function contenuTicker(affiches: Message[]): string {
  return affiches
    .map((m) => {
      const en = m.texte_en.trim();
      const fr = echapper(m.texte_fr);
      return en ? `${fr}<span class="sep">•</span><span class="en">${echapper(en)}</span>` : fr;
    })
    .join('<span class="sep">◆</span>');
}

/**
 * Bandeau de messages : défilement lent FR • EN (priorité « importante » =
 * bandeau fixe). Reconstruit uniquement quand le contenu change, pour ne pas
 * réinitialiser l'animation CSS à chaque seconde.
 */
export function creeTicker(
  element: HTMLElement,
): (visibles: Message[], vitessePxS?: unknown) => void {
  let derniereSignature: string | null = null;
  let derniereVitesse: number | null = null;
  let fixe = false;

  /** Durée d'animation recalculée d'après la largeur RÉELLE du contenu. */
  const ajusteDuree = (vitesse: number): void => {
    if (fixe) {
      element.style.animationDuration = '';
      return;
    }
    element.style.animationDuration = `${dureeDefilementS(element.offsetWidth, vitesse)}s`;
  };

  // Les polices arrivent après le premier rendu : la largeur change, donc la
  // durée doit être recalculée (sinon la vitesse serait fausse au démarrage).
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      if (derniereVitesse !== null) ajusteDuree(derniereVitesse);
    }).observe(element);
  }

  return (visibles, vitessePxS) => {
    const vitesse = vitesseTickerValide(vitessePxS);
    const importantes = visibles.filter((m) => m.priorite === 'importante');
    const affiches = importantes.length > 0 ? importantes : visibles;
    const signature =
      (importantes.length > 0 ? 'fixe' : 'defile') +
      affiches.map((m) => `§${m.id}§${m.texte_fr}§${m.texte_en}`).join('');

    if (signature !== derniereSignature) {
      derniereSignature = signature;
      fixe = importantes.length > 0;
      element.classList.toggle('fixe', fixe);
      element.innerHTML = contenuTicker(affiches);
      derniereVitesse = vitesse;
      ajusteDuree(vitesse);
      return;
    }
    // Contenu inchangé : la vitesse peut avoir été modifiée en supervision
    // (prise en compte sans rechargement de l'écran).
    if (vitesse !== derniereVitesse) {
      derniereVitesse = vitesse;
      ajusteDuree(vitesse);
    }
  };
}

/** Pavé météo sommet : température + « Nid d'Aigle · 2 412 m » + ciel FR/EN. */
export function meteoHtml(params: Params, grille: Grille): string {
  const meteo = params.meteo_sommet;
  const sommet = grille.gares.find((g) => g.id === 'nid-daigle');
  const lieu = sommet ? `${sommet.nom} · ${sommet.altitude_m.toLocaleString('fr-FR')} m` : '';
  return `<div class="t">${meteo.t}°C</div>
    <div>${echapper(lieu)}<small>${echapper(`${meteo.ciel_fr} / ${meteo.ciel_en}`)}</small></div>`;
}
