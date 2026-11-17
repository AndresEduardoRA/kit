# shellcheck shell=bash
# Los niveles de modelo (scripts/orquestador/README.md › «Una tarea»): una tarea nombra un nivel (rapido, normal, capaz) y
# config.env dice qué alias es cada uno (NIVEL_RAPIDO…). Nunca una versión fija: envejece sin que nadie lo note, y
# `verificar` pregunta qué modelo es hoy cada alias. Lo carga orquestador.sh con `source`; usa su `campo`.
# Los textos de error son los mismos que los de `problemaDeModelo` en spec-issue.mjs (niveles.test.ts los compara).

NIVELES="rapido normal capaz"
ALIAS_DE_MODELO='^[a-z]+(\[1m\])?$'

alias_valido() { [[ "$1" =~ $ALIAS_DE_MODELO ]]; }

problema_de_modelo() { # clave valor — imprime lo que está mal y devuelve 1; un valor vacío está bien
  local k=$1 v=$2
  [ -n "$v" ] || return 0
  case "$k" in
    nivel | nivel_plan)
      [[ " $NIVELES " == *" $v "* ]] && return 0
      echo "«$k: $v» no es rapido, normal ni capaz"
      ;;
    modelo | modelo_plan)
      alias_valido "$v" && return 0
      if [[ "$v" =~ [0-9] ]]; then
        echo "«$k: $v» es una versión fija de modelo: va «${k/modelo/nivel}: rapido|normal|capaz» (o un alias, como sonnet)"
      else
        echo "«$k: $v» no es un alias de modelo (minúsculas, como sonnet): va «${k/modelo/nivel}: rapido|normal|capaz»"
      fi
      ;;
    *) return 0 ;;
  esac
  return 1
}

modelo_de_nivel() { # nivel — imprime su alias (NIVEL_<NIVEL> de config.env); 1 si el nivel no existe o su alias no vale
  local v
  case "$1" in
    rapido) v=${NIVEL_RAPIDO:-} ;;
    normal) v=${NIVEL_NORMAL:-} ;;
    capaz) v=${NIVEL_CAPAZ:-} ;;
    *) return 1 ;;
  esac
  alias_valido "$v" || return 1
  echo "$v"
}

# El modelo de una sesión: `nivel<sufijo>` de la spec; si no, `modelo<sufijo>` (un alias, por compatibilidad); si no, el nivel por
# defecto. Deja ELEGIDO, o MOTIVO_MODELO y devuelve 1. Se llama sin `$(…)`: las dos variables tienen que quedar en este shell.
elegir_modelo() { # spec sufijo(""|_plan) nivel_por_defecto
  local n m
  ELEGIDO="" MOTIVO_MODELO=""
  n=$(campo "$1" "nivel$2")
  m=$(campo "$1" "modelo$2")
  MOTIVO_MODELO=$(problema_de_modelo "modelo$2" "$m") || return 1
  MOTIVO_MODELO=$(problema_de_modelo "nivel$2" "$n") || return 1
  if [ -n "$n" ]; then
    ELEGIDO=$(modelo_de_nivel "$n")
  elif [ -n "$m" ]; then
    ELEGIDO=$m
  else
    ELEGIDO=$(modelo_de_nivel "$3") || { MOTIVO_MODELO="el nivel por defecto «$3» no tiene un alias válido en config.env"; return 1; }
  fi
  [ -n "$ELEGIDO" ] || { MOTIVO_MODELO="«nivel$2: $n» no tiene un alias válido en config.env"; return 1; }
}

error_de_modelo() { # spec — imprime el primer problema de sus campos de modelo y devuelve 0; sin problemas, 1
  local k p
  for k in modelo nivel modelo_plan nivel_plan; do
    p=$(problema_de_modelo "$k" "$(campo "$1" "$k")") || { echo "$p"; return 0; }
  done
  return 1
}

niveles_invalidos() { # imprime cada NIVEL_* de la configuración que no vale y devuelve 0 si hay alguno; todos bien, 1
  local v hay=1
  for v in NIVEL_RAPIDO NIVEL_NORMAL NIVEL_CAPAZ; do
    alias_valido "${!v:-}" && continue
    hay=0
    if [[ "${!v:-}" =~ [0-9] ]]; then
      echo "$v=«${!v:-}» es una versión fija de modelo: va un alias (haiku, sonnet, opus)"
    else
      echo "$v=«${!v:-}» no es un alias de modelo (minúsculas, como sonnet)"
    fi
  done
  for v in NIVEL_EJECUTAR NIVEL_PLANIFICAR NIVEL_ARREGLAR_DIFICIL; do
    [[ " $NIVELES " == *" ${!v:-} "* ]] && continue
    hay=0
    echo "$v=«${!v:-}» no es rapido, normal ni capaz"
  done
  return $hay
}

modelos_heredados() { # los MODELO_* de antes que siguen en config.local.env: ya no se leen
  local v
  for v in MODELO_EJECUTAR MODELO_PLANIFICAR MODELO_ARREGLAR_DIFICIL; do
    [ -n "${!v:-}" ] && echo "$v ya no se lee: va NIVEL_${v#MODELO_}=rapido|normal|capaz"
  done
  return 0
}
