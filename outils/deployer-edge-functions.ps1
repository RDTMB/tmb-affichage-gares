<#
.SYNOPSIS
    Déploie les Edge Functions du projet TMB sur un projet Supabase donné.

.DESCRIPTION
    Reproduit, sans passer par le tableau de bord, le déploiement des trois
    fonctions « traduire », « inviter-utilisateur » et « supprimer-utilisateur ».

    Le script :
      - retrouve node/npx même s'il n'est pas dans le PATH (installation portable) ;
      - impose TOUJOURS --project-ref, pour qu'un projet lié en cache ne puisse
        pas détourner le déploiement vers la production ;
      - exige une confirmation tapée à la main avant tout envoi en production ;
      - travaille sans Docker (--use-api) ;
      - n'affiche, ne journalise et ne stocke JAMAIS le jeton d'accès.

    L'authentification passe par un jeton personnel Supabase, demandé à la
    frappe invisible et gardé dans le seul environnement de ce processus. La
    connexion par navigateur, elle, n'est pas utilisable : la CLI la refuse hors
    d'un vrai terminal.

.PARAMETER Projet
    « test » ou « prod ». Obligatoire : il n'y a pas de valeur par défaut, pour
    qu'un oubli ne parte jamais en production.

.PARAMETER Fonctions
    Les fonctions à déployer. Par défaut les trois du projet.

.PARAMETER VersionCli
    Version de la CLI Supabase. Figée pour être reproductible ; « latest » est
    accepté pour un dépannage ponctuel.

.PARAMETER Node
    Dossier contenant npx.cmd, à indiquer seulement si le script ne le trouve
    pas seul. En cas d'échec, il affiche tout ce qu'il a essayé.

.PARAMETER Connexion
    Demande le jeton et l'éprouve sur le projet de test, sans rien déployer.

.PARAMETER Simulation
    Vérifie tout (npx, dossiers, autorisation, projet joignable) et affiche
    l'état actuel des fonctions déployées, mais ne déploie rien.

.NOTES
    Windows refuse par défaut d'exécuter un fichier .ps1. Passer par le lanceur
    outils\deployer-edge-functions.cmd, qui accepte exactement les mêmes
    paramètres et ne demande aucun droit particulier.

.EXAMPLE
    .\outils\deployer-edge-functions.cmd -Connexion

.EXAMPLE
    .\outils\deployer-edge-functions.cmd -Projet test -Simulation

.EXAMPLE
    .\outils\deployer-edge-functions.cmd -Projet test

.EXAMPLE
    .\outils\deployer-edge-functions.cmd -Projet prod
#>
[CmdletBinding()]
param(
    [ValidateSet('test', 'prod')]
    [string] $Projet,

    [string[]] $Fonctions = @('traduire', 'inviter-utilisateur', 'supprimer-utilisateur'),

    [string] $VersionCli = '2.116.0',

    [string] $Node,

    [switch] $Connexion,

    [switch] $Simulation
)

$ErrorActionPreference = 'Stop'

# --- Références des projets Supabase -----------------------------------------
# Écrites en dur A DESSEIN : un ref saisi à la main est un ref qu'on peut se
# tromper de taper, et se tromper ici veut dire déployer en production.
$REFS = @{
    test = 'wyltzhggbyfteojbfoup'
    prod = 'csstkdcqdzaiibfqrscv'
}

function Ecrire-Titre($texte) {
    Write-Host ''
    Write-Host "== $texte" -ForegroundColor Cyan
}

function Ecrire-Ok($texte) {
    Write-Host "   OK   $texte" -ForegroundColor Green
}

function Ecrire-Info($texte) {
    Write-Host "        $texte" -ForegroundColor DarkGray
}

# --- 1. Retrouver npx ---------------------------------------------------------
# Chaque emplacement essayé est consigné : quand rien n'est trouvé, le script
# affiche la liste plutôt qu'un « introuvable » qui n'apprend rien.
$script:Essais = New-Object System.Collections.Generic.List[object]

function Tester-Dossier {
    param([string] $Dossier)

    if ([string]::IsNullOrWhiteSpace($Dossier)) { return $null }
    $chemin = Join-Path $Dossier 'npx.cmd'
    $vu = $false
    try {
        # Test-Path répond aussi False quand l'accès est REFUSÉ, sans le dire.
        $vu = Test-Path -LiteralPath $chemin
    } catch {
        $vu = $false
    }
    $script:Essais.Add([pscustomobject]@{ Chemin = $chemin; Trouve = $vu })
    if ($vu) { return $chemin }
    return $null
}

<#
    Racines où chercher une installation portable.

    Le piège du poste, et il est vicieux. L'application Claude est un paquet
    Windows (MSIX). Quand elle installe quelque chose dans
    « …\AppData\Local\nodejs-portable », l'écriture est DÉTOURNÉE vers
    « …\AppData\Local\Packages\<paquet>\LocalCache\Local\nodejs-portable ».

    Vu de l'intérieur du paquet, rien n'y paraît : le dossier semble bien être
    à sa place ordinaire. Vu de l'EXTÉRIEUR — un terminal lancé normalement —
    ce chemin ordinaire n'existe pas du tout, et node est déclaré introuvable
    alors qu'il est installé.

    On explore donc les deux faces : la racine ordinaire, et les caches locaux
    de chaque paquet. Le sens inverse (être enfermé dans un paquet et vouloir
    en sortir) est traité aussi, par la coupure avant « \Packages\ ».
#>
function Racines-Candidates {
    $racines = New-Object System.Collections.Generic.List[string]
    $bruts = @(
        $env:LOCALAPPDATA,
        [Environment]::GetFolderPath('LocalApplicationData'),
        (Join-Path $env:USERPROFILE 'AppData\Local'),
        (Join-Path "C:\Users\$env:USERNAME" 'AppData\Local')
    )
    foreach ($r in $bruts) {
        if ([string]::IsNullOrWhiteSpace($r)) { continue }
        $racines.Add($r)
        $i = $r.IndexOf('\Packages\')
        if ($i -gt 0) { $racines.Add($r.Substring(0, $i)) }
    }

    # Caches locaux des paquets installés. On ne retient que ceux qui portent
    # réellement un dossier « nodejs-portable », pour ne pas noyer le
    # diagnostic sous des dizaines de chemins sans intérêt.
    foreach ($base in @($racines.ToArray())) {
        try {
            $paquets = Get-ChildItem -LiteralPath (Join-Path $base 'Packages') -Directory -ErrorAction Stop
        } catch {
            continue
        }
        foreach ($paquet in $paquets) {
            $cache = Join-Path $paquet.FullName 'LocalCache\Local'
            try {
                if (Test-Path -LiteralPath (Join-Path $cache 'nodejs-portable')) { $racines.Add($cache) }
            } catch {
                # Paquet illisible : sans importance, on passe au suivant.
            }
        }
    }

    return ($racines | Select-Object -Unique)
}

function Trouver-Npx {
    param([string] $Impose)

    if (-not [string]::IsNullOrWhiteSpace($Impose)) {
        # Chemin donné à la main : accepter le dossier comme le fichier.
        if ($Impose -like '*npx.cmd') { $Impose = Split-Path -Parent $Impose }
        return (Tester-Dossier $Impose)
    }

    $trouve = Get-Command 'npx.cmd' -ErrorAction SilentlyContinue
    if ($null -ne $trouve) { return $trouve.Source }

    # Installation portable, version NON figée : on prend celle qui est là.
    foreach ($racine in Racines-Candidates) {
        $portable = Join-Path $racine 'nodejs-portable'
        $versions = @()
        try {
            $versions = Get-ChildItem -LiteralPath $portable -Directory -Filter 'node-v*-win-x64' -ErrorAction Stop
        } catch {
            $script:Essais.Add([pscustomobject]@{ Chemin = "$portable\node-v*-win-x64"; Trouve = $false })
        }
        foreach ($v in $versions) {
            $r = Tester-Dossier $v.FullName
            if ($null -ne $r) { return $r }
        }
    }

    # Installations classiques.
    foreach ($dossier in @(
            (Join-Path $env:ProgramFiles 'nodejs'),
            (Join-Path ${env:ProgramFiles(x86)} 'nodejs'),
            (Join-Path $env:APPDATA 'npm'),
            (Join-Path $env:ProgramData 'chocolatey\bin'))) {
        $r = Tester-Dossier $dossier
        if ($null -ne $r) { return $r }
    }

    return $null
}

# --- 1 bis. Le jeton d'accès --------------------------------------------------
<#
    La CLI Supabase sait ouvrir le navigateur pour autoriser un poste, mais
    elle s'y REFUSE hors d'un vrai terminal : « Cannot use automatic login flow
    inside non-TTY environments ». C'est le cas ici. Reste le jeton personnel.

    Un jeton est un secret. Il est donc demandé à la frappe INVISIBLE et posé
    dans l'environnement de CE SEUL PROCESSUS : il ne passe par aucune ligne de
    commande (donc n'apparaît dans la liste des processus de personne), ni par
    l'historique du terminal, ni par un fichier. Il disparaît avec le script.

    Qui déploie souvent peut le poser durablement en variable d'environnement
    utilisateur ; le script s'en sert alors sans rien demander.
#>
function Ecrire-ModeOperatoireJeton {
    Write-Host ''
    Write-Host '   Poser le jeton une fois pour toutes, sans passer par le terminal :'
    Write-Host '     1. Créer le jeton sur https://supabase.com/dashboard/account/tokens'
    Write-Host '     2. Menu Démarrer, chercher « variables d''environnement », puis'
    Write-Host '        « Modifier les variables d''environnement pour votre compte »'
    Write-Host '     3. Variables utilisateur > Nouvelle'
    Write-Host '        Nom    : SUPABASE_ACCESS_TOKEN'
    Write-Host '        Valeur : le jeton'
    Write-Host '     4. Fermer et rouvrir le terminal, puis relancer cette commande.'
    Write-Host ''
    Write-Host '   Le jeton vaut un mot de passe : ne le coller ni dans une' -ForegroundColor DarkGray
    Write-Host '   conversation, ni dans le dépôt, ni dans une ligne de commande.' -ForegroundColor DarkGray
}

function Assurer-Jeton {
    if (-not [string]::IsNullOrWhiteSpace($env:SUPABASE_ACCESS_TOKEN)) {
        Ecrire-Ok 'Jeton d''accès : fourni par l''environnement'
        return $true
    }

    Ecrire-Titre 'Jeton d''accès Supabase'

    # Demander une saisie sur une entrée REDIRIGÉE fait attendre le script
    # indéfiniment : mieux vaut refuser tout de suite et dire quoi faire.
    $peutDemander = $true
    try {
        if ([Console]::IsInputRedirected) { $peutDemander = $false }
    } catch {
        $peutDemander = $false
    }
    if (-not [Environment]::UserInteractive) { $peutDemander = $false }

    if (-not $peutDemander) {
        Write-Host '   Ce terminal ne permet pas de saisie au clavier ici.' -ForegroundColor Yellow
        Ecrire-ModeOperatoireJeton
        return $false
    }

    Write-Host '   Le navigateur ne peut pas servir ici : la CLI refuse son ouverture'
    Write-Host '   automatique en dehors d''un vrai terminal.'
    Write-Host ''
    Write-Host '   1. Créer un jeton sur https://supabase.com/dashboard/account/tokens'
    Write-Host '   2. Le coller ci-dessous. La frappe reste INVISIBLE.'
    Write-Host ''
    Write-Host '   Le jeton n''est ni affiché, ni enregistré, ni écrit où que ce soit :' -ForegroundColor DarkGray
    Write-Host '   il ne vit que le temps de cette commande.' -ForegroundColor DarkGray
    Write-Host ''

    $secret = $null
    try {
        $secret = Read-Host '   Jeton' -AsSecureString
    } catch {
        $secret = $null
    }

    if ($null -eq $secret -or $secret.Length -eq 0) {
        Write-Host ''
        Write-Host '   Aucun jeton saisi.' -ForegroundColor Yellow
        Ecrire-ModeOperatoireJeton
        return $false
    }

    # Conversion en clair au dernier moment, et libération immédiate de la
    # mémoire non managée qui a porté le secret.
    $pointeur = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    try {
        $env:SUPABASE_ACCESS_TOKEN = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointeur)
    } finally {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointeur)
    }
    Ecrire-Ok 'Jeton reçu, valable le temps de cette commande'
    return $true
}

# --- 2. Appel de la CLI -------------------------------------------------------
function Invoquer-Cli {
    param(
        [Parameter(Mandatory = $true)] [string] $Npx,
        [Parameter(Mandatory = $true)] [string[]] $Arguments,
        [switch] $ToleranteALEchec
    )

    $complets = @('--yes', "supabase@$VersionCli") + $Arguments
    Ecrire-Info "npx $($complets -join ' ')"
    & $Npx @complets
    $code = $LASTEXITCODE
    if ($code -ne 0 -and -not $ToleranteALEchec) {
        throw "La CLI Supabase a échoué (code $code)."
    }
    return $code
}

# =============================================================================
Ecrire-Titre 'Poste de travail'

$npx = Trouver-Npx -Impose $Node
if ($null -eq $npx) {
    Write-Host ''
    Write-Host 'node/npx est introuvable depuis cette fenêtre.' -ForegroundColor Red
    Write-Host ''
    Write-Host 'Ce que ce terminal résout :' -ForegroundColor Yellow
    Write-Host "  USERNAME                 $env:USERNAME"
    Write-Host "  USERPROFILE              $env:USERPROFILE"
    Write-Host "  LOCALAPPDATA             $env:LOCALAPPDATA"
    Write-Host ("  API .NET                 " + [Environment]::GetFolderPath('LocalApplicationData'))
    Write-Host ''
    Write-Host '  Les deux faces de la redirection des paquets Windows ont été' -ForegroundColor Yellow
    Write-Host '  explorées : la racine ordinaire et les caches locaux des paquets.' -ForegroundColor Yellow
    Write-Host ''
    Write-Host 'Emplacements essayés :' -ForegroundColor Yellow
    foreach ($e in $script:Essais) {
        Write-Host ("  {0,-6} {1}" -f $(if ($e.Trouve) { 'vu' } else { 'non' }), $e.Chemin)
    }
    Write-Host ''
    Write-Host 'Deux voies :'
    Write-Host '  1. Indiquer le dossier de npx.cmd à la main, en une seule ligne :'
    Write-Host '     .\outils\deployer-edge-functions.cmd -Projet test -Simulation -Node "C:\chemin\vers\node"'
    Write-Host '  2. Déployer depuis le tableau de bord Supabase'
    Write-Host '     (docs/mise-en-service.md, section E).'
    exit 2
}
Ecrire-Ok "npx : $npx"

# npx.cmd n'est qu'un lanceur : il appelle « node » et le cherche dans le PATH.
# Trouver le .cmd ne suffit donc pas, il faut aussi rendre node visible.
$dossierNode = Split-Path -Parent $npx
$env:Path = "$dossierNode;$env:Path"
if ($null -eq (Get-Command 'node.exe' -ErrorAction SilentlyContinue)) {
    Write-Host ''
    Write-Host "node.exe est absent de $dossierNode." -ForegroundColor Red
    Write-Host 'L''installation Node de ce poste est incomplète.'
    exit 2
}

$racine = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $racine
Ecrire-Ok "Dépôt : $racine"

$version = & $npx --yes "supabase@$VersionCli" --version | Select-Object -Last 1
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Impossible de lancer la CLI Supabase.' -ForegroundColor Red
    exit 2
}
Ecrire-Ok "CLI Supabase : $version"

# --- Vérification du jeton, sans rien déployer --------------------------------
if ($Connexion) {
    if (-not (Assurer-Jeton)) { exit 3 }
    Ecrire-Titre 'Épreuve du jeton sur le projet de test'
    $code = Invoquer-Cli -Npx $npx -Arguments @('functions', 'list', '--project-ref', $REFS['test']) -ToleranteALEchec
    Write-Host ''
    if ($code -ne 0) {
        Write-Host 'Le jeton est refusé. Le recréer sur' -ForegroundColor Red
        Write-Host 'https://supabase.com/dashboard/account/tokens' -ForegroundColor Red
        exit 3
    }
    Ecrire-Ok 'Jeton valide. Relancer avec -Projet test ou -Projet prod.'
    exit 0
}

if ([string]::IsNullOrWhiteSpace($Projet)) {
    Write-Host ''
    Write-Host 'Préciser -Projet test ou -Projet prod (ou -Connexion pour éprouver le jeton).' -ForegroundColor Yellow
    exit 1
}

$ref = $REFS[$Projet]

# --- 3. Les sources sont-elles là ? ------------------------------------------
Ecrire-Titre 'Fonctions à déployer'
$manquantes = @()
foreach ($f in $Fonctions) {
    $index = Join-Path $racine "supabase\functions\$f\index.ts"
    if (Test-Path -LiteralPath $index) {
        Ecrire-Ok $f
    } else {
        $manquantes += $f
        Write-Host "   !!   $f — supabase\functions\$f\index.ts introuvable" -ForegroundColor Red
    }
}
if ($manquantes.Count -gt 0) {
    Write-Host ''
    Write-Host 'Déploiement annulé : sources manquantes.' -ForegroundColor Red
    Write-Host 'Vérifier que la branche du chantier est bien celle qui est extraite.'
    exit 1
}

# --- 4. Le projet visé --------------------------------------------------------
Ecrire-Titre "Projet visé : $($Projet.ToUpper()) ($ref)"
if ($Projet -eq 'prod') {
    Write-Host '   ATTENTION : ceci est la PRODUCTION.' -ForegroundColor Yellow
}
Ecrire-Info 'Le ref est passé explicitement à chaque commande : un projet lié'
Ecrire-Info 'en cache (supabase\.temp) ne peut pas détourner le déploiement.'

if (-not (Assurer-Jeton)) { exit 3 }

Ecrire-Titre 'État actuel des fonctions déployées'
$code = Invoquer-Cli -Npx $npx -Arguments @('functions', 'list', '--project-ref', $ref) -ToleranteALEchec
if ($code -ne 0) {
    Write-Host ''
    Write-Host 'Lecture impossible : jeton refusé, ou projet injoignable.' -ForegroundColor Yellow
    Write-Host 'Éprouver le jeton seul :' -ForegroundColor Yellow
    Write-Host '    .\outils\deployer-edge-functions.cmd -Connexion' -ForegroundColor Yellow
    exit 3
}

if ($Simulation) {
    Ecrire-Titre 'Simulation'
    Ecrire-Ok 'Tout est en place. Rien n''a été déployé.'
    Ecrire-Info "Pour déployer : .\outils\deployer-edge-functions.cmd -Projet $Projet"
    exit 0
}

# --- 5. Garde-fou production --------------------------------------------------
if ($Projet -eq 'prod') {
    Write-Host ''
    $reponse = Read-Host 'Déploiement en PRODUCTION. Taper PRODUCTION pour confirmer'
    if ($reponse -cne 'PRODUCTION') {
        Write-Host 'Annulé.' -ForegroundColor Yellow
        exit 1
    }
}

# --- 6. Déploiement -----------------------------------------------------------
Ecrire-Titre 'Déploiement'
$arguments = @('functions', 'deploy') + $Fonctions + @('--project-ref', $ref, '--use-api')
Invoquer-Cli -Npx $npx -Arguments $arguments | Out-Null

Ecrire-Titre 'État après déploiement'
Invoquer-Cli -Npx $npx -Arguments @('functions', 'list', '--project-ref', $ref) -ToleranteALEchec | Out-Null

Write-Host ''
Ecrire-Ok "Déploiement terminé sur $($Projet.ToUpper()) ($ref)."
Write-Host ''
Write-Host 'Reste à vérifier, une seule fois par projet, que le secret DEEPL_API_KEY'
Write-Host 'y est bien posé (Tableau de bord > Edge Functions > Secrets), sans quoi'
Write-Host '« traduire » répondra en erreur.'
