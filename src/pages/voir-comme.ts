// « VOIR COMME » — prévisualiser la supervision avec les droits d'un autre
// RÔLE, en lecture seule (demande de l'exploitant, 09/09/2026).
//
// Le besoin : la barre d'onglets est réglable en exploitation
// (`onglets_par_role`), la matrice des droits ne l'est pas, et les deux se
// composent. Personne ne peut aujourd'hui répondre à « qu'est-ce que la caisse
// voit, au juste ? » autrement qu'en se connectant avec un compte de caisse —
// donc en connaissant son mot de passe, ou en s'en fabriquant un.
//
// ---------------------------------------------------------------------------
// §3 — PAR QUEL MÉCANISME L'ÉCRITURE DEVIENT IMPOSSIBLE, ET POURQUOI CELUI-LÀ
// ---------------------------------------------------------------------------
//
// Le critère posé : masquer un bouton ne suffit pas, un attribut `disabled` se
// retire dans l'inspecteur. Il faut que le CHEMIN D'ÉCRITURE refuse, au même
// endroit pour tous les onglets, et que ce refus soit prouvable par un test.
//
// Trois mécanismes étaient possibles. Le choix s'est fait sur le relevé des
// appels, pas sur le goût :
//
//   1. Verrouiller chaque commande (`disabled` + refus du gestionnaire), comme
//      l'onglet Places le fait pour `etatSaisie.saisie`. C'est le motif du
//      dépôt, mais il vaut pour UNE commande. Ici l'écriture part de ~20
//      méthodes différentes du fournisseur, appelées depuis une centaine de
//      gestionnaires répartis sur neuf onglets : il faudrait cent refus
//      d'accord entre eux, et le cent-unième, ajouté l'an prochain, ne saurait
//      rien de l'aperçu. Un oubli ne se verrait pas — il ÉCRIRAIT.
//
//   2. Changer les rôles lus par RLS. Exclu par le cahier des charges, et à
//      raison : le jeton porte les VRAIS rôles, la base doit continuer de dire
//      la vérité sur qui agit. Un aperçu ne doit pas pouvoir usurper.
//
//   3. Interposer le fournisseur lui-même. C'est ce qui est retenu. Toute
//      écriture de la supervision passe par `provider.*` — la règle du dépôt
//      « aucun appel Supabase hors de `src/data/` » en fait un PASSAGE OBLIGÉ,
//      et c'est la seule chose qui rende ce mécanisme complet. Un seul endroit
//      refuse, pour les neuf onglets à la fois.
//
// Et le refus est FERMÉ PAR DÉFAUT : une méthode qui n'est dans aucune des
// trois listes ci-dessous est refusée. Une méthode ajoutée demain à
// `DataProvider` casse donc l'aperçu BRUYAMMENT au lieu de laisser passer une
// écriture silencieuse. Le test de `voir-comme.test.ts` compare les trois
// listes à l'interface : on ne peut pas ajouter une méthode sans la classer.
//
// L'attribut `disabled` reste posé par-dessus (`verrouilleApercu`), parce que
// le motif du dépôt est les DEUX — mais il est désormais du confort, et
// l'annoncer ainsi est la moitié du travail : ce qui tient, c'est le refus.
import type { DataProvider } from '../data/provider.js';
import { ROLES, type Role } from '../core/roles.js';

/**
 * Les méthodes de lecture. Rien ici ne modifie l'état de la base ; elles
 * traversent l'aperçu sans changement.
 *
 * UNE EXCEPTION, et c'est le piège que ce classement a servi à trouver :
 * `getJour` sait CRÉER la journée quand la supervision passe
 * `{ creerSiAbsent: true }` — et elle le passe à ses trois appels
 * (`affichage-sans-ecriture.test.ts` le verrouille). Prévisualiser une date
 * non ouverte l'aurait donc OUVERTE, ce qui est précisément le défaut du
 * 08/09/2026 : une alerte détruite en la regardant. L'option est neutralisée
 * ici, au passage, et non aux appels — sinon l'aperçu et la supervision
 * n'auraient pas la même règle à tenir.
 */
export const LECTURES = [
  'getGrilles',
  'listGrilles',
  'listJoursGeneres',
  'getJour',
  'getMessages',
  'getAffluence',
  'getMedias',
  'listMedias',
  'getParams',
  'onChange',
  'getRoles',
  'getProfil',
  'getModelesMessages',
  'listUsers',
  'getOngletsParRole',
  'dernierePublication',
  'listJournal',
  'listEcrans',
  'getSurveillance',
  'ecartHorlogeMs',
  'correctionsParams',
] as const;

/**
 * Le seul appel autorisé qui ne soit pas une lecture : QUITTER.
 *
 * `signOut` ne touche aucune donnée d'exploitation ; il ferme la session. Le
 * refuser enfermerait l'agent dans son propre aperçu — il ne pourrait plus se
 * déconnecter sans fermer le navigateur, et le jeton de rafraîchissement
 * survivrait dans `localStorage` (défaut E-01, déjà corrigé une fois).
 */
export const SORTIE = ['signOut'] as const;

/**
 * Tout le reste : refusé pendant l'aperçu.
 *
 * Quatre entrées méritent leur raison, parce qu'on pourrait les croire
 * inoffensives :
 *   • `heartbeat` écrit le signal de vie d'un poste — il inscrirait l'onglet
 *     de supervision dans la liste des écrans ;
 *   • `signIn` changerait la session SOUS l'aperçu ;
 *   • `traduire` n'écrit pas en base, mais appelle une Edge Function
 *     facturée, et n'est atteinte que depuis un formulaire dont
 *     l'enregistrement est déjà refusé : le laisser passer coûterait des
 *     appels pour un résultat qu'on jette ;
 *   • `logPublication` est le journal — un aperçu ne laisse pas de trace,
 *     c'est la décision du §6.
 */
export const ECRITURES = [
  'saveGrille',
  'setGrilleActive',
  'updateGrilleMetadonnees',
  'setAffluence',
  'heartbeat',
  'saveVitesseEcran',
  'signIn',
  'genererJour',
  'reinitialiseJour',
  'saveCirculation',
  'saveCirculations',
  'creerTrainSup',
  'supprimerTrainSup',
  'confirmerDepartSup',
  'setAccesCourse',
  'setTerminusBellevue',
  'setSectionJour',
  'saveMessage',
  'deleteMessage',
  'uploadMedia',
  'saveMedia',
  'deleteMedia',
  'saveParams',
  'saveMachine',
  'deleteMachine',
  'saveMotif',
  'deleteMotif',
  'saveCiel',
  'deleteCiel',
  'saveModeleMessage',
  'deleteModeleMessage',
  'saveUser',
  'setRolesUser',
  'setOngletRole',
  'deleteUser',
  'inviteUser',
  'resetMotDePasse',
  'definirMotDePasse',
  'traduire',
  'logPublication',
  'declareEcran',
  'demanderRechargement',
  'saveVeilleEcran',
  'saveSurveillanceEcran',
  'oublierEcran',
] as const;

/**
 * Refus d'écriture pendant l'aperçu. Une classe PROPRE, et non une `Error`
 * anonyme : le toast doit pouvoir dire « c'est un aperçu », pas « échec de
 * l'enregistrement », qui enverrait chercher une panne réseau qui n'existe
 * pas.
 */
export class RefusApercu extends Error {
  constructor(readonly methode: string) {
    super(
      `Aperçu « voir comme » : l'écriture est impossible tant que l'aperçu est actif (${methode}).`,
    );
    this.name = 'RefusApercu';
  }
}

const AUTORISEES = new Set<string>([...LECTURES, ...SORTIE]);

/**
 * Enveloppe le fournisseur : tant que `actif()` répond `true`, toute méthode
 * qui n'est pas une lecture (ou la sortie) lève `RefusApercu`.
 *
 * Le contrôle a lieu à CHAQUE appel, pas à l'installation : il n'y a donc
 * jamais deux fournisseurs à échanger, et aucune fenêtre pendant laquelle un
 * appel en vol tiendrait encore l'ancien.
 */
export function providerApercu(reel: DataProvider, actif: () => boolean): DataProvider {
  return new Proxy(reel, {
    get(cible, prop, recepteur) {
      const valeur = Reflect.get(cible, prop, recepteur) as unknown;
      // Les symboles et les champs non appelables passent : seuls les appels
      // de méthode peuvent écrire, et `then` doit rester absent pour qu'un
      // `await` sur le fournisseur ne le prenne pas pour une promesse.
      if (typeof prop !== 'string' || typeof valeur !== 'function') return valeur;
      const methode = valeur.bind(cible) as (...a: unknown[]) => unknown;
      return (...args: unknown[]): unknown => {
        if (!actif()) return methode(...args);
        if (prop === 'getJour') {
          // Voir LECTURES : la seule lecture qui sache écrire.
          const options = (args[1] ?? {}) as Record<string, unknown>;
          return methode(args[0], { ...options, creerSiAbsent: false });
        }
        if (AUTORISEES.has(prop)) return methode(...args);
        // FERMÉ PAR DÉFAUT : `ECRITURES` documente, elle n'autorise rien. Une
        // méthode inconnue tombe ici, et c'est voulu.
        throw new RefusApercu(prop);
      };
    },
  });
}

// ---------------------------------------------------------------------------
// §4 — L'ÉTAT DU MODE
// ---------------------------------------------------------------------------

/**
 * `sessionStorage` et non `localStorage` : un aperçu ne doit pas survivre à la
 * fermeture de l'onglet, et la déconnexion appelle déjà `sessionStorage.clear()`
 * (voir le bouton « Quitter »). Le mode s'efface donc avec la session sans
 * qu'un second mécanisme ait à y penser.
 */
export const CLE_APERCU = 'tmb-apercu-roles';

/** Rôles simulés lus depuis le stockage, ou `null` si l'aperçu est inactif. */
export function rolesApercuStockes(stockage: Pick<Storage, 'getItem'>): Role[] | null {
  let brut: string | null = null;
  try {
    brut = stockage.getItem(CLE_APERCU);
  } catch {
    return null;
  }
  if (brut === null) return null;
  return rolesApercuValides(brut);
}

/**
 * Analyse une valeur stockée. Elle n'accorde RIEN — elle ne sert qu'à choisir
 * ce qu'on AFFICHE — mais une valeur forgée à la main dans l'inspecteur ne doit
 * pas non plus faire planter la page : tout ce qui n'est pas un rôle connu est
 * écarté, et l'ordre canonique de `ROLES` est rétabli.
 *
 * Un ensemble VIDE est légitime et se distingue de l'absence d'aperçu : c'est
 * « un compte sans aucun rôle », un cas que l'annuaire sait produire et que
 * l'exploitant a justement besoin de voir.
 */
export function rolesApercuValides(brut: string): Role[] | null {
  let lu: unknown;
  try {
    lu = JSON.parse(brut);
  } catch {
    return null;
  }
  if (!Array.isArray(lu)) return null;
  return ROLES.filter((r) => lu.includes(r));
}

/** Libellé du bandeau permanent : des RÔLES, jamais une personne (§2). */
export function libelleApercu(roles: readonly Role[], libelleRole: Record<Role, string>): string {
  if (roles.length === 0) return 'un compte SANS AUCUN RÔLE';
  return roles.map((r) => libelleRole[r].toUpperCase()).join(' + ');
}
