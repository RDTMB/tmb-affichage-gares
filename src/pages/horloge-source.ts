// Source d'heure des écrans : heure réelle Europe/Paris, ou heure simulée
// `?simule=HH:MM` (elle démarre à HH:MM au chargement puis avance en temps
// réel). Le moteur src/core/ reste pur : il ne reçoit que des secondes.
//
// `?jour=AAAA-MM-JJ` s'ajoute à côté et simule la JOURNÉE D'EXPLOITATION,
// pas un voyage dans le temps : il ne déplace que `dateISO()` et
// `dateLongue()`. Décaler `maintenantMs()` de plusieurs jours ferait expirer
// tous les messages et fausserait le cycle des médias — un écran qui aurait
// l'air de marcher tout en montrant autre chose que la réalité, exactement le
// défaut qu'on passe son temps à traquer.

export interface SourceHeure {
  /** Secondes depuis minuit (Europe/Paris), heure simulée comprise. */
  maintenantS(): number;
  /** Horodatage absolu (ms epoch) décalé par l'heure simulée — pour comparer les `expire_at`. */
  maintenantMs(): number;
  /** « YYYY-MM-DD » du jour d'exploitation (Europe/Paris). */
  dateISO(): string;
  /** « Lundi 24 août » (première lettre capitalisée). */
  dateLongue(): string;
  /** Heure simulée (`?simule=`) retenue. */
  simulee: boolean;
  /** Journée simulée (`?jour=`) retenue, ou `null`. */
  jourSimule: string | null;
}

const FORMAT_HMS = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const FORMAT_DATE_ISO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const FORMAT_DATE_LONGUE = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

/**
 * `?jour=` retenu, ou `null`. Format strict ET date RÉELLE : le 31 juin
 * passe le test de forme, et `new Date(Date.UTC(…))` le fait glisser au
 * 1er juillet sans rien dire. La comparaison des composantes le refuse.
 *
 * Une valeur invalide est IGNORÉE, comme `?simule=` ignore déjà une heure mal
 * formée : on ne casse pas un écran de gare sur une faute de frappe d'URL.
 */
function jourRetenu(jour: string | null): string | null {
  if (!jour || !/^\d{4}-\d{2}-\d{2}$/.test(jour)) return null;
  const [a = 0, m = 0, j = 0] = jour.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, j));
  if (d.getUTCFullYear() !== a || d.getUTCMonth() !== m - 1 || d.getUTCDate() !== j) return null;
  return jour;
}

function secondesParis(instantMs: number): number {
  const [h = 0, m = 0, s = 0] = FORMAT_HMS.format(new Date(instantMs)).split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

/**
 * @param ecartHorlogeMs FACULTATIF — écart mesuré entre l'horloge locale et
 *   celle du serveur (`DataProvider.ecartHorlogeMs()`, positif = locale EN
 *   AVANCE), ou `null` tant qu'aucune réponse ne l'a mesuré. Fourni, il
 *   CORRIGE l'heure : la source suit le serveur, pas le poste. Seul le site
 *   web s'en sert (embed.ts) : son visiteur ne peut pas régler son horloge.
 *   Les écrans de gare ne le passent PAS — ils gardent leur règle (dire
 *   l'écart, puis écran neutre), et donc leur comportement.
 *
 *   La correction ne s'applique pas à une heure SIMULÉE (`?simule=`) : elle
 *   la ferait sauter de la valeur de l'écart à la première réponse, et une
 *   heure simulée n'a de toute façon aucune réalité à rejoindre.
 */
export function creeSourceHeure(
  simule: string | null,
  jour?: string | null,
  ecartHorlogeMs?: () => number | null,
): SourceHeure {
  let decalage = 0;
  let simulee = false;
  const jourSimule = jourRetenu(jour ?? null);
  // Instant RÉEL : l'horloge locale, ramenée sur celle du serveur quand un
  // écart est mesuré. Écart = locale − serveur, donc serveur = locale − écart.
  const instantMs = (): number => Date.now() - (simulee ? 0 : (ecartHorlogeMs?.() ?? 0));
  // Midi UTC : le formatage en Europe/Paris tombe sur le même jour toute
  // l'année, changements d'heure d'été compris.
  const dateDuJour = (): Date =>
    jourSimule ? new Date(`${jourSimule}T12:00:00Z`) : new Date(instantMs());
  // Les secondes sont acceptées : les états « À QUAI » / « DÉPART IMMINENT »
  // se jouent sur une fenêtre de 30 s, impossible à viser à la minute près.
  if (simule && /^\d{1,2}:\d{2}(:\d{2})?$/.test(simule)) {
    const [h = 0, m = 0, s = 0] = simule.split(':').map(Number);
    decalage = h * 3600 + m * 60 + s - secondesParis(Date.now());
    simulee = true;
  }
  return {
    simulee,
    jourSimule,
    // `?jour=` ne touche NI `maintenantS` NI `maintenantMs` : voir l'en-tête.
    maintenantS: () => (((secondesParis(instantMs()) + decalage) % 86400) + 86400) % 86400,
    maintenantMs: () => instantMs() + decalage * 1000,
    dateISO: () => jourSimule ?? FORMAT_DATE_ISO.format(new Date(instantMs())),
    dateLongue: () => {
      const d = FORMAT_DATE_LONGUE.format(dateDuJour());
      return d.charAt(0).toUpperCase() + d.slice(1);
    },
  };
}
