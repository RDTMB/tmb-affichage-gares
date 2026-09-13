<!-- Titre : ce que le lot change du point de vue de l'EXPLOITATION, pas du fichier touché.

&#x20;    « Le bandeau alterne : l'important, puis les autres » — pas « Modification de X.ts ». -->



\## Le besoin, ou le défaut



<!-- Ce qu'on répare ou ce qu'on ajoute, et pour qui. Si un constat de départ s'est révélé

&#x20;    FAUX, le dire ici : c'est l'information la plus utile, et celle qui se perd le plus vite. -->



\## Ce qui a été mesuré, et comment



<!-- Chiffres, fichiers lus, requêtes passées, rendu observé au navigateur.

&#x20;    Ce qui n'a pas pu être vérifié se dit aussi, avec ce qui manque pour trancher. -->



\## Les décisions, et leur raison



<!-- Une ligne par décision. Ce qu'on gagne, ce qu'on perd. -->



\## Mise en service



<!-- ⚠ S'IL Y A UNE MIGRATION : le SQL passe en PRODUCTION \*\*avant\*\* la fusion.

&#x20;    Le front déployé demande ses colonnes NOMMÉMENT, et PostgREST refuse la requête

&#x20;    ENTIÈRE si l'une manque — pas la colonne, la requête. C'est ce qui a éteint les six

&#x20;    gares le 11/09/2026.

&#x20;    Séquence : TEST → vérifier les six écrans et la supervision → PRODUCTION → FUSION.

&#x20;    Sinon : « Rien en base, la branche se fusionne seule. » -->



\## Contrôles



<!-- `tsc`, `vite build`, Prettier et les tests, lancés SÉPARÉMENT sur arbre propre.

&#x20;    `npm test` ne type-vérifie pas : seul `npm run build` lance `tsc`.

&#x20;    Campagne de mutation : le score, et les survivantes une par une — y compris celles

&#x20;    qui n'ont pas été tuées. -->



\## Reste ouvert

