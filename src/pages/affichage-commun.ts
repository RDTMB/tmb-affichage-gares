// Éléments d'affichage partagés entre l'écran de gare et la grille du jour :
// échappement HTML, pied de page (messages défilants + météo sommet).
import type { GareId, Grille, Message, Params, PassageGare } from '../core/types';

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
 * Bandeau de messages : défilement lent FR • EN (priorité « importante » =
 * bandeau fixe). Reconstruit uniquement quand le contenu change, pour ne pas
 * réinitialiser l'animation CSS à chaque seconde.
 */
export function creeTicker(element: HTMLElement): (visibles: Message[]) => void {
  let derniereSignature: string | null = null;
  return (visibles) => {
    const importantes = visibles.filter((m) => m.priorite === 'importante');
    const affiches = importantes.length > 0 ? importantes : visibles;
    const signature =
      (importantes.length > 0 ? 'fixe' : 'defile') +
      affiches.map((m) => `§${m.id}§${m.texte_fr}§${m.texte_en}`).join('');
    if (signature === derniereSignature) return;
    derniereSignature = signature;
    element.classList.toggle('fixe', importantes.length > 0);
    element.innerHTML = affiches
      .map(
        (m) =>
          `${echapper(m.texte_fr)}<span class="sep">•</span><span class="en">${echapper(m.texte_en)}</span>`,
      )
      .join('<span class="sep">◆</span>');
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
