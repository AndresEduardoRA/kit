# shellcheck shell=bash
# Lo que se le pregunta a GitHub sobre la cola de integración (la merge queue: docs/FLUJO.md › «GitHub», docs/GLOSARIO.md). La cargan
# con `source` publicar.sh y el orquestador (scripts/orquestador/integracion.sh). Llama a `gh` a secas, en el repo de la carpeta actual
# (el orquestador la llama dentro de `(cd "$REPO" && …)`).
#   - `cola_activa`: true o false, si main exige la cola. Lee los rulesets, que es donde se activa (no la protección clásica).
#   - `estado_en_la_cola <pr>`: una línea JSON `{enCola, puesto, autoMerge, sha, entrada, salida}` (`salida`: `{id, cuando, motivo}` de
#     la última vez que la cola lo sacó, o null; `entrada`: cuándo entró la última vez, o null). Sin respuesta de GitHub, nada y 1.
#   - `corrida_del_grupo <pr>`: el id de la corrida de ci.yml más nueva del grupo del PR (`gh-readonly-queue/main/pr-<n>-…`), o nada.
#   - `caidos_del_grupo <corrida>`: una línea «nombre<TAB>job<TAB>corrida» por job caído, sin «Listo»: los `failure` y, si no hay
#     ninguno, los `cancelled`.
# gh 2.46 no trae los campos de la cola en `pr view --json`: por eso GraphQL. Se prueba en cola-de-integracion.test.ts.

# Las $ son variables de GraphQL: el heredoc entre comillas no expande nada.
CONSULTA_DE_LA_COLA=$(
  cat <<'GRAPHQL'
query($owner: String!, $name: String!, $n: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $n) {
      headRefOid
      isInMergeQueue
      mergeQueueEntry { position state }
      autoMergeRequest { enabledAt }
      timelineItems(last: 10, itemTypes: [ADDED_TO_MERGE_QUEUE_EVENT, REMOVED_FROM_MERGE_QUEUE_EVENT]) {
        nodes {
          __typename
          ... on AddedToMergeQueueEvent { id createdAt }
          ... on RemovedFromMergeQueueEvent { id createdAt reason }
        }
      }
    }
  }
}
GRAPHQL
)

cola_activa() {
  local r
  r=$(gh api 'repos/{owner}/{repo}/rules/branches/main' 2>/dev/null) || r='[]'
  jq -r 'if type == "array" then any(.[]; .type == "merge_queue") else false end' <<<"${r:-[]}" 2>/dev/null || echo false
}

estado_en_la_cola() {
  local r
  r=$(gh api graphql -F owner='{owner}' -F name='{repo}' -F n="$1" -f query="$CONSULTA_DE_LA_COLA" 2>/dev/null) || return 1
  jq -ce '.data.repository.pullRequest // empty
    | (.timelineItems.nodes // []) as $ev
    | ([$ev[] | select(.__typename == "AddedToMergeQueueEvent")] | last) as $entro
    | ([$ev[] | select(.__typename == "RemovedFromMergeQueueEvent")] | last) as $salio
    | {
        enCola: (.isInMergeQueue == true),
        puesto: (.mergeQueueEntry.position // null),
        autoMerge: (.autoMergeRequest != null),
        sha: .headRefOid,
        entrada: ($entro.createdAt // null),
        salida: (if $salio then {id: $salio.id, cuando: $salio.createdAt, motivo: ($salio.reason // "")} else null end)
      }' <<<"$r" 2>/dev/null || return 1
}

corrida_del_grupo() {
  gh run list --workflow ci.yml --event merge_group --limit 50 --json databaseId,headBranch,createdAt 2>/dev/null |
    jq -r --arg p "gh-readonly-queue/main/pr-$1-" \
      '[.[] | select(.headBranch | startswith($p))] | sort_by(.createdAt) | last | .databaseId // empty' 2>/dev/null
}

caidos_del_grupo() {
  gh run view "$1" --json jobs 2>/dev/null | jq -r --arg run "$1" '
    [.jobs[] | select((.name | startswith("Listo")) | not)] as $jobs
    | ([$jobs[] | select(.conclusion == "failure")] | if length > 0 then . else [$jobs[] | select(.conclusion == "cancelled")] end)
    | .[] | [.name, (.databaseId | tostring), $run] | @tsv' 2>/dev/null
}
