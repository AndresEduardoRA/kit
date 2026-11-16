#!/usr/bin/env python3
"""Valida una carpeta de semilla (esquema semilla/v1, plan/v1).

Uso: python3 validar_semilla.py <carpeta-de-la-semilla>
Sale con 0 si pasa, 1 si hay errores. Requiere PyYAML (Ubuntu/Debian: sudo apt install python3-yaml).
"""
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.exit("Falta PyYAML: sudo apt install python3-yaml")

PROHIBIDAS = [r"\bTBD\b", r"\ba definir\b", r"\bsegún criterio\b", r"\betc\.", r"\bpor definir\b", r"\bpendiente de decidir\b"]
RIESGOS = {"rojo", "ambar", "verde"}
AGENTES = {"claude", "codex"}
MODELOS = {"haiku", "sonnet", "opus", "opusplan", "fable", "codex"}
EFFORTS = {"low", "medium", "high", "xhigh", "max"}
MODOS = {"auto", "plan", "manual", "plan→auto", "plan→manual"}
REVISORES = {"codex", "claude-sesion-nueva", "ninguno"}

errores, avisos = [], []


def err(msg):
    errores.append(msg)


def leer_semilla(carpeta: Path) -> str:
    if (carpeta / "semilla.md").exists():
        return (carpeta / "semilla.md").read_text(encoding="utf-8")
    sub = carpeta / "semilla"
    if sub.is_dir():
        return "\n".join(p.read_text(encoding="utf-8") for p in sorted(sub.glob("*.md")))
    err("No existe semilla.md ni la carpeta semilla/")
    return ""


def frontmatter(texto: str) -> dict:
    m = re.match(r"^---\n(.*?)\n---", texto, re.S)
    if not m:
        err("La semilla no empieza con frontmatter YAML")
        return {}
    return yaml.safe_load(m.group(1)) or {}


def ids_del_registro(carpeta: Path) -> set:
    reg = carpeta / "registro.md"
    if not reg.exists():
        err("No existe registro.md")
        return set()
    ids = set()
    for linea in reg.read_text(encoding="utf-8").splitlines():
        celdas = [c.strip() for c in linea.strip().strip("|").split("|")]
        if len(celdas) >= 4 and re.fullmatch(r"[A-Z]{1,3}\d+", celdas[0]):
            ids.add(celdas[0])
            estado = celdas[3].lower()
            if "abierta" in estado or "contradic" in estado:
                err(f"Registro: {celdas[0]} sigue en estado «{celdas[3]}»")
    if not ids:
        err("registro.md no tiene filas con ID")
    return ids


def solapan(a: str, b: str) -> bool:
    a, b = a.rstrip("/") + "/", b.rstrip("/") + "/"
    return a.startswith(b) or b.startswith(a)


def validar_plan(carpeta: Path, ids_registro: set):
    ruta = carpeta / "plan.yaml"
    if not ruta.exists():
        err("No existe plan.yaml")
        return
    plan = yaml.safe_load(ruta.read_text(encoding="utf-8")) or {}
    if plan.get("esquema") != "plan/v1":
        err("plan.yaml: esquema debe ser plan/v1")
    agentes_disp = set(plan.get("agentes_disponibles") or [])
    if not agentes_disp <= AGENTES or "claude" not in agentes_disp:
        err("plan.yaml: agentes_disponibles debe incluir claude y solo claude/codex")

    carriles = {c["id"]: c for c in plan.get("carriles") or []}
    if not carriles:
        err("plan.yaml: sin carriles")
    for a in carriles.values():
        for b in carriles.values():
            if a["id"] < b["id"]:
                for ra in a.get("dueno_de", []):
                    for rb in b.get("dueno_de", []):
                        if solapan(ra, rb):
                            err(f"OWNERS: {a['id']} y {b['id']} comparten {ra} / {rb}")

    pasos = {p["id"]: p for p in plan.get("pasos") or []}
    if len(pasos) != len(plan.get("pasos") or []):
        err("plan.yaml: IDs de paso repetidos")

    for pid, p in pasos.items():
        pref = f"Paso {pid}:"
        for campo in ("titulo", "depende_de", "carril", "riesgo", "modulos", "ruteo", "verificacion", "terminado"):
            if campo not in p:
                err(f"{pref} falta «{campo}»")
        if p.get("riesgo") not in RIESGOS:
            err(f"{pref} riesgo inválido")
        if p.get("carril") not in carriles:
            err(f"{pref} carril «{p.get('carril')}» no existe")
        else:
            propias = carriles[p["carril"]].get("dueno_de", [])
            for m in p.get("modulos", []):
                if not any((m.rstrip("/") + "/").startswith(r.rstrip("/") + "/") for r in propias) and not m.startswith("docs/"):
                    err(f"{pref} toca {m}, que no es del carril {p['carril']}")
        for d in p.get("depende_de", []):
            if d not in pasos:
                err(f"{pref} depende de {d}, que no existe")
        for dec in p.get("decisiones", []):
            if ids_registro and dec not in ids_registro:
                err(f"{pref} cita la decisión {dec}, que no está en el registro")

        r = p.get("ruteo") or {}
        if r.get("agente") not in AGENTES:
            err(f"{pref} agente inválido")
        elif r["agente"] not in agentes_disp:
            err(f"{pref} usa {r['agente']}, que no está en agentes_disponibles")
        if r.get("modelo") not in MODELOS:
            err(f"{pref} modelo inválido")
        if r.get("effort") not in EFFORTS:
            err(f"{pref} effort inválido")
        if r.get("modo") not in MODOS:
            err(f"{pref} modo inválido")
        if r.get("modo") == "bypassPermissions":
            err(f"{pref} bypassPermissions está prohibido")
        if r.get("revisor") not in REVISORES:
            err(f"{pref} revisor inválido")
        if r.get("revisor") == "codex" and "codex" not in agentes_disp:
            err(f"{pref} revisor codex sin codex disponible")
        if p.get("riesgo") == "rojo":
            if r.get("modelo") not in {"opus"}:
                err(f"{pref} paso rojo debe ir con opus (nunca fable, sonnet ni haiku)")
            if r.get("effort") not in {"high", "xhigh", "max"}:
                err(f"{pref} paso rojo necesita effort high o más")
            if not str(r.get("modo", "")).startswith("plan"):
                err(f"{pref} paso rojo debe empezar en modo plan")
            if r.get("revisor") == "ninguno":
                err(f"{pref} paso rojo necesita revisor independiente")
        if r.get("modelo") == "fable" and p.get("riesgo") != "verde":
            avisos.append(f"{pref} usa fable fuera de un paso verde: confirmar que es la excepción del bug que falló 2 veces")
        v = p.get("verificacion") or {}
        if v.get("nivel") not in (1, 2, 3) or not v.get("comando"):
            err(f"{pref} verificación necesita nivel 1-3 y comando")
        if re.search(r"\bmanual|a mano|pruébalo\b", str(v.get("comando", "")), re.I):
            err(f"{pref} la verificación no puede ser manual")

    # ciclos y antecesores
    estado, ancestros = {}, {}

    def visitar(pid):
        if estado.get(pid) == 1:
            err(f"Ciclo de dependencias que pasa por {pid}")
            return set()
        if estado.get(pid) == 2:
            return ancestros[pid]
        estado[pid] = 1
        acc = set()
        for d in pasos[pid].get("depende_de", []):
            if d in pasos:
                acc |= {d} | visitar(d)
        estado[pid], ancestros[pid] = 2, acc
        return acc

    for pid in pasos:
        visitar(pid)

    # pasos que pueden correr en paralelo no deben tocar el mismo módulo
    ids = list(pasos)
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            if a in ancestros.get(b, set()) or b in ancestros.get(a, set()):
                continue
            for ma in pasos[a].get("modulos", []):
                for mb in pasos[b].get("modulos", []):
                    if solapan(ma, mb) and not ma.startswith("docs/"):
                        err(f"{a} y {b} pueden correr en paralelo y ambos tocan {ma} / {mb}")


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    carpeta = Path(sys.argv[1]).expanduser()
    texto = leer_semilla(carpeta)
    fm = frontmatter(texto) if texto else {}
    if fm and fm.get("esquema") != "semilla/v1":
        err("Frontmatter: esquema debe ser semilla/v1")
    for campo in ("nombre", "slug", "version", "tamano", "tipo", "plataforma", "arquitectura", "stack", "servicios",
                  "agentes", "tope_cuota", "generada_con"):
        if fm and campo not in fm:
            err(f"Frontmatter: falta «{campo}»")
    for patron in PROHIBIDAS:
        for m in re.finditer(patron, texto, re.I):
            linea = texto.count("\n", 0, m.start()) + 1
            err(f"semilla línea {linea}: texto prohibido «{m.group(0)}»")
    n = texto.count("«verificar»")
    if n:
        avisos.append(f"La semilla tiene {n} marcas «verificar»: ciérralas antes del arranque")
    ids = ids_del_registro(carpeta)
    faltan = sorted(i for i in ids if not re.search(rf"\b{re.escape(i)}\b", texto))
    if faltan:
        err("IDs del registro que no aparecen en la semilla: " + ", ".join(faltan))
    validar_plan(carpeta, ids)

    for a in avisos:
        print("AVISO  ", a)
    for e in errores:
        print("ERROR  ", e)
    print(f"\n{len(errores)} errores, {len(avisos)} avisos")
    sys.exit(1 if errores else 0)


if __name__ == "__main__":
    main()
