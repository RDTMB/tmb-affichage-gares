// Lecture du lien reçu par e-mail (invitation, réinitialisation de mot de
// passe) au moment où la supervision s'ouvre. Supabase renvoie la personne
// vers `supervision.html` avec les jetons dans le fragment de l'URL
// (`#access_token=…&type=invite`) ou, si le lien est mort (déjà utilisé,
// expiré, pré-ouvert par un filtre anti-hameçonnage de la messagerie), avec
// `#error=…&error_code=otp_expired`.
//
// Module PUR (pas d'accès au DOM ni à Supabase) : la page lit le fragment
// AVANT de créer le client Supabase, qui l'efface une fois la session ouverte.

export type LienAuth =
  /** Lien d'invitation : le compte existe, mais aucun mot de passe n'a été choisi. */
  | { type: 'invite' }
  /** Lien « mot de passe oublié » envoyé depuis la supervision. */
  | { type: 'recovery' }
  /** Le lien a bien ouvert une session mais sans demande de mot de passe (ex. lien magique). */
  | { type: 'autre' }
  /** Supabase a refusé le lien : message à afficher à la place du formulaire. */
  | { erreur: string }
  /** Ouverture ordinaire de la page, sans lien. */
  | null;

/**
 * Longueur minimale imposée côté interface (Supabase en exige 6 par défaut).
 * DOUZE caractères, comme l'annonce docs/securite.md §4 : le projet est sur
 * l'offre gratuite, qui ne vérifie pas les mots de passe compromis
 * (HaveIBeenPwned) — la longueur est la seule compensation dont on dispose.
 */
export const LONGUEUR_MIN_MOT_DE_PASSE = 12;

function parametres(fragment: string): URLSearchParams {
  return new URLSearchParams(fragment.replace(/^#/, ''));
}

/**
 * Analyse le fragment (`window.location.hash`) et la requête
 * (`window.location.search`) de l'URL d'ouverture.
 */
export function analyseLienAuth(hash: string, search = ''): LienAuth {
  const f = parametres(hash);
  const q = parametres(search.replace(/^\?/, ''));
  const codeErreur = f.get('error_code') ?? q.get('error_code');
  const erreur = f.get('error') ?? q.get('error');
  if (codeErreur || erreur) {
    return {
      erreur: messageErreur(codeErreur, f.get('error_description') ?? q.get('error_description')),
    };
  }
  if (!f.get('access_token')) return null;
  const type = f.get('type');
  if (type === 'invite' || type === 'recovery') return { type };
  return { type: 'autre' };
}

function messageErreur(code: string | null, description: string | null): string {
  if (code === 'otp_expired') {
    return (
      'Ce lien a expiré ou a déjà été utilisé (certaines messageries ouvrent les liens ' +
      'à votre place). Demandez un nouvel envoi à un administrateur, puis ouvrez le ' +
      'lien directement depuis le message.'
    );
  }
  if (code === 'access_denied') {
    return 'Ce lien n’est plus valable. Demandez un nouvel envoi à un administrateur.';
  }
  const detail = description?.replace(/\+/g, ' ').trim();
  return detail
    ? `Lien refusé : ${detail}`
    : 'Lien refusé. Demandez un nouvel envoi à un administrateur.';
}

/**
 * Contrôle du mot de passe saisi ; retourne le message d'erreur à afficher,
 * ou null si tout va bien.
 */
export function verifieMotDePasse(mdp: string, confirmation: string): string | null {
  if (mdp.length < LONGUEUR_MIN_MOT_DE_PASSE) {
    return `Le mot de passe doit comporter au moins ${LONGUEUR_MIN_MOT_DE_PASSE} caractères.`;
  }
  if (mdp !== confirmation) return 'Les deux saisies ne correspondent pas.';
  return null;
}

/** Titre et consigne du formulaire selon la nature du lien. */
export function texteFormulaireMotDePasse(type: 'invite' | 'recovery'): {
  titre: string;
  consigne: string;
  bouton: string;
} {
  if (type === 'invite') {
    return {
      titre: 'Bienvenue — choisissez votre mot de passe',
      consigne:
        'Votre compte a été créé par un administrateur. Choisissez le mot de passe que vous ' +
        'utiliserez ensuite avec votre adresse e-mail pour ouvrir la supervision.',
      bouton: 'Enregistrer et entrer',
    };
  }
  return {
    titre: 'Nouveau mot de passe',
    consigne: 'Choisissez un nouveau mot de passe pour votre compte.',
    bouton: 'Enregistrer et entrer',
  };
}
