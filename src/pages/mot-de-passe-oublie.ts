// « Mot de passe oublié » en libre-service — la décision, PURE et testée.
//
// Jusqu'ici, `resetMotDePasse()` n'était appelée qu'à un seul endroit : le
// bouton de la liste des utilisateurs, donc par un administrateur DÉJÀ
// connecté. Un agent qui a perdu son mot de passe devait appeler quelqu'un.
// Les deux chemins coexistent maintenant, aucun ne remplace l'autre.
//
// CE QUE RENVOIE GoTrue POUR UNE ADRESSE INCONNUE — mesuré le 09/09/2026
// contre le projet de TEST (wyltzhggbyfteojbfoup), `POST /auth/v1/recover`,
// SDK @supabase/auth-js 2.112.4 :
//
//   adresse inconnue, bien formée   → HTTP 200, corps `{}`, aucune erreur
//   adresse mal formée              → HTTP 400 validation_failed
//                                     « Unable to validate email address »
//   adresse vide                    → HTTP 400 validation_failed
//                                     « Password recovery requires an email »
//
// Le SDK ne fait que relayer : il POSTe sur `/recover` et rend ce que GoTrue
// répond, sans jamais distinguer quoi que ce soit lui-même (GoTrueClient.js).
// GoTrue est donc DÉJÀ muet sur l'existence d'un compte — l'énumération ne
// viendrait pas de lui, elle viendrait de nous si l'interface affichait deux
// messages différents. D'où le message unique ci-dessous : il ne compense pas
// une faiblesse du serveur, il évite d'en créer une.
//
// Conséquence utile : pour une adresse bien formée, les seules erreurs
// possibles sont la limite de débit, une coupure réseau et une panne serveur.
// Aucune ne dit si le compte existe, et c'est ce qui rend l'exception du
// message de débit sans danger.

/**
 * LE message, quel que soit le résultat. Toute réponse qui distinguerait
 * « compte connu » de « compte inconnu » transformerait ce formulaire en
 * annuaire des adresses valides de la Régie, interrogeable depuis Internet
 * par n'importe qui.
 */
export const MESSAGE_GENERIQUE =
  "Si un compte existe pour cette adresse, un lien vient d'être envoyé. " +
  'Pensez à regarder vos courriers indésirables.';

/**
 * L'UNIQUE exception, et elle ferme un défaut réel. Le 07/09/2026, une
 * invitation a échoué sur « email rate limit exceeded » : un agent qui aurait
 * lu « le lien est parti » aurait attendu un courriel qui n'arrivait jamais.
 * Un échec muet est pire qu'un échec dit.
 *
 * L'exception n'ouvre aucune fuite : la limite de GoTrue est GLOBALE au
 * projet, pas par compte. La voir ne dit donc rien de l'adresse saisie.
 */
export const MESSAGE_DEBIT =
  'Trop de demandes ont été envoyées récemment. Réessayez dans quelques minutes.';

/** Sans Supabase, le mock n'envoie rien : le dire plutôt que de laisser croire. */
export const MESSAGE_DEMO = "Mode démo : aucun courriel n'est envoyé.";

/**
 * Adresse inutilisable. Ce message ne dit rien d'un COMPTE, seulement de ce
 * qui a été tapé : il ne participe donc pas à l'énumération.
 */
export const MESSAGE_ADRESSE = 'Saisissez une adresse électronique complète.';

/** Attente imposée après une demande, en secondes (garde-fou d'ergonomie). */
export const DELAI_REESSAI_S = 60;

/**
 * Forme minimale d'une adresse : GoTrue refuse le reste par un 400, mais on
 * ne l'appelle même pas — une demande qu'on sait vouée à l'échec ne doit pas
 * consommer la limite de débit du projet.
 *
 * Volontairement PERMISSIF : ce n'est pas ici qu'on valide une adresse, c'est
 * le serveur de courriel qui tranchera. On écarte seulement ce qui ne peut
 * pas être une adresse — vide, sans arobase, sans point après, avec un espace.
 */
export function adresseUtilisable(valeur: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valeur.trim());
}

/** L'erreur est-elle la limite de débit de GoTrue ? */
export function estLimiteDeDebit(erreur: unknown): boolean {
  const message = erreur instanceof Error ? erreur.message : String(erreur ?? '');
  return /rate limit/i.test(message);
}

export interface ResultatDemande {
  /** Ce que la carte affiche. */
  message: string;
  /** La demande est-elle réellement partie au fournisseur ? */
  envoyee: boolean;
  /** Faut-il imposer l'attente avant un nouvel essai ? */
  imposeAttente: boolean;
}

/**
 * Demande de réinitialisation, décision comprise.
 *
 * L'attente n'est imposée que si la demande est PARTIE : une adresse mal
 * formée n'a rien consommé, et bloquer le bouton punirait une faute de frappe.
 * Elle l'est en revanche après un échec, limite de débit incluse — c'est
 * précisément le moment où il ne faut pas réessayer tout de suite.
 */
export async function demandeReinitialisation(options: {
  adresse: string;
  modeDemo: boolean;
  reset: (email: string) => Promise<void>;
}): Promise<ResultatDemande> {
  const adresse = options.adresse.trim();
  if (!adresseUtilisable(adresse)) {
    return { message: MESSAGE_ADRESSE, envoyee: false, imposeAttente: false };
  }
  try {
    await options.reset(adresse);
    // Le mode démo est dit APRÈS l'appel, pas à sa place : le fournisseur de
    // démonstration est bien sollicité, il ne fait simplement rien. Une
    // branche qui sauterait l'appel testerait autre chose que le vrai chemin.
    return {
      message: options.modeDemo ? MESSAGE_DEMO : MESSAGE_GENERIQUE,
      envoyee: true,
      imposeAttente: true,
    };
  } catch (erreur) {
    if (estLimiteDeDebit(erreur)) {
      return { message: MESSAGE_DEBIT, envoyee: true, imposeAttente: true };
    }
    // TOUTE autre erreur — réseau coupé, panne serveur, adresse refusée —
    // rend le MÊME message que le succès. C'est le cœur du sujet : un message
    // d'erreur qui varie est un annuaire.
    return {
      message: options.modeDemo ? MESSAGE_DEMO : MESSAGE_GENERIQUE,
      envoyee: true,
      imposeAttente: true,
    };
  }
}

export interface Decompte {
  /** Arme l'attente à partir de cet instant. */
  demarre(maintenantMs: number): void;
  /**
   * Libellé du bouton pendant l'attente, ou `null` quand elle est finie —
   * `null` veut dire « bouton réactivé ».
   */
  libelle(maintenantMs: number): string | null;
}

/**
 * Décompte du bouton, horloge INJECTÉE.
 *
 * Ce n'est pas un garde-fou de sécurité, c'en est un d'ergonomie : il empêche
 * l'agent qui ne voit rien arriver de cliquer cinq fois et de déclencher
 * lui-même la limite de débit du projet. La limite de GoTrue, elle, reste la
 * vraie protection.
 */
export function creeDecompte(secondes = DELAI_REESSAI_S): Decompte {
  let finMs: number | null = null;
  return {
    demarre(maintenantMs) {
      finMs = maintenantMs + secondes * 1000;
    },
    libelle(maintenantMs) {
      if (finMs === null || maintenantMs >= finMs) return null;
      // Arrondi au PLAFOND : à 59,4 s restantes on affiche 60, pas 59, et le
      // libellé ne saute jamais une valeur au premier affichage.
      return `Réessayer dans ${Math.ceil((finMs - maintenantMs) / 1000)} s`;
    },
  };
}

/**
 * Compte désactivé : rendre le refus ACTIONNABLE, sans le changer.
 *
 * Le refus lui-même est juste et reste où il est (`getProfil()` refuse un
 * profil inactif). Ce qu'il manquait, c'est de dire à l'agent quoi faire :
 * « Profil inactif ou absent » ne lui apprend rien.
 *
 * Ce message ne rouvre PAS la distinction que le message unique ferme : on ne
 * l'atteint qu'après un mot de passe JUSTE. Il faut donc déjà détenir les
 * identifiants du compte pour le lire — il n'apprend rien à qui ne les a pas.
 * C'est aussi pourquoi la carte « mot de passe oublié » ne doit surtout pas
 * essayer de reconnaître un compte désactivé : là, personne n'a rien prouvé.
 */
export function messageRefusConnexion(erreur: unknown): string {
  const message = erreur instanceof Error ? erreur.message : '';
  if (/profil inactif/i.test(message)) {
    return 'Ce compte est désactivé. Demandez sa réactivation à un administrateur.';
  }
  return message || 'Connexion refusée';
}

// ---------------------------------------------------------------------------
// Le branchement. Le DOM et le temps sont INJECTÉS : la carte est éprouvée
// telle qu'elle est livrée, sans jsdom et sans attendre 60 secondes.
// ---------------------------------------------------------------------------

interface Ecoutable {
  addEventListener(nom: string, fn: (e: { preventDefault(): void }) => void): void;
}

interface Basculable {
  hidden: boolean;
}

/** Les seuls organes du DOM dont la carte a besoin. */
export interface CarteOubli {
  formConnexion: Basculable;
  formOubli: Basculable;
  lienOubli: Ecoutable;
  lienRetour: Ecoutable;
  formulaireOubli: Ecoutable;
  /** Ce que l'agent vient de taper dans `login-email`. */
  champLogin: { value: string };
  champOubli: { value: string; focus?(): void };
  bouton: { disabled: boolean; textContent: string | null };
  zone: { textContent: string | null; classList: { toggle(nom: string, actif: boolean): void } };
}

/** Le temps, injecté : `Date.now` et `setInterval` en production, faux au test. */
export interface Horlogerie {
  maintenantMs(): number;
  /** Appelle `fn` chaque seconde ; le retour arrête le battement. */
  chaqueSeconde(fn: () => void): () => void;
}

export function brancheMotDePasseOublie(options: {
  dom: CarteOubli;
  reset: (email: string) => Promise<void>;
  modeDemo: boolean;
  horlogerie: Horlogerie;
  delaiS?: number;
}): void {
  const { dom, horlogerie } = options;
  const libelleInitial = dom.bouton.textContent ?? 'Envoyer le lien';
  let arreteBattement: (() => void) | null = null;

  function dit(message: string, neutre: boolean): void {
    dom.zone.textContent = message;
    dom.zone.classList.toggle('dit', neutre);
  }

  function rendLeBouton(): void {
    arreteBattement?.();
    arreteBattement = null;
    dom.bouton.textContent = libelleInitial;
    dom.bouton.disabled = false;
  }

  dom.lienOubli.addEventListener('click', () => {
    // L'adresse suit l'agent : il vient de la taper, la redemander serait une
    // petite insulte — et une occasion de la taper de travers.
    dom.champOubli.value = dom.champLogin.value.trim();
    // On n'efface le message que si l'attente est FINIE. Sinon l'agent qui
    // revient sur la carte trouverait un bouton bloqué et plus une ligne pour
    // lui dire pourquoi — constaté au navigateur en écrivant ce chantier.
    if (!dom.bouton.disabled) dit('', true);
    dom.formConnexion.hidden = true;
    dom.formOubli.hidden = false;
    dom.champOubli.focus?.();
  });

  dom.lienRetour.addEventListener('click', () => {
    dom.formOubli.hidden = true;
    dom.formConnexion.hidden = false;
  });

  dom.formulaireOubli.addEventListener('submit', (e) => {
    e.preventDefault();
    // Le décompte tient déjà le bouton : un `submit` par la touche Entrée
    // contournerait `disabled`.
    if (dom.bouton.disabled) return;
    // Désactivé AVANT l'attente du réseau, pas après : c'est pendant que rien
    // ne se passe qu'on clique cinq fois.
    dom.bouton.disabled = true;
    dit('', true);
    void demandeReinitialisation({
      adresse: dom.champOubli.value,
      modeDemo: options.modeDemo,
      reset: options.reset,
    }).then((resultat) => {
      // Une adresse impossible n'a rien consommé : le message est un vrai
      // reproche (rouge), et le bouton revient tout de suite.
      dit(resultat.message, resultat.envoyee);
      if (!resultat.imposeAttente) {
        rendLeBouton();
        return;
      }
      const decompte = creeDecompte(options.delaiS ?? DELAI_REESSAI_S);
      decompte.demarre(horlogerie.maintenantMs());
      const rafraichit = (): void => {
        const libelle = decompte.libelle(horlogerie.maintenantMs());
        if (libelle === null) rendLeBouton();
        else dom.bouton.textContent = libelle;
      };
      rafraichit();
      arreteBattement = horlogerie.chaqueSeconde(rafraichit);
    });
  });
}
