// Éléments d'affichage partagés entre l'écran de gare et la grille du jour :
// échappement HTML, pied de page (messages défilants + météo sommet).
import type { GareId, Grille, Message, Params, PassageGare } from '../core/types';
import { dureeDefilementS, vitesseTickerValide } from '../core/ticker';

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
  // L'heure du relevé dit au voyageur si la température date de dix minutes
  // ou de la veille. Discrète : elle ne concurrence pas le chiffre.
  const releve =
    typeof meteo.heure_releve === 'string' && meteo.heure_releve !== ''
      ? `<span class="releve">relevé ${echapper(meteo.heure_releve)}</span>`
      : '';
  // La température vient du jsonb `params.valeur` : le type `number` ne vaut
  // qu'à la compilation. Ceinture ET bretelles — paramsValides() l'a déjà
  // neutralisée, mais la page ne doit jamais redevenir un point d'injection.
  // Test sur `typeof`, PAS sur `Number(...)` : Number(null), Number('') et
  // Number([]) valent tous 0, et afficher « 0 °C » pour une valeur corrompue
  // serait afficher une information FAUSSE. Rien vaut mieux que faux.
  const t =
    typeof meteo.t === 'number' && Number.isFinite(meteo.t) ? String(Math.round(meteo.t)) : '—';
  return `<div class="t">${echapper(t)}°C${releve}</div>
    <div>${echapper(lieu)}<small>${echapper(`${meteo.ciel_fr} / ${meteo.ciel_en}`)}</small></div>`;
}

/**
 * Cadence du signal de vie. Le seuil « hors ligne » de la supervision
 * (SEUIL_HORS_LIGNE_MS) en dérive : il vaut deux cycles et demi, de quoi
 * absorber un cycle manqué sans déclarer un écran mort à tort.
 */
export const INTERVALLE_HEARTBEAT_MS = 60_000;

/**
 * Bornes de `duree_cache_min`, identiques à la contrainte SQL. La surcharge
 * d'URL `?cache=N` n'était bornée NULLE PART : `?cache=99999` repoussait
 * l'écran neutre de plusieurs mois, et le poste affichait des horaires
 * périmés indéfiniment.
 */
export const CACHE_MIN_MINUTES = 3;
export const CACHE_MAX_MINUTES = 60;

/**
 * Durée du cache retenue, en minutes. La surcharge d'URL n'est appliquée que
 * si elle est FINIE et dans les bornes ; sinon on retombe sur le paramètre de
 * base, lui-même borné par la contrainte SQL. PURE et testée : c'est elle qui
 * décide quand l'écran passe en neutre.
 */
export function dureeCacheMinutes(surchargeUrl: string | null, base: number | undefined): number {
  const n = Number(surchargeUrl);
  if (
    surchargeUrl !== null &&
    surchargeUrl.trim() !== '' &&
    Number.isFinite(n) &&
    n >= CACHE_MIN_MINUTES &&
    n <= CACHE_MAX_MINUTES
  ) {
    return n;
  }
  return base ?? 15;
}

/**
 * Promesse bornée dans le temps. La PREMIÈRE synchronisation ne doit jamais
 * pouvoir bloquer indéfiniment : tant qu'elle n'a pas rendu la main, la boucle
 * de rendu n'est pas armée et l'écran reste sur la coquille HTML — tableau
 * VIDE, ce qui se lit en gare comme « plus aucun train aujourd'hui ».
 *
 * L'expiration vaut ÉCHEC de synchronisation, donc écran neutre : jamais un
 * tableau vide. Le minuteur est toujours nettoyé (18 h d'affichage par jour).
 */
export function avecDelai<T>(promesse: Promise<T>, delaiMs: number, siExpire: T): Promise<T> {
  return new Promise<T>((resoud) => {
    const minuteur = window.setTimeout(() => resoud(siExpire), delaiMs);
    void promesse.then(
      (v) => {
        window.clearTimeout(minuteur);
        resoud(v);
      },
      () => {
        window.clearTimeout(minuteur);
        resoud(siExpire);
      },
    );
  });
}

/** Au-delà, la première synchronisation est abandonnée (écran neutre). */
export const DELAI_PREMIERE_SYNCHRO_MS = 10_000;

/**
 * Un signal de vie en échec ne doit JAMAIS interrompre l'affichage
 * voyageurs : on trace UNE fois par cause (un kiosque tourne 18 h par jour,
 * pas question d’inonder la console) et le cycle suivant réessaie.
 */
export function creeJournalHeartbeat(): (erreur: unknown) => void {
  const vues = new Set<string>();
  return (erreur) => {
    const message = erreur instanceof Error ? erreur.message : String(erreur);
    if (vues.has(message)) return;
    vues.add(message);
    console.warn(`[TMB] signal de vie non enregistré, réessai au prochain cycle : ${message}`);
  };
}
