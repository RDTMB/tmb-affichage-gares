// Logique PURE de la supervision, extraite pour être testable sans DOM :
// aller-retour entre un message et son formulaire (la cible et l'expiration
// doivent survivre à une simple correction de texte) et construction des
// identifiants d'écran.
import type { GareId, Message } from '../core/types';

/** État du formulaire Messages (miroir exact des champs de l'onglet). */
export interface FormulaireMessage {
  texte_fr: string;
  texte_en: string;
  cible_type: Message['cible_type'];
  gares: GareId[];
  train_numero: number | null;
  priorite: Message['priorite'];
  /** « » = jamais, sinon valeur d'un champ datetime-local (heure locale). */
  expire_local: string;
}

/** ISO 8601 → valeur d'un champ datetime-local (« YYYY-MM-DDTHH:MM », heure locale). */
export function isoVersDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Valeur d'un champ datetime-local → ISO 8601, ou null si vide/invalide. */
export function datetimeLocalVersIso(valeur: string): string | null {
  if (!valeur) return null;
  const d = new Date(valeur);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Message existant → état du formulaire : c'est ce qui garantit qu'ouvrir
 * « Modifier » restitue la cible ET l'expiration réelles du message (sans
 * quoi une correction de texte pouvait transformer un message ciblé en
 * message diffusé partout, sans expiration).
 */
export function valeursFormulaireMessage(m: Message): FormulaireMessage {
  return {
    texte_fr: m.texte_fr,
    texte_en: m.texte_en,
    cible_type: m.cible_type,
    gares: [...(m.gares ?? [])],
    train_numero: m.train_numero ?? null,
    priorite: m.priorite,
    expire_local: isoVersDatetimeLocal(m.expire_at),
  };
}

/**
 * État du formulaire → message à enregistrer. Le formulaire est l'UNIQUE
 * source de vérité : ce qui est affiché est ce qui sera enregistré (y
 * compris le retrait d'une expiration ou le changement de cible).
 */
export function messageDepuisFormulaire(f: FormulaireMessage, id: string): Message {
  return {
    id,
    texte_fr: f.texte_fr.trim(),
    texte_en: f.texte_en.trim(),
    cible_type: f.cible_type,
    gares: f.cible_type === 'gares' ? f.gares : null,
    train_numero: f.cible_type === 'train' ? f.train_numero : null,
    priorite: f.priorite,
    actif: true,
    expire_at: datetimeLocalVersIso(f.expire_local),
  };
}

/**
 * Identifiant physique d'un écran : le TYPE de page en fait partie, sinon
 * l'écran des départs et l'écran grille d'une même gare s'écrasent dans
 * « État des écrans » et le bouton « Recharger » vise le mauvais poste.
 */
export function identifiantEcran(
  type: 'ecran' | 'grille',
  gare: string | null,
  parametre: string | null,
): string {
  if (parametre) return parametre; // ?ecran= reste prioritaire
  return `${gare ?? 'sans-gare'}-${type}-1`;
}
