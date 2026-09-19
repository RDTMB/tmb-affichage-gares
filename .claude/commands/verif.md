---
description: Lance les quatre contrôles séparément sur arbre propre et n'en rapporte que le verdict
allowed-tools: Bash(npm run build:*), Bash(npx vitest run:*), Bash(npx prettier --check:*), Bash(git status:*), Bash(git stash list:*)
---

Lance les quatre contrôles du dépôt, **un par un, dans cet ordre**, et ne
rapporte que le VERDICT. Le but de cette commande est explicitement de ne pas
déverser des milliers de lignes de sortie dans la conversation : la sortie
complète d'un contrôle n'apparaît QUE s'il échoue.

Les quatre contrôles, chacun dans son propre appel d'outil (jamais chaînés par
`&&` : un chaînage masque le deuxième échec derrière le premier) :

1. `npm run build` — c'est lui qui lance `tsc`. `npm test` ne type-vérifie
   PAS : vitest ignore les types. Un lot annoncé vert sur le seul vitest a
   déjà été poussé avec une erreur de type.
2. `npx vitest run`
3. `npx prettier --check .`
4. `git status --short` — l'arbre doit être PROPRE. Un contrôle qui a tourné
   sur des fichiers non commités ne prouve rien du contenu de la branche.

Si tu travailles dans PowerShell plutôt que dans Bash, écris `npm.cmd` et
`npx.cmd` : `npm` tout court y résout vers `npm.ps1`, rejeté par la stratégie
d'exécution du poste.

## Ce que tu rapportes

Une ligne par contrôle, dans l'ordre, rien d'autre :

```
✅ npm run build        — 0 erreur
✅ npx vitest run       — 412 tests, 0 échec
✅ npx prettier --check — tout formaté
✅ git status           — arbre propre
```

Pour un contrôle en échec : la ligne passe à `❌`, et TU AJOUTES dessous le
minimum qui permet d'agir — le message d'erreur et le fichier, jamais la
sortie entière. Tronque à une vingtaine de lignes ; si l'échec en demande
davantage, dis quel fichier ouvrir plutôt que de le recopier.

Pour `git status` non propre : liste les fichiers, et dis lesquels sont
attendus (un artefact de build ignoré n'est pas la même chose qu'une
modification oubliée).

Puis UNE ligne de conclusion : « les quatre contrôles passent, la branche est
prête » ou « N contrôle(s) en échec ». N'entreprends aucune correction de
toi-même : `/verif` constate, il ne répare pas.
